// Strokes → one smooth outline per glyph (SPEC.md §7 "Cast").
//
// 1. perfect-freehand turns each stroke into an outline polygon, with the same pen as the pad.
// 2. polygon-clipping unions the polygons, so a t is one contour and a loop is not a hole.
//    Its rings follow the non-zero rule, like the SVG the pad draws, so nothing changes shape.
// 3. fit-curve replaces each ring's polyline with cubic Béziers, split at sharp corners.

import fitCurve from "fit-curve";
import polygonClipping, { type MultiPolygon, type Polygon } from "polygon-clipping";
import { XH, strokeOutline } from "./pen.ts";
import type { Bounds, InkStroke } from "./types.ts";

export type Pt = [number, number];
/** A closed contour of cubic segments: start point, then [c1, c2, end] per segment. */
export interface Contour {
  start: Pt;
  curves: [Pt, Pt, Pt][];
}

const ROUND = 1 / 16;
const q = (v: number) => Math.round(v / ROUND) * ROUND;

function cleanRing(poly: number[][]): Pt[] {
  const out: Pt[] = [];
  for (const p of poly) {
    if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
    const pt: Pt = [q(p[0]), q(p[1])];
    const last = out[out.length - 1];
    if (last && last[0] === pt[0] && last[1] === pt[1]) continue;
    out.push(pt);
  }
  while (out.length > 1 && out[0][0] === out[out.length - 1][0] && out[0][1] === out[out.length - 1][1]) out.pop();
  return out;
}

/**
 * The union of a glyph's stroke outlines. Returns rings (glyph units, y down, not closed).
 * If polygon-clipping fails on degenerate input, the stroke outlines are kept as separate
 * contours: CFF fills overlapping contours with the non-zero rule, so the glyph looks the same.
 */
export function unionOutlines(strokes: InkStroke[]): Pt[][] {
  const polys: Polygon[] = [];
  for (const s of strokes) {
    if (!s.points.length) continue;
    const ring = cleanRing(strokeOutline(s.points, XH, s.pen, true));
    if (ring.length < 3) continue;
    polys.push([[...ring, ring[0]]]);
  }
  if (!polys.length) return [];
  let mp: MultiPolygon;
  try {
    mp = polys.length === 1 ? polygonClipping.union(polys[0]) : polygonClipping.union(polys[0], ...polys.slice(1));
  } catch {
    try {
      // one at a time, so a single bad stroke only loses its own union
      mp = [polys[0]];
      for (let i = 1; i < polys.length; i++) {
        try {
          mp = polygonClipping.union(mp, polys[i]);
        } catch {
          mp = [...mp, polys[i]];
        }
      }
    } catch {
      mp = polys;
    }
  }
  const rings: Pt[][] = [];
  for (const poly of mp)
    for (const ring of poly) {
      const r = cleanRing(ring);
      if (r.length >= 3 && Math.abs(signedArea(r)) > 1) rings.push(r);
    }
  return rings;
}

export function signedArea(r: Pt[]): number {
  let a = 0;
  for (let i = 0; i < r.length; i++) {
    const [x0, y0] = r[i];
    const [x1, y1] = r[(i + 1) % r.length];
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
}

/** Indices of sharp corners: where the direction turns more than `deg` over a short reach. */
function corners(r: Pt[], deg = 55): number[] {
  const n = r.length;
  const out: number[] = [];
  const cos = Math.cos((deg * Math.PI) / 180);
  const dir = (a: Pt, b: Pt) => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l = Math.hypot(dx, dy) || 1;
    return [dx / l, dy / l];
  };
  // reach ~ a few units along the ring each way, so polyline noise isn't a corner
  const back = (i: number) => {
    let d = 0;
    let j = i;
    while (d < 6 && (i - j + n) % n < n - 1) {
      const k = (j - 1 + n) % n;
      d += Math.hypot(r[j][0] - r[k][0], r[j][1] - r[k][1]);
      j = k;
    }
    return j;
  };
  const fwd = (i: number) => {
    let d = 0;
    let j = i;
    while (d < 6 && (j - i + n) % n < n - 1) {
      const k = (j + 1) % n;
      d += Math.hypot(r[j][0] - r[k][0], r[j][1] - r[k][1]);
      j = k;
    }
    return j;
  };
  const turn: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = dir(r[back(i)], r[i]);
    const b = dir(r[i], r[fwd(i)]);
    turn.push(a[0] * b[0] + a[1] * b[1]);
  }
  for (let i = 0; i < n; i++) {
    if (turn[i] > cos) continue;
    // local maximum of turning only
    const p = turn[(i - 1 + n) % n];
    const nx = turn[(i + 1) % n];
    if (turn[i] <= p && turn[i] <= nx) out.push(i);
  }
  // no two corners closer than 3 points
  return out.filter((c, k) => k === 0 || c - out[k - 1] >= 3);
}

/**
 * Fit cubic Béziers to a closed ring. `maxError` is fit-curve's squared distance tolerance in
 * glyph units (9 = 3 units = 0.3% of an em: invisible, and a fraction of the polyline's points).
 */
export function fitRing(r: Pt[], maxError = 9): Contour {
  const n = r.length;
  const cs = corners(r);
  let start: number;
  let cuts: number[];
  if (cs.length) {
    start = cs[0];
    cuts = cs.map((c) => (c - start + n) % n).concat(n);
  } else {
    // start on the leftmost point, where a ring's tangent is vertical and a seam won't show
    start = 0;
    for (let i = 1; i < n; i++) if (r[i][0] < r[start][0]) start = i;
    cuts = [0, n];
  }
  const at = (k: number) => r[(start + k) % n];
  const contour: Contour = { start: at(0), curves: [] };
  for (let s = 0; s + 1 < cuts.length; s++) {
    const a = cuts[s];
    const b = cuts[s + 1];
    const seg: Pt[] = [];
    for (let k = a; k <= b; k++) seg.push(at(k));
    if (seg.length === 2) {
      const [p0, p1] = seg;
      contour.curves.push([lerp(p0, p1, 1 / 3), lerp(p0, p1, 2 / 3), p1]);
      continue;
    }
    contour.curves.push(...fitSegment(seg, maxError, 0));
  }
  return contour;
}

/** How far a fitted curve may stray outside the points it replaces, in glyph units. */
const STRAY = 4;

/**
 * fit-curve, checked. At a cusp (a pen that retraces its own stem, like the first leg of an m)
 * the fit can overshoot into a long thin spike. A fit that leaves its points' bounding box is
 * redone in two halves split at the sharpest turn; if that still fails, the points are kept as
 * straight segments, which at this density look the same.
 */
function fitSegment(seg: Pt[], maxError: number, depth: number): [Pt, Pt, Pt][] {
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const [x, y] of seg) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  const curves = fitCurve(seg, maxError).map((c) => [c[0] as Pt, c[1] as Pt, c[2] as Pt, c[3] as Pt] as const);
  const ok = curves.every(([p0, c1, c2, e]) => {
    for (let k = 1; k < 8; k++) {
      const [x, y] = cubicAt(p0, c1, c2, e, k / 8);
      if (!(x >= x0 - STRAY && x <= x1 + STRAY && y >= y0 - STRAY && y <= y1 + STRAY)) return false;
    }
    return true;
  });
  if (ok) return curves.map(([, c1, c2, e]) => [c1, c2, e]);
  if (depth < 4 && seg.length >= 6) {
    // split at the sharpest turn inside the segment
    let at = Math.floor(seg.length / 2);
    let worst = 2;
    for (let i = 2; i < seg.length - 2; i++) {
      const ax = seg[i][0] - seg[i - 2][0];
      const ay = seg[i][1] - seg[i - 2][1];
      const bx = seg[i + 2][0] - seg[i][0];
      const by = seg[i + 2][1] - seg[i][1];
      const la = Math.hypot(ax, ay) || 1;
      const lb = Math.hypot(bx, by) || 1;
      const cos = (ax * bx + ay * by) / (la * lb);
      if (cos < worst) {
        worst = cos;
        at = i;
      }
    }
    return [...fitSegment(seg.slice(0, at + 1), maxError, depth + 1), ...fitSegment(seg.slice(at), maxError, depth + 1)];
  }
  const out: [Pt, Pt, Pt][] = [];
  for (let i = 1; i < seg.length; i++) out.push([lerp(seg[i - 1], seg[i], 1 / 3), lerp(seg[i - 1], seg[i], 2 / 3), seg[i]]);
  return out;
}

function lerp(a: Pt, b: Pt, t: number): Pt {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

export function contourBounds(cs: Contour[]): Bounds {
  let xMin = Infinity;
  let xMax = -Infinity;
  let yMin = Infinity;
  let yMax = -Infinity;
  const add = (p: Pt) => {
    if (p[0] < xMin) xMin = p[0];
    if (p[0] > xMax) xMax = p[0];
    if (p[1] < yMin) yMin = p[1];
    if (p[1] > yMax) yMax = p[1];
  };
  for (const c of cs) {
    let p0 = c.start;
    add(p0);
    for (const [c1, c2, e] of c.curves) {
      for (let k = 1; k <= 8; k++) add(cubicAt(p0, c1, c2, e, k / 8));
      p0 = e;
    }
  }
  return { xMin, xMax, yMin, yMax };
}

function cubicAt(p0: Pt, c1: Pt, c2: Pt, e: Pt, t: number): Pt {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return [a * p0[0] + b * c1[0] + c * c2[0] + d * e[0], a * p0[1] + b * c1[1] + c * c2[1] + d * e[1]];
}

export function transformContours(cs: Contour[], f: (p: Pt) => Pt): Contour[] {
  return cs.map((c) => ({ start: f(c.start), curves: c.curves.map(([a, b, e]) => [f(a), f(b), f(e)] as [Pt, Pt, Pt]) }));
}

export function contoursToPath(cs: Contour[]): string {
  const f = (v: number) => (Math.round(v * 10) / 10).toString();
  let d = "";
  for (const c of cs) {
    d += `M${f(c.start[0])} ${f(c.start[1])}`;
    for (const [a, b, e] of c.curves) d += `C${f(a[0])} ${f(a[1])} ${f(b[0])} ${f(b[1])} ${f(e[0])} ${f(e[1])}`;
    d += "Z";
  }
  return d;
}

/** Strokes → smooth contours, the whole Cast step for one glyph. */
export function glyphContours(strokes: InkStroke[]): Contour[] {
  return unionOutlines(strokes).map((r) => fitRing(r));
}
