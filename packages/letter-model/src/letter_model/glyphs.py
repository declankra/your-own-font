"""Glyph seeds in a common frame: x-height units, y down, baseline at y = 0 (so the x-height
line is y = -1), ink starting at x = 0. Each glyph keeps its stroke order."""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from .classes import LETTERS, PUNCT
from .data import uji

REAL = set(LETTERS + PUNCT)
X_LETTERS = set("acemnorsuvwxz")


@dataclass
class Glyph:
    char: str
    style: str  # one writer session or one font
    source: str  # "uji" | "house" | "hershey" | "ems" | ...
    strokes: list[np.ndarray]  # (n, 2) float64
    meta: dict = field(default_factory=dict)

    def bounds(self):
        p = np.concatenate(self.strokes)
        return p[:, 0].min(), p[:, 1].min(), p[:, 0].max(), p[:, 1].max()


def normalise_x(strokes: list[np.ndarray]) -> list[np.ndarray]:
    x0 = min(s[:, 0].min() for s in strokes)
    return [s - np.array([x0, 0.0]) for s in strokes]


# ---------------------------------------------------------------- UJI Pen Characters v2
def uji_glyphs(raw_dir: Path) -> list[Glyph]:
    samples = uji.parse(uji.download(raw_dir))
    frame: dict[str, tuple[float, float]] = {}
    by: dict[str, list[tuple[float, float]]] = {}
    for s in samples:
        if s.char in X_LETTERS:
            p = np.concatenate(s.strokes)
            by.setdefault(s.session, []).append((p[:, 1].min(), p[:, 1].max()))
    for sess, v in by.items():
        a = np.array(v)
        frame[sess] = (float(np.median(a[:, 1])), float(np.median(a[:, 1] - a[:, 0])))
    out = []
    for s in samples:
        if s.char not in REAL:
            continue
        base, xh = frame[s.session]
        strokes = [np.column_stack([st[:, 0] / xh, (st[:, 1] - base) / xh]) for st in s.strokes]
        out.append(
            Glyph(s.char, "uji:" + s.session, "uji", normalise_x(strokes), {"writer": s.writer})
        )
    return out


# ---------------------------------------------------------------- the house hand
def _svg_path_points(d: str, step: float = 0.5) -> np.ndarray:
    """Sample an SVG path made of M, L and C commands (absolute), roughly every `step` units."""
    toks = re.findall(r"[MLC]|-?\d*\.?\d+", d)
    pts: list[tuple[float, float]] = []
    i = 0
    cur = (0.0, 0.0)
    cmd = None
    while i < len(toks):
        t = toks[i]
        if t in "MLC":
            cmd = t
            i += 1
            continue
        if cmd == "M":
            cur = (float(toks[i]), float(toks[i + 1]))
            pts.append(cur)
            i += 2
            cmd = "L"
        elif cmd == "L":
            nxt = (float(toks[i]), float(toks[i + 1]))
            n = max(1, int(np.hypot(nxt[0] - cur[0], nxt[1] - cur[1]) / step))
            for k in range(1, n + 1):
                u = k / n
                pts.append((cur[0] + (nxt[0] - cur[0]) * u, cur[1] + (nxt[1] - cur[1]) * u))
            cur = nxt
            i += 2
        elif cmd == "C":
            c = [float(x) for x in toks[i : i + 6]]
            p0, p1, p2, p3 = np.array(cur), np.array(c[0:2]), np.array(c[2:4]), np.array(c[4:6])
            approx = np.linalg.norm(p1 - p0) + np.linalg.norm(p2 - p1) + np.linalg.norm(p3 - p2)
            n = max(2, int(approx / step))
            for k in range(1, n + 1):
                u = k / n
                q = (
                    (1 - u) ** 3 * p0
                    + 3 * (1 - u) ** 2 * u * p1
                    + 3 * (1 - u) * u**2 * p2
                    + u**3 * p3
                )
                pts.append((float(q[0]), float(q[1])))
            cur = (c[4], c[5])
            i += 6
        else:
            raise ValueError(d)
    return np.array(pts)


def house_glyphs(prototype_html: Path) -> list[Glyph]:
    """`const G` in design/homepage-prototype.html: baseline y=100, x-height 50 units."""
    src = prototype_html.read_text(encoding="utf-8")
    block = src[src.index("const G={") : src.index("};", src.index("const G={"))]
    out = []
    for m in re.finditer(r"""(?:^|\s)(\w|"'"|','|'\.'):\{w:(\d+),s:\[(.*?)\]\}""", block, re.M):
        key, _w, body = m.groups()
        ch = key[1] if len(key) == 3 else key  # quoted keys: "'", ',', '.'
        paths = re.findall(r"'([^']*)'", body)
        strokes = []
        for d in paths:
            p = _svg_path_points(d)
            strokes.append(np.column_stack([p[:, 0] / 50.0, (p[:, 1] - 100.0) / 50.0]))
        out.append(Glyph(ch, "house", "house", normalise_x(strokes)))
    return out


# ---------------------------------------------------------------- single-line fonts
FONT_FILES = {
    "hershey:rowmans": "hershey-rowmans.jhf",
    "hershey:scripts": "hershey-scripts.jhf",
    "relief": "ReliefSingleLine.svg",
    "cutlings": "CutlingsSingularis.svg",
}


def font_glyphs(raw_dir: Path) -> list[Glyph]:
    from .data import fonts

    fonts.download(raw_dir)
    files = dict(FONT_FILES)
    for f in fonts.EMS:
        files["ems:" + f[3:]] = f + ".svg"
    out = []
    for style, fname in files.items():
        p = raw_dir / "fonts" / fname
        g = fonts.parse_jhf(p) if fname.endswith(".jhf") else fonts.parse_svg_font(p)
        g = fonts.normalise_font(g)
        for ch in sorted(g):
            out.append(Glyph(ch, "font:" + style, style.split(":")[0], g[ch]))
    return out


# ---------------------------------------------------------------- Omniglot (no guides)
_PLACE = {}
for _c in "acemnorsuvwxz":
    _PLACE[_c] = ((0.95, 1.05), (0.0, 0.0))
for _c in "bdhkl":
    _PLACE[_c] = ((1.5, 1.9), (0.0, 0.0))
_PLACE["f"] = ((1.5, 1.9), (0.0, 0.0))
_PLACE["t"] = ((1.3, 1.6), (0.0, 0.0))
_PLACE["i"] = ((1.4, 1.7), (0.0, 0.0))
for _c in "gpqy":
    _PLACE[_c] = ((0.95, 1.05), (-0.9, -0.6))
_PLACE["j"] = ((1.4, 1.7), (-0.9, -0.6))


def omniglot_glyphs(raw_dir: Path) -> list[Glyph]:
    """Guide-less: placed per class (docs/letter-model.md §4). Deterministic per sample."""
    from .data import fonts

    out = []
    for k, (ch, drawer, strokes) in enumerate(fonts.omniglot_latin(raw_dir)):
        rng = np.random.default_rng(1000 + k)
        (t0, t1), (b0, b1) = _PLACE[ch]
        top = rng.uniform(t0, t1)
        bottom = rng.uniform(b0, b1) if b0 < 0 else 0.0
        p = np.concatenate(strokes)
        h = p[:, 1].max() - p[:, 1].min()
        if h <= 0:
            continue
        sc = (top - bottom) / h
        ybot = p[:, 1].max()
        s2 = [np.column_stack([s[:, 0] * sc, (s[:, 1] - ybot) * sc - bottom]) for s in strokes]
        out.append(Glyph(ch, f"omniglot:{drawer}", "omniglot", normalise_x(s2), {"writer": drawer}))
    return out
