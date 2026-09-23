"""Synthesize training and evaluation data from the glyph seeds.

Splits are by writer (UJI writer, Omniglot drawer) or by font style, never by sample:
20% of writers/styles are held out for test, a further ~10% for validation.
"""
from __future__ import annotations

import hashlib
import json
import math
import multiprocessing as mp
import pickle
from collections import defaultdict
from pathlib import Path

import numpy as np

from . import negatives as neg
from .augment import augment, to_pointer_samples
from .classes import CLASS_ID, NULL_ID, PUNCT
from .glyphs import Glyph, font_glyphs, house_glyphs, omniglot_glyphs, uji_glyphs
from .raster import rasterize_batch
from .words import EXTRA_WORDS, compose, sample_style, sentence_words

TEST_FONTS = {"font:ems:Tech", "font:ems:Neato", "font:ems:ReadabilityItalic"}
VAL_FONTS = {"font:ems:Pancakes"}


# ------------------------------------------------------------------ glyphs and splits
def load_glyphs(raw: Path, prototype: Path) -> list[Glyph]:
    gl = uji_glyphs(raw) + omniglot_glyphs(raw) + font_glyphs(raw) + house_glyphs(prototype)
    writers = sorted({g.meta["writer"] for g in gl if g.source == "uji"})
    uji_split = {}
    for i, w in enumerate(writers):
        uji_split[w] = "test" if i % 5 == 4 else "val" if i % 10 == 1 else "train"
    for g in gl:
        if g.source == "uji":
            g.meta["split"] = uji_split[g.meta["writer"]]
        elif g.source == "omniglot":
            d = int(g.meta["writer"])
            g.meta["split"] = "test" if d >= 17 else "val" if d == 16 else "train"
        elif g.style in TEST_FONTS:
            g.meta["split"] = "test"
        elif g.style in VAL_FONTS:
            g.meta["split"] = "val"
        else:
            g.meta["split"] = "train"
    return gl


def by_style(glyphs: list[Glyph]) -> dict[str, dict[str, list[Glyph]]]:
    out: dict[str, dict[str, list[Glyph]]] = defaultdict(lambda: defaultdict(list))
    for g in glyphs:
        out[g.style][g.char].append(g)
    return {k: dict(v) for k, v in out.items()}


def strength_of(g: Glyph) -> float:
    """Real handwriting needs less distortion than clean font outlines."""
    return {"uji": 0.55, "omniglot": 0.55}.get(g.source, 0.9)


# ------------------------------------------------------------------ placement on guides
def place(strokes: list[np.ndarray], rng: np.random.Generator, xh: float, baseline: float,
          spacing: float, scale: float | None = None) -> list[np.ndarray]:
    """Glyph frame -> pad px, like a writer on our guides: their own size relative to the
    guide x-height, a baseline that wanders +-0.15 xh, pointer-event sampling."""
    s = scale if scale is not None else float(np.clip(rng.lognormal(math.log(0.92), 0.16), 0.65, 1.35))
    dy = rng.uniform(-0.12, 0.12) * xh
    x0 = rng.uniform(40, 200)
    out = []
    for st in strokes:
        p = np.column_stack([st[:, 0] * s * xh + x0, st[:, 1] * s * xh + baseline + dy])
        out.append(to_pointer_samples(p, rng, spacing))
    return out


def _guides(rng):
    return float(rng.uniform(140, 220)), float(rng.uniform(44, 72))


# ------------------------------------------------------------------ workers
def _iso_worker(args):
    glyphs, n_aug, seed, keep_original = args
    rng = np.random.default_rng(seed)
    samples, bases, xhs, labels, meta = [], [], [], [], []
    for gi, g in enumerate(glyphs):
        for k in range(n_aug):
            base, xh = _guides(rng)
            if keep_original and k == 0:
                from .augment import place_punct
                st = place_punct([s.copy() for s in g.strokes], g.char, rng)
            else:
                st, _ = augment(g, rng, strength=strength_of(g))
            samples.append(place(st, rng, xh, base, rng.uniform(1.2, 6.0)))
            bases.append(base)
            xhs.append(xh)
            labels.append(CLASS_ID[g.char])
            meta.append((g.source, g.style))
    r, s = rasterize_batch(samples, bases, xhs)
    return r, s, np.array(labels, np.int16), meta


def _neg_worker(args):
    styles, n, seed, words_list = args
    rng = np.random.default_rng(seed)
    samples, bases, xhs, types, meta = [], [], [], [], []
    tries = 0
    while len(samples) < n and tries < n * 20:
        tries += 1
        style_name, gs = styles[int(rng.integers(len(styles)))]
        w = words_list[int(rng.integers(len(words_list)))]
        w = "".join(c for c in w if c in gs)
        if len(w) < 2:
            continue
        j = int(rng.integers(len(w) - 1))
        a_ch, b_ch = w[j], w[j + 1]
        ga = gs[a_ch][int(rng.integers(len(gs[a_ch])))]
        gb = gs[b_ch][int(rng.integers(len(gs[b_ch])))]
        sa, _ = augment(ga, rng, strength=strength_of(ga), allow_drop=False)
        sb, _ = augment(gb, rng, strength=strength_of(gb), allow_drop=False)
        t = neg.TYPES[int(rng.integers(4))]
        if t == "merged":
            st = neg.merged(sa, sb, rng)
        elif t == "cut":
            st = neg.cut(sa, rng)
        elif t == "fragment":
            left = rng.random() < 0.5
            st = neg.fragment(sb if left else sa, sa if left else sb, rng, b_is_left=left)
        else:
            st = neg.missing(sa, rng)
        if not st:
            continue
        base, xh = _guides(rng)
        samples.append(place(st, rng, xh, base, rng.uniform(1.2, 6.0)))
        bases.append(base)
        xhs.append(xh)
        types.append(t)
        meta.append((ga.source, style_name, a_ch + b_ch))
    r, s = rasterize_batch(samples, bases, xhs)
    return r, s, types, meta


def _word_worker(args):
    jobs, seed = args
    rng = np.random.default_rng(seed)
    out = []
    for style_name, gs, text, kind, strength in jobs:
        def pick(ch, gs=gs):
            lst = gs[ch]
            return lst[int(rng.integers(len(lst)))]
        st = sample_style(rng, kind)
        w = compose(text, pick, rng, st, aug_strength=strength)
        w["meta"]["style"] = style_name
        w["meta"]["kind"] = kind
        out.append(w)
    return out


def _pool(n=None):
    return mp.get_context("spawn").Pool(n or max(1, mp.cpu_count() - 2))


def _chunks(lst, k):
    return [lst[i::k] for i in range(k)]


# ------------------------------------------------------------------ builders
def build_isolated(glyphs: list[Glyph], n_aug: dict[str, int], seed: int, keep_original=False):
    tasks = []
    groups = defaultdict(list)
    for g in glyphs:
        groups[g.source].append(g)
    k = 0
    for src, gl in groups.items():
        for chunk in _chunks(gl, 12):
            if chunk:
                tasks.append((chunk, n_aug.get(src, n_aug.get("*", 1)), seed * 1000 + k, keep_original))
                k += 1
    with _pool() as p:
        res = p.map(_iso_worker, tasks)
    return _cat(res)


def build_negatives(glyphs: list[Glyph], n: int, seed: int):
    bs = by_style(glyphs)
    styles = sorted(bs.items())
    words_list = EXTRA_WORDS + sentence_words() * 5
    k = 12
    tasks = [(styles, n // k + 1, seed * 1000 + i, words_list) for i in range(k)]
    with _pool() as p:
        res = p.map(_neg_worker, tasks)
    r = np.concatenate([x[0] for x in res])[:n]
    s = np.concatenate([x[1] for x in res])[:n]
    types = sum((x[2] for x in res), [])[:n]
    meta = sum((x[3] for x in res), [])[:n]
    return r, s, np.full(len(r), NULL_ID, np.int16), types, meta


def _cat(res):
    r = np.concatenate([x[0] for x in res])
    s = np.concatenate([x[1] for x in res])
    y = np.concatenate([x[2] for x in res])
    meta = sum((x[3] for x in res), [])
    return r, s, y, meta


def word_jobs(glyphs: list[Glyph], texts_weighted, n_words, seed, strength_scale=1.0,
              kinds=("wide", "tight", "touching")):
    """Pick (style, word) pairs where the style has every character of the word."""
    rng = np.random.default_rng(seed)
    bs = by_style(glyphs)
    styles = sorted(bs)
    weights = np.array([{"uji": 0.55, "omniglot": 0.1}.get(s.split(":")[0], 0.35) for s in styles])
    # spread each source's share across its styles
    src = [s.split(":")[0] for s in styles]
    cnt = defaultdict(int)
    for s in src:
        cnt[s] += 1
    weights = weights / np.array([cnt[s] for s in src])
    weights /= weights.sum()
    jobs = []
    texts, tw = texts_weighted
    tw = np.asarray(tw, float) / np.sum(tw)
    while len(jobs) < n_words:
        st = styles[int(rng.choice(len(styles), p=weights))]
        text = texts[int(rng.choice(len(texts), p=tw))]
        if any(c not in bs[st] for c in text):
            continue
        g0 = next(iter(bs[st].values()))[0]
        jobs.append((st, bs[st], text, kinds[len(jobs) % len(kinds)], strength_of(g0) * strength_scale))
    return jobs


def build_words(jobs, seed):
    k = 12
    with _pool() as p:
        res = p.map(_word_worker, [(c, seed * 1000 + i) for i, c in enumerate(_chunks(jobs, k))])
    return sum(res, [])


def eval_word_jobs(glyphs: list[Glyph], texts: list[str], variants: dict[str, int], seed: int):
    """Every held-out style x every text x N variants, spread evenly over spacing kinds."""
    bs = by_style(glyphs)
    jobs = []
    kinds = ("wide", "tight", "touching")
    for st in sorted(bs):
        src = st.split(":")[0]
        nv = variants.get(src, variants.get("*", 1))
        g0 = next(iter(bs[st].values()))[0]
        for text in texts:
            if any(c not in bs[st] for c in text):
                continue
            for v in range(nv):
                jobs.append((st, bs[st], text, kinds[(v + len(jobs)) % 3], strength_of(g0) * 0.8))
    return jobs


def sessions_of(words: list[dict], writer_prefix: str) -> list[dict]:
    """Group synthetic words into fixture sessions, one per style."""
    by = defaultdict(list)
    for w in words:
        by[w["meta"]["style"]].append(w)
    return [
        {"version": 1, "writerId": f"{writer_prefix}:{st}", "device": "synthetic",
         "pointerType": "synthetic", "recordedAt": "2026-09-22", "words": ws}
        for st, ws in sorted(by.items())
    ]


def write_jsonl(path: Path, sessions: list[dict]):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as f:
        for s in sessions:
            f.write(json.dumps(s, separators=(",", ":")) + "\n")


def data_hash(paths: list[Path]) -> str:
    h = hashlib.sha256()
    for p in sorted(paths):
        with open(p, "rb") as f:
            for chunk in iter(lambda: f.read(1 << 20), b""):
                h.update(chunk)
    return h.hexdigest()[:16]


# ------------------------------------------------------------------ candidate groups
def rasterize_candidates(cand_jsonl: Path, sessions_jsonl: Path, max_null_ratio: float, seed: int):
    """Read the TS candidate dump and rasterize every labelled group."""
    sessions = [json.loads(l) for l in open(sessions_jsonl)]
    rng = np.random.default_rng(seed)
    samples, bases, xhs, labels, meta = [], [], [], [], []
    rows = [json.loads(l) for l in open(cand_jsonl)]
    pos = [r for r in rows if r["y"] != NULL_ID]
    nul = [r for r in rows if r["y"] == NULL_ID]
    keep = int(min(len(nul), max_null_ratio * len(pos)))
    idx = rng.choice(len(nul), keep, replace=False) if keep < len(nul) else np.arange(len(nul))
    rows = pos + [nul[i] for i in idx]
    for r in rows:
        w = sessions[r["s"]]["words"][r["w"]]
        st = [np.array(w["strokes"][k]["points"])[a : b + 1, :2] for k, a, b in r["g"]]
        samples.append(st)
        bases.append(w["guides"]["baseline"])
        xhs.append(w["guides"]["xHeight"])
        labels.append(r["y"])
        meta.append(("cand", sessions[r["s"]]["writerId"], bool(r.get("part", False))))
    out_r, out_s = [], []
    B = 50000
    for i in range(0, len(samples), B):
        a, b = rasterize_batch(samples[i : i + B], bases[i : i + B], xhs[i : i + B])
        out_r.append(a)
        out_s.append(b)
    return np.concatenate(out_r), np.concatenate(out_s), np.array(labels, np.int16), meta


def save_npz(path: Path, **arrays):
    path.parent.mkdir(parents=True, exist_ok=True)
    np.savez(path, **arrays)


def save_pickle(path: Path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "wb") as f:
        pickle.dump(obj, f)


def load_pickle(path: Path):
    with open(path, "rb") as f:
        return pickle.load(f)


PUNCT_SET = set(PUNCT)
