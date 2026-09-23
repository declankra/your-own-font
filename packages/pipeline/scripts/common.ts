// Shared helpers for the evaluation and data scripts.
import { readFileSync } from "node:fs";
import type { FixtureSession, FixtureWord, Piece, Split } from "../src/letter-model/fixture.ts";
import { piecesByLetter } from "../src/letter-model/fixture.ts";
import type { Polyline } from "../src/letter-model/raster.ts";

export function readSessions(path: string): FixtureSession[] {
  const text = readFileSync(path, "utf8");
  if (path.endsWith(".jsonl"))
    return text
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  const j = JSON.parse(text);
  return Array.isArray(j) ? j : [j];
}

export function polylines(w: FixtureWord): Polyline[] {
  return w.strokes.map((s) => s.points);
}

/** Path length of each segment i -> i+1 of each stroke, and the truth letter owning it. */
export function segmentOwners(w: FixtureWord): { len: number[][]; owner: number[][] } {
  const owner = w.strokes.map((s) => new Array<number>(Math.max(1, s.points.length - 1)).fill(-1));
  const len = w.strokes.map((s) => {
    const p = s.points;
    if (p.length < 2) return [0.05 * w.guides.xHeight]; // a tap: give it a little weight
    const out: number[] = [];
    for (let i = 0; i + 1 < p.length; i++) out.push(Math.hypot(p[i + 1][0] - p[i][0], p[i + 1][1] - p[i][1]));
    return out;
  });
  piecesByLetter(w).forEach((pieces, L) => {
    for (const pc of pieces) {
      const n = w.strokes[pc.stroke].points.length;
      if (n < 2) owner[pc.stroke][0] = L;
      else for (let i = pc.a; i < pc.b; i++) owner[pc.stroke][i] = L;
    }
  });
  return { len, owner };
}

/** Ink length per letter inside a set of stroke pieces. */
export function inkByLetter(
  pieces: Piece[],
  so: { len: number[][]; owner: number[][] },
  nLetters: number,
): Float64Array {
  const out = new Float64Array(nLetters);
  for (const pc of pieces) {
    const len = so.len[pc.stroke];
    const own = so.owner[pc.stroke];
    if (len.length === 1 && pc.a === pc.b) {
      if (own[0] >= 0) out[own[0]] += len[0];
      continue;
    }
    for (let i = pc.a; i < pc.b; i++) if (own[i] >= 0) out[own[i]] += len[i];
  }
  return out;
}

/** A split may sit this far (x-heights, along the pen path) from the labelled cut. */
export const TOL_XH = 0.5;

/** Per-letter exact match of `pred` against the truth in `w`. */
export function letterMatches(w: FixtureWord, pred: { letterOfStroke: number[]; splits: Split[] }, upToStroke = w.strokes.length): boolean[] {
  const L = [...w.text].length;
  const truth = segmentOwners(w);
  const p = segmentOwners({ ...w, letterOfStroke: pred.letterOfStroke, splits: pred.splits });
  const touchT: Set<number>[] = Array.from({ length: L }, () => new Set());
  const touchP: Set<number>[] = Array.from({ length: L }, () => new Set());
  const mism = new Float64Array(L);
  for (let s = 0; s < Math.min(upToStroke, w.strokes.length); s++) {
    const ot = truth.owner[s];
    const op = p.owner[s];
    for (let i = 0; i < ot.length; i++) {
      if (ot[i] >= 0) touchT[ot[i]].add(s);
      if (op[i] >= 0) touchP[op[i]].add(s);
      if (ot[i] !== op[i]) {
        const len = w.strokes[s].points.length < 2 ? 0 : truth.len[s][i];
        if (ot[i] >= 0) mism[ot[i]] += len;
        if (op[i] >= 0) mism[op[i]] += len;
      }
    }
  }
  const tol = TOL_XH * w.guides.xHeight;
  // ink of a run-on connector belongs to neither letter's shape (synthetic words mark it)
  for (const sp of w.splits) {
    if (!sp.range) continue;
    const ot = truth.owner[sp.stroke];
    const op = p.owner[sp.stroke];
    for (let i = sp.range[0]; i < sp.range[1] && i < ot.length; i++)
      if (ot[i] !== op[i]) {
        if (ot[i] >= 0) mism[ot[i]] -= truth.len[sp.stroke][i];
        if (op[i] >= 0) mism[op[i]] -= truth.len[sp.stroke][i];
      }
  }
  return Array.from({ length: L }, (_, j) => {
    const a = touchT[j];
    const b = touchP[j];
    if (a.size !== b.size) return false;
    for (const s of a) if (!b.has(s)) return false;
    return mism[j] <= tol;
  });
}

