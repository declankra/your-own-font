"""The four ∅ ("not exactly one letter") types of docs/letter-model.md §4, built from
neighbouring letters rather than noise:

  merged    two adjacent letters as one group
  cut       a letter cut at 25-75% of its width (left or right part)
  fragment  a letter plus a fragment of its neighbour
  missing   a letter missing a component that holds >= 30% of its ink

All in the glyph frame (x-height units, y down, baseline 0), before placement on guides.
"""
from __future__ import annotations

import numpy as np

from .augment import path_len

TYPES = ("merged", "cut", "fragment", "missing")


def _clip_x(strokes: list[np.ndarray], lo: float, hi: float) -> list[np.ndarray]:
    """Keep the parts of each polyline with lo <= x <= hi, splitting where it leaves."""
    out = []
    for s in strokes:
        inside = (s[:, 0] >= lo) & (s[:, 0] <= hi)
        cur: list[np.ndarray] = []
        for k in range(len(s)):
            if inside[k]:
                cur.append(s[k])
            elif cur:
                if len(cur) >= 2:
                    out.append(np.array(cur))
                cur = []
        if len(cur) >= 2:
            out.append(np.array(cur))
    return out


def _ink(strokes) -> float:
    return sum(path_len(s) for s in strokes)


def _place_pair(a: list[np.ndarray], b: list[np.ndarray], gap: float):
    ax1 = max(s[:, 0].max() for s in a)
    bx0 = min(s[:, 0].min() for s in b)
    return a, [s + np.array([ax1 + gap - bx0, 0.0]) for s in b]


def merged(a, b, rng) -> list[np.ndarray]:
    gap = rng.uniform(-0.15, 0.45)
    a2, b2 = _place_pair(a, b, gap)
    return a2 + b2


def cut(a, rng) -> list[np.ndarray] | None:
    p = np.concatenate(a)
    x0, x1 = p[:, 0].min(), p[:, 0].max()
    if x1 - x0 < 0.3:
        return None
    f = rng.uniform(0.25, 0.75)
    xc = x0 + f * (x1 - x0)
    part = _clip_x(a, -1e9, xc) if rng.random() < 0.5 else _clip_x(a, xc, 1e9)
    if not part or _ink(part) < 0.2 * _ink(a) or _ink(part) > 0.85 * _ink(a):
        return None
    return part


def fragment(a, b, rng, b_is_left: bool) -> list[np.ndarray] | None:
    """a plus the adjacent 15-45% (by width) of neighbour b, or one of b's strokes."""
    gap = rng.uniform(-0.1, 0.35)
    if b_is_left:
        b2, a2 = _place_pair(b, a, gap)
    else:
        a2, b2 = _place_pair(a, b, gap)
    if len(b2) > 1 and rng.random() < 0.35:
        k = int(rng.integers(len(b2)))
        frag = [b2[k]]
    else:
        p = np.concatenate(b2)
        x0, x1 = p[:, 0].min(), p[:, 0].max()
        f = rng.uniform(0.15, 0.45) * (x1 - x0)
        frag = _clip_x(b2, x1 - f, 1e9) if b_is_left else _clip_x(b2, -1e9, x0 + f)
    if not frag or _ink(frag) < 0.08 * _ink(b2):
        return None
    return a2 + frag


def missing(a, rng) -> list[np.ndarray] | None:
    """Drop >= 30% of the ink: a whole stroke when one is big enough, otherwise the start or
    the end of the pen path (a letter not finished, or started late)."""
    total = _ink(a)
    if total <= 0:
        return None
    big = [k for k, s in enumerate(a) if path_len(s) >= 0.3 * total]
    if len(a) > 1 and big and rng.random() < 0.6:
        k = int(rng.choice(big))
        rest = [s for q, s in enumerate(a) if q != k]
        return rest if rest else None
    # trim a contiguous 30-65% of the whole pen path, from the end (or the start)
    frac = rng.uniform(0.3, 0.65)
    from_end = rng.random() < 0.75
    keep_len = (1 - frac) * total
    seq = a if from_end else [s[::-1] for s in a[::-1]]
    out = []
    acc = 0.0
    for s in seq:
        L = path_len(s)
        if acc + L <= keep_len:
            out.append(s)
            acc += L
            continue
        need = keep_len - acc
        if need > 0.02 and len(s) >= 2:
            seg = np.hypot(*np.diff(s, axis=0).T)
            cum = np.concatenate([[0], np.cumsum(seg)])
            m = int(np.searchsorted(cum, need)) + 1
            if m >= 2:
                out.append(s[:m])
        break
    if not out:
        return None
    if not from_end:
        out = [s[::-1] for s in out[::-1]]
    return out
