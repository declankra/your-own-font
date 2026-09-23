// Drawing ink on screen: the same pen as the font (packages/pipeline/src/font/pen.ts).
import { outlineToPath, strokeOutline } from "@your-own-font/pipeline/pen";
import type { InkStroke } from "@your-own-font/pipeline/font";

/** One stroke's outline as SVG path data. `xh` is the x-height in the points' units. */
export function strokePath(points: ArrayLike<ArrayLike<number>>, xh: number, pen: boolean, last = true): string {
  if (!points.length) return "";
  return outlineToPath(strokeOutline(points, xh, pen, last));
}

/** Glyph-unit strokes (x-height 500) → path data per stroke. */
export function inkPaths(strokes: InkStroke[]): string[] {
  return strokes.map((s) => strokePath(s.points, 500, s.pen));
}

export interface Box {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export function strokesBox(strokes: InkStroke[], pad = 0): Box {
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const s of strokes)
    for (const p of s.points) {
      x0 = Math.min(x0, p[0]);
      x1 = Math.max(x1, p[0]);
      y0 = Math.min(y0, p[1]);
      y1 = Math.max(y1, p[1]);
    }
  if (!Number.isFinite(x0)) return { x0: 0, x1: 0, y0: 0, y1: 0 };
  return { x0: x0 - pad, x1: x1 + pad, y0: y0 - pad, y1: y1 + pad };
}
