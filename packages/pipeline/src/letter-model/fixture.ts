// The recorded-session / fixture format (docs/letter-model.md §5). Real sessions from
// tools/collect and the synthetic evaluation words share it.

import type { Guides } from "./raster.ts";

/** [x, y, pressure, tMs] in pad pixels, y down. */
export type FixturePoint = [number, number, number, number];

export interface Split {
  /** index of the stroke that runs across two letters */
  stroke: number;
  /** index of the cut point; it belongs to both pieces (left = [0..atPoint], right = [atPoint..]) */
  atPoint: number;
  /** letter index (into `text`) of the piece before the cut */
  left: number;
  /** letter index of the piece after the cut */
  right: number;
  /**
   * Optional (synthetic words): first and last point of the run-on connector the cut sits in.
   * That ink belongs to neither letter's shape, so evaluation accepts a cut anywhere inside it.
   */
  range?: [number, number];
}

export interface FixtureWord {
  text: string;
  guides: Guides;
  strokes: { points: FixturePoint[] }[];
  /** letter index of each stroke; for a split stroke, the letter of its last piece */
  letterOfStroke: number[];
  splits: Split[];
  /** optional, written by tools/collect: what the segmenter proposed before the labeller's fixes */
  proposal?: { mode: "model" | "geometry"; letterOfStroke: number[]; splits: Split[] };
  /** optional free-form metadata (synthetic words say how they were made) */
  meta?: Record<string, unknown>;
}

export interface FixtureSession {
  version: 1;
  writerId: string;
  device: string;
  pointerType: "touch" | "pen" | "mouse" | "synthetic";
  recordedAt: string;
  words: FixtureWord[];
  /** optional: consent line shown to the writer, verbatim */
  consent?: string;
}

/** A piece of one stroke: points [a..b] inclusive. */
export interface Piece {
  stroke: number;
  a: number;
  b: number;
}

/** Expand letterOfStroke + splits into, per letter, the list of stroke pieces it owns. */
export function piecesByLetter(
  word: { text: string; strokes: { points: ArrayLike<unknown> }[]; letterOfStroke: number[]; splits: Split[] },
): Piece[][] {
  const out: Piece[][] = [...word.text].map(() => []);
  const byStroke = new Map<number, Split[]>();
  for (const s of word.splits) {
    const l = byStroke.get(s.stroke) ?? [];
    l.push(s);
    byStroke.set(s.stroke, l);
  }
  word.strokes.forEach((st, i) => {
    const n = st.points.length;
    const sp = (byStroke.get(i) ?? []).slice().sort((p, q) => p.atPoint - q.atPoint);
    if (!sp.length) {
      const L = word.letterOfStroke[i];
      if (L >= 0 && L < out.length) out[L].push({ stroke: i, a: 0, b: n - 1 });
      return;
    }
    let a = 0;
    for (const s of sp) {
      out[s.left]?.push({ stroke: i, a, b: s.atPoint });
      a = s.atPoint;
    }
    out[sp[sp.length - 1].right]?.push({ stroke: i, a, b: n - 1 });
  });
  return out;
}

/**
 * Structural checks beyond the JSON schema: indices in range, splits chained in point order,
 * letterOfStroke of a split stroke equal to its last piece. Returns a list of problems.
 */
export function checkWord(w: FixtureWord): string[] {
  const errs: string[] = [];
  const L = [...w.text].length;
  if (w.letterOfStroke.length !== w.strokes.length)
    errs.push(`letterOfStroke has ${w.letterOfStroke.length} entries for ${w.strokes.length} strokes`);
  w.letterOfStroke.forEach((l, i) => {
    if (!(l >= 0 && l < L)) errs.push(`stroke ${i}: letter ${l} out of range 0..${L - 1}`);
  });
  w.strokes.forEach((s, i) => {
    if (!s.points.length) errs.push(`stroke ${i} has no points`);
  });
  const byStroke = new Map<number, Split[]>();
  for (const s of w.splits) {
    if (!(s.stroke >= 0 && s.stroke < w.strokes.length)) {
      errs.push(`split on missing stroke ${s.stroke}`);
      continue;
    }
    const n = w.strokes[s.stroke].points.length;
    if (!(s.atPoint > 0 && s.atPoint < n - 1)) errs.push(`split at point ${s.atPoint} of stroke ${s.stroke} (n=${n}) must be interior`);
    if (!(s.left >= 0 && s.left < L && s.right >= 0 && s.right < L)) errs.push(`split letters out of range`);
    if (s.left === s.right) errs.push(`split on stroke ${s.stroke} has the same letter on both sides`);
    const l = byStroke.get(s.stroke) ?? [];
    l.push(s);
    byStroke.set(s.stroke, l);
  }
  for (const [stroke, sp] of byStroke) {
    sp.sort((p, q) => p.atPoint - q.atPoint);
    for (let k = 1; k < sp.length; k++) {
      if (sp[k].atPoint <= sp[k - 1].atPoint) errs.push(`stroke ${stroke}: two splits at the same point`);
      if (sp[k].left !== sp[k - 1].right) errs.push(`stroke ${stroke}: splits don't chain (${sp[k - 1].right} then ${sp[k].left})`);
    }
    if (w.letterOfStroke[stroke] !== sp[sp.length - 1].right)
      errs.push(`stroke ${stroke}: letterOfStroke should be the letter of its last piece (${sp[sp.length - 1].right})`);
  }
  // every letter should own some ink, except in partial captures
  const owned = piecesByLetter(w).map((p) => p.length);
  owned.forEach((n, j) => {
    if (!n) errs.push(`letter ${j} (${[...w.text][j]}) has no ink`);
  });
  return errs;
}
