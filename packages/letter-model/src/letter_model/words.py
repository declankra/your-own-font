"""Synthetic words in the fixture format (docs/letter-model.md §5), composed from one
style's glyphs with realistic spacing (wide to touching), baseline drift, late dots and
crossbars, and strokes that run on from one letter into the next."""
from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from .augment import augment, to_pointer_samples
from .glyphs import Glyph

SENTENCE_PAIRS = [
    ("quick, bring the jazz and warm pie.", "six lovely foxes nap by the old wharf."),
]

# Extra words for training and a secondary evaluation: common words plus the punctuation
# the sentence pool may use (. , ' ! ?).
EXTRA_WORDS = """
about above after again air all almost along also always am among an and animal another
answer any are around as ask at away back be because been before began being below best
better between big black blue boat body book both box boy bring brown but buy by call came
can car carry cat change city close cold come could country cut day deep did do does dog
done door down draw dream drink each early earth eat end enough even every eye face fact
fall family far farm fast father feel few field find fine fire first fish five fly follow
food foot for form found four free friend from full game gave get girl give glad go gold
good got great green grow had half hand happy hard has have he head hear heart help her
here high him his hold home hope horse hot house how huge idea if in inside into is it its
jam job join joke joy judge juice jump just keep kept key kind king kiss kite knew know
lady lake land large last late laugh lazy lead learn leave left less let life light like
line list little live long look lost love low made make man many map mark may me mean
might mile milk mind miss money moon more most mother move much music must my name near
need never new next nice night no north not note now number of off often old on once one
only open or other our out over own page paper part party pass past pen people pick place
plan plant play point quack queen quest quiet quilt quit quite quiz rain ran reach read
ready real red rest rich ride right river road rock room round run said same saw say sea
seem seen set seven she ship short show side sing sit six size sky sleep slow small snow so
some song soon sound space speak spell stand star start stay step still stop story street
strong study such sun sure swim table tail take talk tall tea tell ten than that the their
them then there these they thing think this those though three through time tiny to today
together told too took top toward town tree true try turn two under until up us use very
voice vote wait walk wall want warm was watch water wave way we week well went were west
what wheel when where which while white who whole why wide wild will wind window winter
wish with woman wonder wood word work world would write yard year yellow yes yet you young
your zebra zero zip zone zoo
it's don't i'm you're we'll can't that's let's here's what's
yes! wow! hi! go! stop! yay! oh! no!
why? who? what? how? where? when? really? ready?
hello, well, so, yes, now, then, here, oh, and,
done. now. here. home. soon. there. again. too. yours. me.
""".split()


def sentence_words() -> list[str]:
    return [w for pair in SENTENCE_PAIRS for s in pair for w in s.split()]


@dataclass
class WordStyle:
    slant: float
    sx: float
    sy: float
    scale: float  # writer's x-height / guide x-height
    gap: float  # mean gap between letters, in the writer's x-heights (negative = overlap)
    late: bool  # dots and crossbars at the end of the word
    join_p: float  # chance that the pen runs on into the next letter
    spacing_px: float  # pointer sample spacing
    speed: float  # px per second


def sample_style(rng: np.random.Generator, kind: str | None = None) -> WordStyle:
    r = rng.random()
    if kind is None:
        kind = "wide" if r < 0.35 else "tight" if r < 0.65 else "touching"
    gap = {
        "wide": rng.uniform(0.18, 0.55),
        "tight": rng.uniform(0.02, 0.18),
        "touching": rng.uniform(-0.14, 0.02),
    }[kind]
    return WordStyle(
        slant=math.radians(rng.uniform(-12, 18)),
        sx=math.exp(rng.uniform(math.log(0.85), math.log(1.2))),
        sy=math.exp(rng.normal(0, 0.05)),
        scale=float(np.clip(rng.lognormal(math.log(0.92), 0.16), 0.65, 1.35)),
        gap=gap,
        late=bool(rng.random() < 0.35),
        join_p=0.0 if rng.random() < 0.6 else rng.uniform(0.3, 0.8),
        spacing_px=rng.uniform(1.2, 6.0),
        speed=rng.uniform(150, 600),
    )


class _Item:
    """One pen-down..pen-up in writing order, with the letter of each run of its points."""

    def __init__(self, pts: np.ndarray, letter: int, role: str):
        self.pts = pts
        self.runs = [(letter, 0, len(pts) - 1)]  # (letter, first idx, last idx) inclusive
        self.role = role
        self.connectors: list[tuple[int, int]] = []  # run-on connectors, one per boundary

    @property
    def first_letter(self):
        return self.runs[0][0]

    @property
    def last_letter(self):
        return self.runs[-1][0]


def _runs_on(a: "_Item", b: "_Item", xh: float) -> bool:
    """Writers who don't lift the pen do it where it's natural: the stroke ends on the right
    of one letter and the next letter starts on its left, a short hop away. (Print a, c, d,
    g, o, q, s start at the top right; nobody draws a connector across the whole letter.)"""
    ax0, ax1 = a.pts[:, 0].min(), a.pts[:, 0].max()
    bx0, bx1 = b.pts[:, 0].min(), b.pts[:, 0].max()
    end_right = a.pts[-1, 0] >= ax0 + 0.6 * (ax1 - ax0)
    start_left = b.pts[0, 0] <= bx0 + 0.4 * (bx1 - bx0)
    hop = float(np.hypot(*(b.pts[0] - a.pts[-1])))
    return end_right and start_left and hop < 0.9 * xh


def _affine(strokes, st: WordStyle, rng):
    slant = st.slant + math.radians(rng.normal(0, 2.0))
    sx = st.sx * math.exp(rng.normal(0, 0.04))
    sy = st.sy * math.exp(rng.normal(0, 0.03))
    out = [np.column_stack([s[:, 0] * sx - s[:, 1] * math.tan(slant), s[:, 1] * sy]) for s in strokes]
    x0 = min(s[:, 0].min() for s in out)
    return [s - np.array([x0, 0.0]) for s in out]


def compose(text: str, pick, rng: np.random.Generator, style: WordStyle | None = None,
            aug_strength: float = 0.6, guides: tuple[float, float] | None = None) -> dict:
    """pick(char) -> Glyph. Returns a fixture word dict plus a "meta" entry."""
    st = style or sample_style(rng)
    if guides is None:
        xh = float(rng.uniform(44, 72))
        baseline = float(rng.uniform(140, 220))
    else:
        baseline, xh = guides
    size = st.scale * xh
    x_cursor = float(rng.uniform(20, 90))
    drift = 0.0
    letters_items: list[list[_Item]] = []
    for j, ch in enumerate(text):
        g: Glyph = pick(ch)
        strokes, roles = augment(g, rng, strength=aug_strength, affine=False)
        strokes = _affine(strokes, st, rng)
        s_letter = size * math.exp(rng.normal(0, 0.04))
        drift = float(np.clip(drift + rng.normal(0, 0.035), -0.15, 0.15))
        gap = st.gap + rng.normal(0, 0.07)
        if ch in ",.":
            gap = min(gap, 0.12) - 0.05
        if j == 0:
            gap = 0.0
        px = [np.column_stack([s[:, 0] * s_letter + x_cursor + gap * size * (j > 0),
                               s[:, 1] * s_letter + baseline + drift * xh]) for s in strokes]
        x_cursor = max(p[:, 0].max() for p in px)
        items = [_Item(p, j, r) for p, r in zip(px, roles)]
        # stroke-order variants inside the letter: crossbar or dot first
        small = [k for k, it in enumerate(items) if it.role in ("dot", "bar")]
        if small and rng.random() < 0.15:
            k = small[0]
            items.insert(0, items.pop(k))
        letters_items.append(items)

    # writing order: letter by letter, dots and crossbars deferred when the writer does that
    order: list[_Item] = []
    deferred: list[_Item] = []
    for items in letters_items:
        for it in items:
            if st.late and it.role in ("dot", "bar"):
                deferred.append(it)
            else:
                order.append(it)
    order += deferred

    # pointer-like sampling, per item, before any joining (so run boundaries stay exact)
    for it in order:
        it.pts = to_pointer_samples(it.pts, rng, st.spacing_px)
        it.runs = [(it.runs[0][0], 0, len(it.pts) - 1)]

    # run-on strokes: the pen continues from the end of one letter into the next letter
    joined = 0
    if st.join_p > 0:
        k = 0
        while k < len(order) - 1:
            a, b = order[k], order[k + 1]
            if (
                b.first_letter == a.last_letter + 1
                and a.role == "main" and b.role == "main"
                and len(a.pts) > 2 and len(b.pts) > 2
                and _runs_on(a, b, xh)
                and text[a.last_letter] not in ",.'!?" and text[b.first_letter] not in ",.'!?"
                and rng.random() < st.join_p
            ):
                p0, p1 = a.pts[-1], b.pts[0]
                mid = (p0 + p1) / 2 + np.array([0.0, rng.normal(0, 0.08) * xh])
                c1 = to_pointer_samples(np.vstack([p0, mid]), rng, st.spacing_px)
                c2 = to_pointer_samples(np.vstack([mid, p1]), rng, st.spacing_px)
                pts = np.vstack([a.pts, c1[1:], c2[1:], b.pts[1:]])
                cut = len(a.pts) + len(c1) - 2  # index of `mid`, shared by both pieces
                base_b = len(a.pts) + len(c1) + len(c2) - 3  # where b's point 0 landed
                runs = a.runs[:-1] + [(a.runs[-1][0], a.runs[-1][1], cut)]
                for q, (L, s0, s1) in enumerate(b.runs):
                    runs.append((L, cut if q == 0 else s0 + base_b, s1 + base_b))
                it = _Item(pts, 0, "main")
                it.runs = runs
                # the connector, from a's last point to b's first: belongs to neither letter's shape
                it.connectors = a.connectors + [(len(a.pts) - 1, base_b)] + [
                    (c0 + base_b, c1 + base_b) for c0, c1 in b.connectors]
                order[k : k + 2] = [it]
                joined += 1
                continue
            k += 1

    strokes = []
    letter_of_stroke = []
    splits = []
    t = 0.0
    for i, it in enumerate(order):
        pts = it.pts
        d = np.concatenate([[0], np.hypot(*np.diff(pts, axis=0).T)]) if len(pts) > 1 else np.zeros(1)
        ts = t + np.cumsum(d / st.speed * 1000.0)
        t = float(ts[-1]) + float(rng.uniform(80, 350))
        strokes.append({"points": [[round(float(x), 2), round(float(y), 2), 0.5, round(float(tt), 1)]
                                   for (x, y), tt in zip(pts, ts)]})
        letter_of_stroke.append(int(it.runs[-1][0]))
        for k, ((L0, _, e0), (L1, s1, _)) in enumerate(zip(it.runs[:-1], it.runs[1:])):
            c0, c1 = it.connectors[k]
            splits.append({"stroke": i, "atPoint": int(s1), "left": int(L0), "right": int(L1),
                           "range": [int(c0), int(c1)]})
    ink = np.concatenate([it.pts for it in order])
    return {
        "text": text,
        "guides": {"baseline": round(baseline, 2), "xHeight": round(xh, 2)},
        "strokes": strokes,
        "letterOfStroke": letter_of_stroke,
        "splits": splits,
        "meta": {
            "gap": round(st.gap, 3),
            "touching": bool(st.gap < 0.02),
            "late": st.late,
            "joined": joined,
            "scale": round(st.scale, 3),
            "inkWidthXh": round(float(np.ptp(ink[:, 0]) / xh), 3),
        },
    }
