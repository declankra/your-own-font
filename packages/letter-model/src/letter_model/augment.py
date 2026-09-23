"""Online-stroke augmentation (docs/letter-model.md §4). Works in the glyph frame: x-height
units, y down, baseline at 0."""
from __future__ import annotations

import math

import numpy as np

from .glyphs import Glyph

DOT_CHARS = set("ij!?")
BAR_CHARS = set("tf")
BOWL_CHARS = set("aogdq")


def path_len(s: np.ndarray) -> float:
    if len(s) < 2:
        return 0.0
    return float(np.sum(np.hypot(*np.diff(s, axis=0).T)))


def component_roles(g: Glyph) -> list[str]:
    """Label each stroke 'dot', 'bar' or 'main'. Dots belong to i j ! ?, bars to t f."""
    roles = ["main"] * len(g.strokes)
    if len(g.strokes) < 2:
        return roles
    if g.char in DOT_CHARS:
        sizes = [max(np.ptp(s[:, 0]), np.ptp(s[:, 1])) for s in g.strokes]
        k = int(np.argmin(sizes))
        if sizes[k] < 0.4:
            roles[k] = "dot"
    elif g.char in BAR_CHARS:
        best, bk = 0.0, -1
        for k, s in enumerate(g.strokes):
            w, h = np.ptp(s[:, 0]), np.ptp(s[:, 1])
            if h < 0.35 and w > 0.3 and w / max(h, 1e-3) > best:
                best, bk = w / max(h, 1e-3), k
        if bk >= 0 and best > 2.5:
            roles[bk] = "bar"
    return roles


def _elastic(strokes: list[np.ndarray], rng: np.random.Generator, amp: float) -> list[np.ndarray]:
    """Smooth displacement field: a few random low-frequency sinusoids."""
    terms = []
    for _ in range(3):
        k = rng.uniform(1.0, 3.0) * 2 * math.pi / 2.0
        th = rng.uniform(0, 2 * math.pi)
        ph = rng.uniform(0, 2 * math.pi)
        terms.append((k * math.cos(th), k * math.sin(th), ph, rng.normal(0, amp, 2)))
    out = []
    for s in strokes:
        d = np.zeros_like(s)
        for kx, ky, ph, a in terms:
            w = np.sin(s[:, 0] * kx + s[:, 1] * ky + ph)
            d += w[:, None] * a[None, :]
        out.append(s + d)
    return out


def _trim(s: np.ndarray, start_frac: float, end_frac: float) -> np.ndarray:
    """Keep the part of a polyline between fractions of its length."""
    if len(s) < 3:
        return s
    seg = np.hypot(*np.diff(s, axis=0).T)
    cum = np.concatenate([[0], np.cumsum(seg)])
    L = cum[-1]
    if L <= 0:
        return s
    a, b = start_frac * L, end_frac * L
    keep = (cum >= a) & (cum <= b)
    if keep.sum() < 2:
        return s
    return s[keep]


def _extend(s: np.ndarray, amount: float, at_end: bool) -> np.ndarray:
    if len(s) < 2 or amount == 0:
        return s
    if at_end:
        d = s[-1] - s[-2]
    else:
        d = s[0] - s[1]
    n = np.linalg.norm(d)
    if n < 1e-9:
        return s
    p = (s[-1] if at_end else s[0]) + d / n * amount
    return np.vstack([s, p]) if at_end else np.vstack([p, s])


def place_punct(strokes: list[np.ndarray], ch: str, rng: np.random.Generator) -> list[np.ndarray]:
    """Guide-less sources put punctuation anywhere in their box. Put it where our guides
    ask for it: on the baseline, or in the upper band for an apostrophe (§4)."""
    p = np.concatenate(strokes)
    top, bottom = -p[:, 1].min(), -p[:, 1].max()  # heights above the baseline
    if ch == ".":
        dy = rng.uniform(-0.05, 0.12) - bottom
    elif ch == ",":
        dy = rng.uniform(0.05, 0.35) - top
    elif ch == "'":
        dy = rng.uniform(1.5, 1.95) - top
    elif ch in "!?":
        dy = rng.uniform(-0.08, 0.08) - bottom
    else:
        return strokes
    return [s - np.array([0.0, dy]) for s in strokes]


def augment(g: Glyph, rng: np.random.Generator, strength: float = 1.0,
            allow_drop: bool = True, affine: bool = True) -> tuple[list[np.ndarray], list[str]]:
    """Returns augmented strokes (glyph frame) and their roles, in writing order."""
    roles = component_roles(g)
    strokes = place_punct([s.copy() for s in g.strokes], g.char, rng)
    # drop a dot / crossbar: a dotless i or uncrossed t is still that letter
    if allow_drop and len(strokes) > 1:
        small = [k for k, r in enumerate(roles) if r in ("dot", "bar") and g.char in "ijt"]
        if small and rng.random() < 0.08 * strength:
            k = small[0]
            strokes.pop(k)
            roles.pop(k)
    # open bowls
    if g.char in BOWL_CHARS and rng.random() < 0.3 * strength:
        k = int(np.argmax([path_len(s) for s in strokes]))
        strokes[k] = _trim(strokes[k], 0.0, 1.0 - rng.uniform(0.04, 0.14))
    # overshoot / undershoot where strokes meet
    for k in range(len(strokes)):
        if rng.random() < 0.3 * strength:
            strokes[k] = _extend(strokes[k], rng.uniform(-0.02, 0.12), at_end=bool(rng.random() < 0.5))
        if k > 0 and roles[k] == "main" and rng.random() < 0.5 * strength:
            strokes[k] = strokes[k] + rng.normal(0, 0.04 * strength, 2)
    # dots drift, bars slide
    for k, r in enumerate(roles):
        if r == "dot":
            c = strokes[k].mean(0)
            off = np.array([rng.uniform(-0.18, 0.25), rng.uniform(-0.15, 0.2)]) * strength
            if rng.random() < 0.5:  # a tap
                strokes[k] = (c + off)[None, :]
            else:
                ang = rng.uniform(-1.2, 0.3)
                ln = rng.uniform(0.02, 0.14)
                v = np.array([math.cos(ang), math.sin(ang)]) * ln / 2
                strokes[k] = np.vstack([c + off - v, c + off + v])
        elif r == "bar":
            strokes[k] = strokes[k] + np.array([rng.uniform(-0.15, 0.2), rng.uniform(-0.12, 0.12)]) * strength
            if rng.random() < 0.3:
                strokes[k] = _extend(strokes[k], rng.uniform(0, 0.3), at_end=True)
    # split a stroke into two pen lifts
    if rng.random() < 0.15 * strength:
        cand = [k for k, s in enumerate(strokes) if path_len(s) > 1.0 and len(s) > 6]
        if cand:
            k = int(rng.choice(cand))
            s = strokes[k]
            cut = int(len(s) * rng.uniform(0.3, 0.7))
            gap = int(rng.integers(0, 2))
            a, b = s[: cut + 1], s[cut + gap :]
            if len(a) >= 2 and len(b) >= 2:
                strokes[k : k + 1] = [a, b]
                roles[k : k + 1] = [roles[k], roles[k]]
    strokes = _elastic(strokes, rng, 0.035 * strength)
    if not affine:  # the caller applies one word-level affine
        x0 = min(s[:, 0].min() for s in strokes)
        return [s - np.array([x0, 0.0]) for s in strokes], roles
    # affine: slant, x-scale, y-scale, small rotation
    slant = math.radians(rng.uniform(-15, 20) * strength)
    sx = math.exp(rng.uniform(math.log(0.8), math.log(1.25)) * strength)
    sy = math.exp(rng.normal(0, 0.06) * strength)
    rot = math.radians(rng.normal(0, 2.5) * strength)
    cr, sr = math.cos(rot), math.sin(rot)
    out = []
    for s in strokes:
        x = s[:, 0] * sx - s[:, 1] * math.tan(slant)
        y = s[:, 1] * sy
        out.append(np.column_stack([x * cr - y * sr, x * sr + y * cr]))
    x0 = min(s[:, 0].min() for s in out)
    out = [s - np.array([x0, 0.0]) for s in out]
    return out, roles


def to_pointer_samples(stroke_px: np.ndarray, rng: np.random.Generator, spacing: float) -> np.ndarray:
    """Resample a dense polyline (px) like pointer events: roughly even spacing with jitter,
    always keeping the first and last point. A one-point stroke stays one point."""
    if len(stroke_px) < 2:
        return stroke_px.copy()
    seg = np.hypot(*np.diff(stroke_px, axis=0).T)
    cum = np.concatenate([[0], np.cumsum(seg)])
    L = cum[-1]
    if L < spacing:
        return stroke_px[[0, -1]] if L > 0.6 else stroke_px[[0]]
    ds = spacing * rng.uniform(0.7, 1.3, size=int(L / spacing * 1.5) + 4)
    t = np.cumsum(ds)
    t = t[t < L - 0.3 * spacing]
    t = np.concatenate([[0], t, [L]])
    x = np.interp(t, cum, stroke_px[:, 0])
    y = np.interp(t, cum, stroke_px[:, 1])
    return np.column_stack([x, y])
