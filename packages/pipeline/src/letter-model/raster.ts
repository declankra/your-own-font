// Input representation (docs/letter-model.md §3). Mirrors
// packages/letter-model/src/letter_model/raster.py line for line; the parity test holds the
// two to <= 1/255 per pixel.
//
// Frame: rows span baseline - 2.0*xh .. baseline + 1.0*xh in 40 rows (one cell = 0.075*xh).
// Columns use the same cell, 32 of them, centred on the group's ink bounding box. A group
// wider than 32 cells minus the pen radius on both sides is squeezed horizontally about its
// centre; the pen radius is not squeezed. Pixel = clamp(r - d + 0.5, 0, 1).

export const ROWS = 40;
export const COLS = 32;
export const TOP_XH = 2.0;
export const SPAN_XH = 3.0;
export const RADIUS_XH = 0.08;
export const N_SCALARS = 7;
export const SCALAR_NAMES = [
  "inkWidth",
  "inkHeight",
  "inkTop",
  "inkBottom",
  "strokeCount",
  "inkLength",
  "squeeze",
] as const;

/** A point is [x, y, ...] in pad pixels, y down. Extra entries (pressure, time) are ignored. */
export type Point = ArrayLike<number>;
export type Polyline = ArrayLike<Point>;

export interface Guides {
  /** y of the baseline, px */
  baseline: number;
  /** x-height, px */
  xHeight: number;
}

/**
 * Rasterize one stroke group. Each polyline is one pen-down..pen-up (or a piece of one).
 * Writes into `out` (length 1280) and `scalars` (length 7) and returns them.
 */
export function rasterize(
  strokes: ArrayLike<Polyline>,
  guides: Guides,
  out: Float32Array = new Float32Array(ROWS * COLS),
  scalars: Float32Array = new Float32Array(N_SCALARS),
  dmin: Float64Array = new Float64Array(ROWS * COLS),
): { raster: Float32Array; scalars: Float32Array } {
  const baseline = guides.baseline;
  const xh = guides.xHeight;
  const cell = (SPAN_XH * xh) / ROWS;
  const r = RADIUS_XH / (SPAN_XH / ROWS);
  const reach = r + 0.5;

  let xmin = Infinity;
  let xmax = -Infinity;
  let ymin = Infinity;
  let ymax = -Infinity;
  let length = 0;
  let count = 0;
  for (let k = 0; k < strokes.length; k++) {
    const s = strokes[k];
    if (s.length === 0) continue;
    count++;
    for (let i = 0; i < s.length; i++) {
      const x = s[i][0];
      const y = s[i][1];
      if (x < xmin) xmin = x;
      if (x > xmax) xmax = x;
      if (y < ymin) ymin = y;
      if (y > ymax) ymax = y;
      if (i > 0) {
        const dx = x - s[i - 1][0];
        const dy = y - s[i - 1][1];
        length += Math.sqrt(dx * dx + dy * dy);
      }
    }
  }
  out.fill(0);
  if (count === 0) {
    scalars.fill(0);
    return { raster: out, scalars };
  }
  const inkW = xmax - xmin;
  const avail = COLS * cell - 2.0 * RADIUS_XH * xh;
  let squeeze = 1.0;
  if (inkW > avail) squeeze = inkW / avail;
  const cx = (xmin + xmax) * 0.5;
  const top = baseline - TOP_XH * xh;
  const sx = 1.0 / (cell * squeeze);
  const sy = 1.0 / cell;
  const half = COLS * 0.5;
  dmin.fill(Infinity);

  for (let k = 0; k < strokes.length; k++) {
    const s = strokes[k];
    const n = s.length;
    if (n === 0) continue;
    const last = n > 1 ? n - 1 : 1; // one-point stroke: one degenerate segment
    for (let i = 0; i < last; i++) {
      const j = n > 1 ? i + 1 : i;
      const x0 = (s[i][0] - cx) * sx + half;
      const y0 = (s[i][1] - top) * sy;
      const x1 = (s[j][0] - cx) * sx + half;
      const y1 = (s[j][1] - top) * sy;
      let c0 = Math.floor(Math.min(x0, x1) - reach);
      let c1 = Math.ceil(Math.max(x0, x1) + reach);
      let r0 = Math.floor(Math.min(y0, y1) - reach);
      let r1 = Math.ceil(Math.max(y0, y1) + reach);
      if (c0 < 0) c0 = 0;
      if (r0 < 0) r0 = 0;
      if (c1 > COLS - 1) c1 = COLS - 1;
      if (r1 > ROWS - 1) r1 = ROWS - 1;
      const dx = x1 - x0;
      const dy = y1 - y0;
      const l2 = dx * dx + dy * dy;
      for (let row = r0; row <= r1; row++) {
        const py = row + 0.5;
        for (let col = c0; col <= c1; col++) {
          const px = col + 0.5;
          let t = 0.0;
          if (l2 > 0.0) {
            t = ((px - x0) * dx + (py - y0) * dy) / l2;
            if (t < 0.0) t = 0.0;
            else if (t > 1.0) t = 1.0;
          }
          const qx = x0 + t * dx - px;
          const qy = y0 + t * dy - py;
          const d2 = qx * qx + qy * qy; // squared: one sqrt per pixel at the end
          const p = row * COLS + col;
          if (d2 < dmin[p]) dmin[p] = d2;
        }
      }
    }
  }
  for (let p = 0; p < ROWS * COLS; p++) {
    let v = r - Math.sqrt(dmin[p]) + 0.5;
    if (v > 1.0) v = 1.0;
    if (v < 0.0) v = 0.0;
    out[p] = v;
  }
  scalars[0] = inkW / xh;
  scalars[1] = (ymax - ymin) / xh;
  scalars[2] = (baseline - ymin) / xh;
  scalars[3] = (baseline - ymax) / xh;
  scalars[4] = count;
  scalars[5] = length / xh;
  scalars[6] = squeeze;
  return { raster: out, scalars };
}
