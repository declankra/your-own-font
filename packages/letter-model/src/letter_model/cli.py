"""One command for the whole pipeline:

    uv run letter-model all          # prepare -> synth -> candidates -> train -> export -> evaluate
    uv run letter-model <stage> ...  # or one stage at a time

Stages read and write data/cache (never committed). Fixed seeds throughout.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

import numpy as np

from . import paths

SEED = 20260922
LOG: list[str] = []


def log(msg: str):
    line = f"[{time.strftime('%H:%M:%S')}] {msg}"
    print(line, flush=True)
    LOG.append(line)


def node(script: str, *args: str):
    cmd = ["npx", "--no-install", "tsx", f"scripts/{script}", *args]
    r = subprocess.run(cmd, cwd=paths.PIPELINE, capture_output=True, text=True)
    if r.returncode != 0:
        print(r.stdout, r.stderr, file=sys.stderr)
        raise SystemExit(f"node {script} failed")
    return r.stdout


# ------------------------------------------------------------------------------ stages
def prepare(args):
    from .synth import load_glyphs, save_pickle

    t = time.time()
    gl = load_glyphs(paths.RAW, paths.PROTOTYPE)
    save_pickle(paths.CACHE / "glyphs.pkl", gl)
    from collections import Counter

    c = Counter((g.source, g.meta["split"]) for g in gl)
    log(f"prepare: {len(gl)} glyphs " + ", ".join(f"{s}/{sp} {n}" for (s, sp), n in sorted(c.items()))
        + f" ({time.time() - t:.0f}s)")


def synth(args):
    from . import synth as S
    from .words import EXTRA_WORDS, sentence_words

    t = time.time()
    gl = S.load_pickle(paths.CACHE / "glyphs.pkl")
    split = {s: [g for g in gl if g.meta["split"] == s] for s in ("train", "val", "test")}
    scale = args.scale
    # isolated letters
    for sp, aug, keep in (("train", {"uji": 40, "omniglot": 40, "*": 160}, False),
                          ("val", {"uji": 3, "omniglot": 3, "*": 12}, True),
                          ("test", {"uji": 2, "omniglot": 2, "*": 10}, True)):
        a = {k: max(1, int(v * (scale if sp == "train" else 1))) for k, v in aug.items()}
        r, s, y, meta = S.build_isolated(split[sp], a, SEED + {"train": 1, "val": 2, "test": 3}[sp], keep_original=keep)
        S.save_npz(paths.CACHE / f"iso_{sp}.npz", r=r, s=s, y=y,
                   src=np.array([m[0] for m in meta]), style=np.array([m[1] for m in meta]))
        log(f"synth: isolated {sp} {len(r)}")
    # explicit negatives
    for sp, n in (("train", int(120000 * scale)), ("val", 4000), ("test", 8000)):
        r, s, y, types, meta = S.build_negatives(split[sp], n, SEED + 7 + len(sp))
        S.save_npz(paths.CACHE / f"neg_{sp}.npz", r=r, s=s, y=y, type=np.array(types),
                   src=np.array([m[0] for m in meta]), style=np.array([m[1] for m in meta]))
        log(f"synth: negatives {sp} {len(r)}")
    # words (fixture format)
    sw = sentence_words()
    texts = EXTRA_WORDS + sw
    weights = [1.0] * len(EXTRA_WORDS) + [4.0] * len(sw)
    jobs = S.word_jobs(split["train"], (texts, weights), int(9000 * scale), SEED + 11)
    S.write_jsonl(paths.CACHE / "words_train.jsonl", S.sessions_of(S.build_words(jobs, SEED + 12), "train"))
    jobs = S.eval_word_jobs(split["val"], sw, {"uji": 2, "omniglot": 2, "*": 8}, SEED + 13)
    S.write_jsonl(paths.CACHE / "words_val.jsonl", S.sessions_of(S.build_words(jobs, SEED + 14), "val"))
    jobs = S.eval_word_jobs(split["test"], sw, {"uji": 3, "omniglot": 3, "*": 12}, SEED + 15)
    S.write_jsonl(paths.CACHE / "words_test.jsonl", S.sessions_of(S.build_words(jobs, SEED + 16), "test"))
    rng = np.random.default_rng(SEED + 17)
    extra = [EXTRA_WORDS[i] for i in rng.choice(len(EXTRA_WORDS), 60, replace=False)]
    jobs = S.eval_word_jobs(split["test"], extra, {"uji": 1, "omniglot": 1, "*": 3}, SEED + 18)
    S.write_jsonl(paths.CACHE / "words_test_extra.jsonl", S.sessions_of(S.build_words(jobs, SEED + 19), "test"))
    log(f"synth: words done ({time.time() - t:.0f}s)")


def candidates(args):
    from . import synth as S

    t = time.time()
    for sp in ("train", "val"):
        src = paths.CACHE / f"words_{sp}.jsonl"
        out = paths.CACHE / f"cand_{sp}.jsonl"
        counts = node("candidates.ts", str(src), str(out), "2", str(SEED % 1000))
        r, s, y, meta = S.rasterize_candidates(out, src, max_null_ratio=1.6, seed=SEED)
        S.save_npz(paths.CACHE / f"cand_{sp}.npz", r=r, s=s, y=y,
                   style=np.array([m[1].split(":", 1)[1] for m in meta]),
                   part=np.array([m[2] for m in meta]))
        log(f"candidates {sp}: {counts.strip()} -> kept {len(r)} ({np.mean(y == 31):.0%} ∅)")
    log(f"candidates: {time.time() - t:.0f}s")


def _load(name, style=False):
    d = np.load(paths.CACHE / f"{name}.npz")
    out = (d["r"], d["s"], d["y"])
    return out + (d["style"],) if style else out


def train(args):
    import torch

    from .classes import NULL_ID
    from .train import calibrate_null, device, predict, train as run

    t = time.time()
    dev = device()
    (paths.CACHE / "segmenter.json").write_text("{}")  # re-tuned after export
    names = ("iso_train", "neg_train", "cand_train", "iso_val", "neg_val", "cand_val", "neg_test")
    sets = {n: _load(n, style=True) for n in names}
    tr_names = ("iso_train", "neg_train", "cand_train")
    # 1. confident learning. Two folds split by writer/style; a model that has seen ∅ labels
    #    scores the other fold. ∅ samples it still reads as one specific letter (P >= 0.5) are
    #    shaped exactly like that letter (half an m is an n) and are not used as ∅.
    fold = {n: np.array([zlib_fold(st) for st in sets[n][3]]) for n in names}
    Rall = {n: sets[n][:3] for n in names}
    lp_oof = {n: np.zeros((len(sets[n][2]), 32), np.float32) for n in tr_names}
    labellers = []
    for k in (0, 1):
        part = [tuple(a[fold[n] != k] for a in Rall[n]) for n in tr_names]
        m = run(part, [Rall["iso_val"]], args.label_arch, args.label_epochs, SEED + 10 + k, log=lambda _m: None)
        for n in tr_names:
            idx = fold[n] == k
            lp_oof[n][idx] = predict(m, Rall[n][0][idx], Rall[n][1][idx], dev)
        labellers.append(m)
    # A letters-only reader for the second rule: a ∅ group that is part of ONE letter (a cut
    # or unfinished letter) and that this reader takes for a specific letter with P >= 0.9 is
    # that letter's shape (an unfinished o is a c). Not applied to ink from two letters: the
    # reader has never seen junk, so it is overconfident there.
    pos_only = [tuple(a[Rall[n][2] != NULL_ID] for a in Rall[n]) for n in ("iso_train", "cand_train")]
    reader = run(pos_only, [Rall["iso_val"]], args.label_arch, args.label_epochs, SEED + 30, log=lambda _m: None)
    clean = {}
    for n in names:
        r, s, y = Rall[n]
        if n in lp_oof:
            p = np.exp(lp_oof[n])
        else:
            p = (np.exp(predict(labellers[0], r, s, dev)) + np.exp(predict(labellers[1], r, s, dev))) / 2
        confident = (y == NULL_ID) & (p[:, :NULL_ID].max(1) >= 0.5)
        part = _partial_of_one_letter(n)
        shaped = np.zeros(len(y), bool)
        if part is not None and part.any():
            q = np.exp(predict(reader, r[part], s[part], dev)[:, :NULL_ID]).max(1)
            shaped[np.where(part)[0][q >= 0.9]] = True
        shaped &= y == NULL_ID
        np.save(paths.CACHE / f"lookalike_{n}.npy", confident)
        np.save(paths.CACHE / f"shaped_{n}.npy", shaped)
        drop = confident | shaped
        clean[n] = (r[~drop], s[~drop], y[~drop])
        if (y == NULL_ID).any():
            nn = max(1, (y == NULL_ID).sum())
            log(f"train: {n}: ∅ samples not used as ∅: {confident.sum() / nn:.1%} confidently read as a letter, "
                f"{(shaped & ~confident).sum() / nn:.1%} more letter-shaped partial letters")
    log(f"train: labellers {time.time() - t:.0f}s")
    tr = [clean[n] for n in tr_names]
    va = [clean["iso_val"], clean["neg_val"], clean["cand_val"]]
    # 2. a large teacher (too slow to ship), 3. the shipped student, distilled from it
    teacher = None
    if args.teacher:
        log(f"train: teacher {args.teacher}")
        teacher = run(tr, va, args.teacher, args.teacher_epochs, SEED + 20, log=log)
        torch.save({"arch": args.teacher, "state": teacher.cpu().state_dict()}, paths.CACHE / "teacher.pt")
        teacher = teacher.to(dev)
    log(f"train: student {args.arch}")
    net = run(tr, va, args.arch, args.epochs, SEED, log=log, teacher=teacher, alpha=args.distill_alpha)
    # 4. the ∅ margin, chosen on validation (baked into the last bias at export)
    delta, info = calibrate_null(net, [clean["iso_val"], clean["neg_val"]], dev)
    log(f"train: ∅ margin {delta:+.2f} on validation: {info}")
    torch.save({"arch": args.arch, "state": net.cpu().state_dict(), "null_margin": delta},
               paths.CACHE / "model.pt")
    log(f"train: {time.time() - t:.0f}s")


def _partial_of_one_letter(name: str):
    """Which ∅ samples are part of a single letter: the explicit 'cut' and 'missing' types,
    and candidate groups whose ink comes from one letter."""
    d = np.load(paths.CACHE / f"{name}.npz")
    if "type" in d:
        return np.isin(d["type"], ["cut", "missing"])
    if "part" in d:
        return d["part"].astype(bool)
    return None


def zlib_fold(style: str) -> int:
    """Fold by writer: both sessions of a UJI writer ("uji:UPV_W20-01", "-02") go together."""
    import re
    import zlib

    return zlib.crc32(re.sub(r"-\d+$", "", str(style)).encode()) % 2


def priors_from_glyphs(glyphs, seed: int) -> dict:
    """Per class: width (log), ink top and bottom, in the writer's own x-heights, measured
    on augmented training glyphs. Geometry mode and the model's geometry term use these."""
    from .augment import augment
    from .classes import CLASSES
    from .synth import strength_of

    rng = np.random.default_rng(seed)
    by: dict[str, list] = {}
    for g in glyphs:
        if g.meta["split"] != "train":
            continue
        for _ in range(6):
            st, _r = augment(g, rng, strength=strength_of(g))
            p = np.concatenate(st)
            by.setdefault(g.char, []).append(
                (np.log(max(np.ptp(p[:, 0]), 0.04)), -p[:, 1].min(), -p[:, 1].max()))
    out = {}
    for ch in CLASSES[:-1]:
        a = np.array(by[ch])
        med = np.median(a, 0)
        mad = np.median(np.abs(a - med), 0) * 1.4826  # robust sd
        out[ch] = {
            "logW": [round(float(med[0]), 4), round(float(max(mad[0], 0.12)), 4)],
            "top": [round(float(med[1]), 4), round(float(max(mad[1], 0.1)), 4)],
            "bottom": [round(float(med[2]), 4), round(float(max(mad[2], 0.08)), 4)],
        }
    return out


def load_net(path: Path):
    import torch

    from .model import ARCHS, LetterNet

    ck = torch.load(path, map_location="cpu")
    net = LetterNet(ARCHS[ck["arch"]]())
    net.load_state_dict(ck["state"])
    margin = float(ck.get("null_margin", 0.0))
    if margin:  # the calibrated ∅ margin becomes part of the last layer's bias
        last = [L for L in net.arch if L["op"] == "dense"][-1]["name"]
        with torch.no_grad():
            net.denses[last].bias[-1] -= margin
    return net.eval(), margin


def export(args):
    from . import synth as S
    from .export import write_bin

    t = time.time()
    net, margin = load_net(paths.CACHE / "model.pt")
    gl = S.load_pickle(paths.CACHE / "glyphs.pkl")
    priors = priors_from_glyphs(gl, SEED)
    seg_path = paths.CACHE / "segmenter.json"
    seg = json.loads(seg_path.read_text()) if seg_path.exists() else {}
    seg = {k: v for k, v in seg.items() if not k.startswith("_")}
    h = S.data_hash([paths.CACHE / f"{n}.npz" for n in ("iso_train", "neg_train", "cand_train")])
    hdr = write_bin(paths.BIN, net, priors, seg, h)
    size = paths.BIN.stat().st_size
    import gzip

    gz = len(gzip.compress(paths.BIN.read_bytes(), 9))
    log(f"export: {paths.BIN.name} {size / 1024:.1f} KB ({gz / 1024:.1f} KB gzipped), "
        f"{sum(t['length'] for t in hdr['tensors'])} weights, data hash {h}")
    parity_fixtures()
    log(f"export: {time.time() - t:.0f}s")


def parity_fixtures(n_raster: int = 200, n_logits: int = 1000):
    """Groups for the TS parity tests: strokes (rounded to 0.01 px first, so both sides see
    the same numbers), the Python raster and scalars, and the shipped model's logits."""
    import torch

    from .export import read_bin
    from .raster import rasterize

    rng = np.random.default_rng(SEED + 99)
    groups = []
    for f in ("words_test.jsonl", "words_test_extra.jsonl"):
        for line in open(paths.CACHE / f):
            sess = json.loads(line)
            # committed file: strokes from UJI (CC BY 4.0) and Omniglot (MIT) writers only,
            # never outlines derived from the OFL fonts
            if ":uji:" not in sess["writerId"] and ":omniglot:" not in sess["writerId"]:
                continue
            for w in sess["words"]:
                n = len(w["strokes"])
                for _ in range(3):  # random runs of consecutive strokes, pieces of strokes too
                    a = int(rng.integers(n))
                    b = min(n, a + int(rng.integers(1, 4)))
                    st = []
                    for k in range(a, b):
                        p = np.round(np.array(w["strokes"][k]["points"])[:, :2], 2)
                        if len(p) > 6 and rng.random() < 0.2:
                            c = int(rng.integers(2, len(p) - 2))
                            p = p[:c + 1] if rng.random() < 0.5 else p[c:]
                        st.append(p)
                    groups.append((st, w["guides"]["baseline"], w["guides"]["xHeight"]))
    idx = rng.choice(len(groups), n_raster + n_logits, replace=False)
    hdr, folded = read_bin(paths.BIN)

    def pack(i, with_raster):
        st, base, xh = groups[i]
        r, sc = rasterize(st, base, xh)
        item = {"strokes": [p.tolist() for p in st], "guides": {"baseline": base, "xHeight": xh},
                "scalars": [round(float(v), 7) for v in sc]}
        if with_raster:
            item["raster"] = [round(float(v), 6) for v in r.ravel()]
        else:
            x = torch.from_numpy(r)[None, None]
            s = torch.from_numpy(sc)[None]
            item["logits"] = [round(float(v), 6) for v in folded(x, s)[0]]
        return item

    out = {
        "note": "Generated by `uv run letter-model export`. Regenerate whenever the model or rasterizer changes.",
        "modelBytes": paths.BIN.stat().st_size,
        "trainingDataHash": hdr["trainingDataHash"],
        "raster": [pack(i, True) for i in idx[:n_raster]],
        "logits": [pack(i, False) for i in idx[n_raster:]],
    }
    paths.PARITY.mkdir(parents=True, exist_ok=True)
    (paths.PARITY / "parity.json").write_text(json.dumps(out, separators=(",", ":")))
    log(f"export: parity fixtures {n_raster} rasters, {n_logits} logits "
        f"({(paths.PARITY / 'parity.json').stat().st_size / 1e6:.1f} MB)")


def tune(args):
    """Tune the solver on validation words, then write the tuned weights into the model file."""
    t = time.time()
    out = paths.CACHE / "segmenter.json"
    txt = node("tune-segment.ts", "--model", str(paths.BIN), "--out", str(out), str(paths.CACHE / "words_val.jsonl"))
    for line in txt.strip().splitlines():
        log(f"tune: {line}")
    export(args)
    log(f"tune: {time.time() - t:.0f}s")


def tools(args):
    txt = node("build-tools.ts")
    log(f"tools: {' · '.join(txt.strip().splitlines())}")


def evaluate(args):
    from .evaluate import run as run_eval

    t = time.time()
    run_eval(log, node, bench=not args.no_bench)
    log(f"evaluate: {time.time() - t:.0f}s")


def parity(args):
    r = subprocess.run(["npx", "--no-install", "vitest", "run"], cwd=paths.PIPELINE, capture_output=True, text=True)
    for line in r.stdout.splitlines():
        if "parity:" in line or "Tests" in line or "✓" in line or "✗" in line or "FAIL" in line:
            log(f"parity: {line.strip()}")
    if r.returncode != 0:
        print(r.stdout[-3000:], r.stderr[-2000:], file=sys.stderr)
        raise SystemExit("parity tests failed")


STAGES = {"prepare": prepare, "synth": synth, "candidates": candidates, "train": train, "export": export,
          "tune": tune, "tools": tools, "parity": parity, "evaluate": evaluate}


def main() -> None:
    ap = argparse.ArgumentParser(prog="letter-model")
    ap.add_argument("stage", choices=[*STAGES, "all"])
    ap.add_argument("--arch", default="dsflat")
    ap.add_argument("--epochs", type=int, default=40)
    ap.add_argument("--distill-alpha", type=float, default=0.85, help="weight of the teacher's soft targets")
    ap.add_argument("--teacher", default="spec", help="large model to distil from ('' for none)")
    ap.add_argument("--teacher-epochs", type=int, default=12)
    ap.add_argument("--label-arch", default="dsflat")
    ap.add_argument("--label-epochs", type=int, default=8)
    ap.add_argument("--scale", type=float, default=1.5, help="training data size multiplier")
    ap.add_argument("--no-bench", action="store_true", help="skip the headless browser bench")
    args = ap.parse_args()
    t0 = time.time()
    order = list(STAGES) if args.stage == "all" else [args.stage]
    for st in order:
        STAGES[st](args)
    log(f"done: {' -> '.join(order)} in {(time.time() - t0) / 60:.1f} min")
    paths.REPORT.mkdir(parents=True, exist_ok=True)
    with open(paths.REPORT / "last-run.log", "a" if args.stage != "all" else "w") as f:
        f.write("\n".join(LOG) + "\n")


if __name__ == "__main__":
    main()
