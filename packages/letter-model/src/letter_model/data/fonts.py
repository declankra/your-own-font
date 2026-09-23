"""Single-line font seeds and Omniglot. Every source here passed the licence gate in
packages/letter-model/DATA.md. Nothing is committed: files download into data/raw/fonts and
data/raw/omniglot at prepare time."""
from __future__ import annotations

import math
import re
import urllib.request
import zipfile
from pathlib import Path

import numpy as np

HERSHEY_URL = "https://raw.githubusercontent.com/kamalmostafa/hershey-fonts/master/hershey-fonts/{}.jhf"
HERSHEY_NOTICE = "https://raw.githubusercontent.com/kamalmostafa/hershey-fonts/master/hershey-fonts/hershey.txt"
EMS_URL = "https://gitlab.com/oskay/svg-fonts/-/raw/master/fonts/EMS/{}.svg"
RELIEF_URL = "https://raw.githubusercontent.com/isdat-type/Relief-SingleLine/main/fonts/open_svg/ReliefSingleLineSVG-Regular.svg"
CUTLINGS_URL = "https://raw.githubusercontent.com/ewraj/CNC-Plotter/HEAD/docs/fonts/Cutlings/CutlingsSingularis.svg"
OMNIGLOT_URL = "https://raw.githubusercontent.com/brendenlake/omniglot/master/python/strokes_background.zip"

HERSHEY = ["rowmans", "scripts"]
EMS = ["EMSCasualHand", "EMSTech", "EMSDelight", "EMSPancakes", "EMSNeato", "EMSBird",
       "EMSFelix", "EMSAllure", "EMSPepita", "EMSReadability", "EMSReadabilityItalic",
       "EMSNixish", "EMSHerculean"]
WANTED = set("abcdefghijklmnopqrstuvwxyz,.'!?")


def _get(url: str, path: Path) -> Path:
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        urllib.request.urlretrieve(url, path)
    return path


def download(raw: Path) -> None:
    d = raw / "fonts"
    for f in HERSHEY:
        _get(HERSHEY_URL.format(f), d / f"hershey-{f}.jhf")
    _get(HERSHEY_NOTICE, d / "hershey.txt")
    for f in EMS:
        _get(EMS_URL.format(f), d / f"{f}.svg")
    _get(RELIEF_URL, d / "ReliefSingleLine.svg")
    _get(CUTLINGS_URL, d / "CutlingsSingularis.svg")
    z = _get(OMNIGLOT_URL, raw / "omniglot" / "strokes_background.zip")
    if not (raw / "omniglot" / "strokes_background" / "Latin").exists():
        with zipfile.ZipFile(z) as zf:
            zf.extractall(raw / "omniglot", [n for n in zf.namelist() if "/Latin/" in n])


# ------------------------------------------------------------------------ normalisation
def normalise_font(glyphs: dict[str, list[np.ndarray]]) -> dict[str, list[np.ndarray]]:
    """y down in; out: x-height units, baseline 0, from the font's own 'x'."""
    xs = np.concatenate(glyphs["x"])
    base = xs[:, 1].max()
    xh = base - xs[:, 1].min()
    out = {}
    for ch, strokes in glyphs.items():
        s2 = [np.column_stack([(s[:, 0]) / xh, (s[:, 1] - base) / xh]) for s in strokes if len(s)]
        if not s2:
            continue
        x0 = min(s[:, 0].min() for s in s2)
        out[ch] = [s - np.array([x0, 0.0]) for s in s2]
    return out


# ------------------------------------------------------------------------ Hershey .jhf
def parse_jhf(path: Path) -> dict[str, list[np.ndarray]]:
    lines = path.read_text(encoding="latin-1").splitlines()
    recs = []
    i = 0
    while i < len(lines):
        ln = lines[i]
        if not ln.strip():
            i += 1
            continue
        n = int(ln[5:8])
        need = 8 + 2 * n
        while len(ln) < need and i + 1 < len(lines):
            i += 1
            ln += lines[i]
        recs.append(ln[:need])
        i += 1
    out = {}
    for k, rec in enumerate(recs):
        ch = chr(32 + k)
        if ch not in WANTED:
            continue
        body = rec[10:]  # skip the left/right bounds pair
        strokes, cur = [], []
        for j in range(0, len(body) - 1, 2):
            pair = body[j : j + 2]
            if pair == " R":
                if cur:
                    strokes.append(np.array(cur, float))
                cur = []
                continue
            cur.append((ord(pair[0]) - ord("R"), ord(pair[1]) - ord("R")))
        if cur:
            strokes.append(np.array(cur, float))
        out[ch] = _densify(strokes, 0.5)
    return out


def _densify(strokes, step):
    out = []
    for s in strokes:
        if len(s) < 2:
            out.append(s)
            continue
        pts = [s[0]]
        for a, b in zip(s[:-1], s[1:]):
            n = max(1, int(np.hypot(*(b - a)) / step))
            for k in range(1, n + 1):
                pts.append(a + (b - a) * k / n)
        out.append(np.array(pts))
    return out


# ------------------------------------------------------------------------ SVG fonts
_NUM = r"[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?"


def svg_path(d: str, step: float) -> list[np.ndarray]:
    """Absolute polylines from an SVG path (M L H V C S Q T Z, upper and lower case)."""
    toks = re.findall(r"[MmLlHhVvCcSsQqTtZzAa]|" + _NUM, d)
    strokes: list[list] = []
    cur: list = []
    x = y = 0.0
    sx = sy = 0.0
    lc = None  # last control point for S/T
    cmd = None
    i = 0

    def line_to(nx, ny):
        nonlocal x, y
        n = max(1, int(math.hypot(nx - x, ny - y) / step))
        for k in range(1, n + 1):
            cur.append((x + (nx - x) * k / n, y + (ny - y) * k / n))
        x, y = nx, ny

    def bez(pts):
        nonlocal x, y
        p = np.array([(x, y)] + pts)
        approx = float(np.sum(np.hypot(*np.diff(p, axis=0).T)))
        n = max(2, int(approx / step))
        for k in range(1, n + 1):
            u = k / n
            if len(p) == 4:
                q = (1 - u) ** 3 * p[0] + 3 * (1 - u) ** 2 * u * p[1] + 3 * (1 - u) * u ** 2 * p[2] + u ** 3 * p[3]
            else:
                q = (1 - u) ** 2 * p[0] + 2 * (1 - u) * u * p[1] + u ** 2 * p[2]
            cur.append((float(q[0]), float(q[1])))
        x, y = float(p[-1][0]), float(p[-1][1])

    def num():
        nonlocal i
        v = float(toks[i])
        i += 1
        return v

    while i < len(toks):
        t = toks[i]
        if re.fullmatch(r"[A-Za-z]", t):
            cmd = t
            i += 1
            if cmd in "Zz":
                if cur:
                    line_to(sx, sy)
                    strokes.append(cur)
                    cur = []
                lc = None
                continue
        rel = cmd.islower()
        c = cmd.upper()
        ox, oy = (x, y) if rel else (0.0, 0.0)
        if c == "M":
            if cur:
                strokes.append(cur)
            nx, ny = num() + ox, num() + oy
            x, y, sx, sy = nx, ny, nx, ny
            cur = [(x, y)]
            cmd = "l" if rel else "L"
            lc = None
        elif c == "L":
            line_to(num() + ox, num() + oy)
            lc = None
        elif c == "H":
            line_to(num() + ox, y)
            lc = None
        elif c == "V":
            line_to(x, num() + oy)
            lc = None
        elif c == "C":
            p1 = (num() + ox, num() + oy)
            p2 = (num() + ox, num() + oy)
            p3 = (num() + ox, num() + oy)
            bez([p1, p2, p3])
            lc = ("C", p2)
        elif c == "S":
            p1 = (2 * x - lc[1][0], 2 * y - lc[1][1]) if lc and lc[0] == "C" else (x, y)
            p2 = (num() + ox, num() + oy)
            p3 = (num() + ox, num() + oy)
            bez([p1, p2, p3])
            lc = ("C", p2)
        elif c == "Q":
            p1 = (num() + ox, num() + oy)
            p2 = (num() + ox, num() + oy)
            bez([p1, p2])
            lc = ("Q", p1)
        elif c == "T":
            p1 = (2 * x - lc[1][0], 2 * y - lc[1][1]) if lc and lc[0] == "Q" else (x, y)
            p2 = (num() + ox, num() + oy)
            bez([p1, p2])
            lc = ("Q", p1)
        elif c == "A":  # rare in these fonts: approximate with a straight line
            for _ in range(5):
                num()
            line_to(num() + ox, num() + oy)
            lc = None
        else:
            i += 1
    if cur:
        strokes.append(cur)
    return [np.array(s) for s in strokes if len(s)]


def parse_svg_font(path: Path) -> dict[str, list[np.ndarray]]:
    src = path.read_text(encoding="utf-8")
    m = re.search(r'units-per-em="([\d.]+)"', src)
    upm = float(m.group(1)) if m else 1000.0
    out = {}
    for g in re.finditer(r"<glyph\b([^>]*)/?>", src):
        attrs = g.group(1)
        u = re.search(r'unicode="([^"]*)"', attrs)
        d = re.search(r'\sd="([^"]*)"', attrs)
        if not u or not d:
            continue
        ch = u.group(1).replace("&apos;", "'").replace("&#39;", "'").replace("&#x27;", "'")
        if ch not in WANTED or ch in out:
            continue
        strokes = svg_path(d.group(1), step=upm / 400)
        out[ch] = [np.column_stack([s[:, 0], -s[:, 1]]) for s in strokes]  # y up -> y down
    return out


# ------------------------------------------------------------------------ Omniglot
def omniglot_latin(raw: Path) -> list[tuple[str, str, list[np.ndarray]]]:
    """(char, drawer, strokes) for Omniglot's lowercase Latin (character01 = a ... 26 = z).
    Coordinates come y-up; flipped here to y-down."""
    root = raw / "omniglot" / "strokes_background" / "Latin"
    out = []
    for k in range(26):
        ch = chr(ord("a") + k)
        for f in sorted((root / f"character{k + 1:02d}").glob("*.txt")):
            strokes, cur = [], []
            for ln in f.read_text().splitlines():
                ln = ln.strip()
                if ln == "START":
                    cur = []
                elif ln == "BREAK":
                    if cur:
                        strokes.append(np.array(cur))
                    cur = []
                elif ln:
                    x, y, _t = (float(v) for v in ln.split(","))
                    if not cur or (x, -y) != cur[-1]:
                        cur.append((x, -y))
            if cur:
                strokes.append(np.array(cur))
            drawer = f.stem.split("_")[1]
            out.append((ch, drawer, strokes))
    return out
