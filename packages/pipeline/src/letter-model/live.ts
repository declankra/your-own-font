// The live rule that drives the instant fill while the pen moves (SPEC.md §6.1, the
// prototype's rule): a new stroke goes to the current letter unless it starts to the right
// of that letter's ink by more than a gap (0.30 x-height while the letter is under-filled,
// 0.05 once it looks complete). Kept here so evaluations can report it next to the solver.

import type { Guides, Polyline } from "./raster.ts";

/** Expected ink length per letter, in x-heights (SPEC.md §5.3; the prototype's table). */
export const TARGET_LENGTH: Record<string, number> = {
  a: 3.3, b: 3.3, c: 2.3, d: 3.8, e: 3, f: 3, g: 3.8, h: 3.4, i: 1.5, j: 2.4, k: 3.4, l: 2,
  m: 4.8, n: 3.1, o: 3.1, p: 3.8, q: 3.8, r: 2, s: 2.7, t: 2.6, u: 3.1, v: 2.4, w: 3.8, x: 2.4,
  y: 3.4, z: 3, ",": 0.5, ".": 0.15, "'": 0.5, "!": 1.6, "?": 2.2,
};

export function liveAssign(strokes: ArrayLike<Polyline>, word: string, guides: Guides): number[] {
  const xh = guides.xHeight;
  const chars = [...word];
  const len = chars.map(() => 0);
  const maxX = chars.map(() => -Infinity);
  const out: number[] = [];
  let idx = 0;
  const fill = (j: number) => Math.min(1, len[j] / ((TARGET_LENGTH[chars[j]] ?? 3) * xh));
  for (let k = 0; k < strokes.length; k++) {
    const s = strokes[k];
    if (!s.length) {
      out.push(idx);
      continue;
    }
    const x = s[0][0];
    const gap = fill(idx) >= 1 ? xh * 0.05 : xh * 0.3;
    if (len[idx] > 0 && x > maxX[idx] + gap && idx < chars.length - 1) idx++;
    let l = xh * 0.12; // every stroke counts at least this much, so a dot registers
    for (let i = 1; i < s.length; i++) l += Math.hypot(s[i][0] - s[i - 1][0], s[i][1] - s[i - 1][1]);
    len[idx] += l;
    for (let i = 0; i < s.length; i++) maxX[idx] = Math.max(maxX[idx], s[i][0]);
    out.push(idx);
  }
  return out;
}
