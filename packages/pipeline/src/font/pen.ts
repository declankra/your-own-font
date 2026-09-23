// The one pen (SPEC.md §5.2). The pad, the sentence words, the note and the font outlines all
// use these options, so the font looks exactly like the ink on screen. perfect-freehand's
// options are ratios of `size`, so the same options work at any scale.

import { getStroke, type StrokeOptions } from "perfect-freehand";

/** Pen diameter as a fraction of the x-height. */
export const PEN_SIZE_XH = 0.16;
/** x-height in glyph units (1000 per em). */
export const XH = 500;

export function penOptions(xHeight: number, pen: boolean, last = true): StrokeOptions {
  return {
    size: PEN_SIZE_XH * xHeight,
    thinning: 0.6,
    smoothing: 0.5,
    streamline: 0.45,
    simulatePressure: !pen,
    last,
  };
}

/** The outline polygon of one stroke (perfect-freehand), in the stroke's own units. */
export function strokeOutline(points: ArrayLike<ArrayLike<number>>, xHeight: number, pen: boolean, last = true): number[][] {
  const pts: number[][] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    pts.push([p[0], p[1], pen ? (p[2] ?? 0.5) : 0.5]);
  }
  return getStroke(pts, penOptions(xHeight, pen, last));
}

/** perfect-freehand polygon → SVG path (quadratic midpoints, the library's own recipe). */
export function outlineToPath(poly: number[][]): string {
  const n = poly.length;
  if (!n) return "";
  const f = (v: number) => (Math.round(v * 100) / 100).toString();
  let d = `M${f(poly[0][0])} ${f(poly[0][1])}Q`;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = poly[i];
    const [x1, y1] = poly[(i + 1) % n];
    d += `${f(x0)} ${f(y0)} ${f((x0 + x1) / 2)} ${f((y0 + y1) / 2)} `;
  }
  return d + "Z";
}
