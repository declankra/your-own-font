"""Input representation (docs/letter-model.md §3). Mirrors
packages/pipeline/src/letter-model/raster.ts line for line; the parity test holds them to
<= 1/255 per pixel.

Frame: rows span baseline - 2.0*xh (top) .. baseline + 1.0*xh (bottom) in 40 rows, so one
cell is 0.075*xh. Columns use the same cell size, 32 of them (2.4*xh), centred on the
group's ink bounding box. A group wider than 32 cells minus the pen radius on both sides is
squeezed horizontally about its centre; the pen radius is not squeezed.

Pixel value = clamp(r - d + 0.5, 0, 1), d = distance from the pixel centre to the nearest
stroke segment, r = 0.08*xh expressed in cells. A single-point stroke is a disc.
"""
from __future__ import annotations

import math

import numba
import numpy as np

ROWS = 40
COLS = 32
TOP_XH = 2.0  # frame top, in x-heights above the baseline
SPAN_XH = 3.0  # frame height in x-heights
RADIUS_XH = 0.08
N_SCALARS = 7
SCALAR_NAMES = [
    "inkWidth",
    "inkHeight",
    "inkTop",
    "inkBottom",
    "strokeCount",
    "inkLength",
    "squeeze",
]


@numba.njit(cache=True)
def _raster_flat(xs, ys, starts, ends, baseline, xh, out, scal):
    """xs, ys: all points of all strokes, concatenated. Stroke k is [starts[k], ends[k])."""
    n_strokes = starts.shape[0]
    cell = SPAN_XH * xh / ROWS
    r = RADIUS_XH / (SPAN_XH / ROWS)  # radius in cells, independent of xh
    reach = r + 0.5
    # ink bounds and length
    xmin = math.inf
    xmax = -math.inf
    ymin = math.inf
    ymax = -math.inf
    length = 0.0
    count = 0
    for k in range(n_strokes):
        a = starts[k]
        b = ends[k]
        if b <= a:
            continue
        count += 1
        for i in range(a, b):
            x = xs[i]
            y = ys[i]
            if x < xmin:
                xmin = x
            if x > xmax:
                xmax = x
            if y < ymin:
                ymin = y
            if y > ymax:
                ymax = y
            if i > a:
                dx = x - xs[i - 1]
                dy = y - ys[i - 1]
                length += math.sqrt(dx * dx + dy * dy)
    for p in range(ROWS * COLS):
        out[p] = 0.0
    if count == 0:
        for j in range(N_SCALARS):
            scal[j] = 0.0
        return
    ink_w = xmax - xmin
    avail = COLS * cell - 2.0 * RADIUS_XH * xh
    squeeze = 1.0
    if ink_w > avail:
        squeeze = ink_w / avail
    cx = (xmin + xmax) * 0.5
    top = baseline - TOP_XH * xh
    sx = 1.0 / (cell * squeeze)
    sy = 1.0 / cell
    half = COLS * 0.5
    dmin = np.empty(ROWS * COLS)
    for p in range(ROWS * COLS):
        dmin[p] = math.inf
    for k in range(n_strokes):
        a = starts[k]
        b = ends[k]
        if b <= a:
            continue
        last = b - 1 if b - a > 1 else a + 1  # one-point stroke: one degenerate segment
        for i in range(a, last):
            j = i + 1 if b - a > 1 else i
            x0 = (xs[i] - cx) * sx + half
            y0 = (ys[i] - top) * sy
            x1 = (xs[j] - cx) * sx + half
            y1 = (ys[j] - top) * sy
            c0 = int(math.floor(min(x0, x1) - reach))
            c1 = int(math.ceil(max(x0, x1) + reach))
            r0 = int(math.floor(min(y0, y1) - reach))
            r1 = int(math.ceil(max(y0, y1) + reach))
            if c0 < 0:
                c0 = 0
            if r0 < 0:
                r0 = 0
            if c1 > COLS - 1:
                c1 = COLS - 1
            if r1 > ROWS - 1:
                r1 = ROWS - 1
            dx = x1 - x0
            dy = y1 - y0
            l2 = dx * dx + dy * dy
            for row in range(r0, r1 + 1):
                py = row + 0.5
                for col in range(c0, c1 + 1):
                    px = col + 0.5
                    t = 0.0
                    if l2 > 0.0:
                        t = ((px - x0) * dx + (py - y0) * dy) / l2
                        if t < 0.0:
                            t = 0.0
                        elif t > 1.0:
                            t = 1.0
                    qx = x0 + t * dx - px
                    qy = y0 + t * dy - py
                    d2 = qx * qx + qy * qy  # squared: one sqrt per pixel at the end
                    p = row * COLS + col
                    if d2 < dmin[p]:
                        dmin[p] = d2
    for p in range(ROWS * COLS):
        v = r - math.sqrt(dmin[p]) + 0.5
        if v > 1.0:
            v = 1.0
        if v < 0.0:
            v = 0.0
        out[p] = v
    scal[0] = ink_w / xh
    scal[1] = (ymax - ymin) / xh
    scal[2] = (baseline - ymin) / xh
    scal[3] = (baseline - ymax) / xh
    scal[4] = count
    scal[5] = length / xh
    scal[6] = squeeze


def pack(strokes: list[np.ndarray]):
    """Concatenate strokes (each (n, >=2) px, y down) into flat arrays for the kernel."""
    lens = [len(s) for s in strokes]
    starts = np.zeros(len(strokes), np.int64)
    ends = np.zeros(len(strokes), np.int64)
    acc = 0
    for k, n in enumerate(lens):
        starts[k] = acc
        acc += n
        ends[k] = acc
    if acc:
        pts = np.concatenate([np.asarray(s, np.float64)[:, :2] for s in strokes if len(s)])
    else:
        pts = np.zeros((0, 2))
    return np.ascontiguousarray(pts[:, 0]), np.ascontiguousarray(pts[:, 1]), starts, ends


def rasterize(strokes: list[np.ndarray], baseline: float, xh: float):
    """Returns (raster float32 (40, 32), scalars float32 (7,))."""
    xs, ys, st, en = pack(strokes)
    out = np.zeros(ROWS * COLS, np.float64)
    scal = np.zeros(N_SCALARS, np.float64)
    _raster_flat(xs, ys, st, en, float(baseline), float(xh), out, scal)
    return out.reshape(ROWS, COLS).astype(np.float32), scal.astype(np.float32)


@numba.njit(parallel=True, cache=True)
def _raster_batch(xs, ys, starts, ends, sample_stroke0, sample_stroke1, baselines, xhs, out, scal):
    n = sample_stroke0.shape[0]
    for s in numba.prange(n):
        a = sample_stroke0[s]
        b = sample_stroke1[s]
        o = np.empty(ROWS * COLS)
        sc = np.empty(N_SCALARS)
        _raster_flat(xs, ys, starts[a:b], ends[a:b], baselines[s], xhs[s], o, sc)
        for p in range(ROWS * COLS):
            v = o[p] * 255.0 + 0.5
            out[s, p] = np.uint8(v)
        for j in range(N_SCALARS):
            scal[s, j] = sc[j]


def rasterize_batch(samples, baselines, xhs):
    """samples: list of stroke lists. Rasters come back quantised to uint8 (for training
    storage only; inference and parity use the float path)."""
    all_strokes = []
    s0 = np.zeros(len(samples), np.int64)
    s1 = np.zeros(len(samples), np.int64)
    for i, strokes in enumerate(samples):
        s0[i] = len(all_strokes)
        all_strokes.extend(strokes)
        s1[i] = len(all_strokes)
    xs, ys, st, en = pack(all_strokes)
    out = np.zeros((len(samples), ROWS * COLS), np.uint8)
    scal = np.zeros((len(samples), N_SCALARS), np.float32)
    _raster_batch(
        xs, ys, st, en, s0, s1,
        np.asarray(baselines, np.float64), np.asarray(xhs, np.float64), out, scal,
    )
    return out.reshape(-1, ROWS, COLS), scal
