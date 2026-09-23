// Ink that writes itself, stroke by stroke, in the order it was drawn (the hero word, the note).
import { strokePath } from "./ink";

export interface WriteItem {
  el: SVGPathElement;
  /** points in the stroke's own units */
  pts: number[][];
  /** x-height in those units (sets the pen size) */
  xh: number;
  pen: boolean;
}

function length(pts: number[][]): number {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return l;
}

/**
 * Write the items in order at `speed` x-heights per second, pausing `lift` ms between strokes.
 * Resolves when done or when `alive()` turns false. With `instant`, paints everything at once.
 */
export function writeOn(items: WriteItem[], opts: { speed: number; lift: number; instant?: boolean; alive?: () => boolean }): Promise<void> {
  const paintAll = () => items.forEach((s) => s.el.setAttribute("d", strokePath(s.pts, s.xh, s.pen)));
  if (opts.instant) {
    paintAll();
    return Promise.resolve();
  }
  items.forEach((s) => s.el.setAttribute("d", ""));
  return new Promise((resolve) => {
    let i = 0;
    let start: number | null = null;
    const lens = items.map((s) => length(s.pts));
    const step = (now: number) => {
      if (opts.alive && !opts.alive()) return resolve();
      if (i >= items.length) return resolve();
      if (start === null) start = now;
      const s = items[i];
      const e = now - start;
      if (e >= 0) {
        const want = (e / 1000) * opts.speed * s.xh;
        // points reached by this distance along the stroke
        let k = 1;
        let acc = 0;
        while (k < s.pts.length && acc + Math.hypot(s.pts[k][0] - s.pts[k - 1][0], s.pts[k][1] - s.pts[k - 1][1]) <= want) {
          acc += Math.hypot(s.pts[k][0] - s.pts[k - 1][0], s.pts[k][1] - s.pts[k - 1][1]);
          k++;
        }
        const done = acc >= lens[i] - 1e-6 || k >= s.pts.length;
        s.el.setAttribute("d", strokePath(s.pts.slice(0, Math.max(1, k)), s.xh, s.pen, done));
        if (done) {
          s.el.setAttribute("d", strokePath(s.pts, s.xh, s.pen, true));
          i++;
          start = now + opts.lift;
        }
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}
