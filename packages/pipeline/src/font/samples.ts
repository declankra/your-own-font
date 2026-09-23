// Written words → letter samples, and the writer's own letter spacing.

import { piecesByLetter } from "../letter-model/fixture.ts";
import type { LetterModel } from "../letter-model/model.ts";
import { classId } from "../letter-model/classes.ts";
import { PEN_SIZE_XH, XH } from "./pen.ts";
import type { InkStroke, LetterSample, WordInk } from "./types.ts";

/** Every letter of every word, cut out along the segmenter's assignment, in pen order. */
export function letterSamples(words: WordInk[]): LetterSample[] {
  const out: LetterSample[] = [];
  words.forEach((w, wi) => {
    const chars = [...w.text];
    const pieces = piecesByLetter({ text: w.text, strokes: w.strokes.map((s) => ({ points: s.points })), letterOfStroke: w.letterOfStroke, splits: w.splits });
    pieces.forEach((ps, j) => {
      if (!ps.length) return;
      const sorted = ps.slice().sort((p, q) => p.stroke - q.stroke || p.a - q.a);
      const strokes: InkStroke[] = sorted.map((p) => ({
        points: w.strokes[p.stroke].points.slice(p.a, p.b + 1).map((pt) => [...pt] as InkStroke["points"][number]),
        pen: w.strokes[p.stroke].pen,
      }));
      out.push({ char: chars[j], strokes, word: wi, score: NaN });
    });
  });
  return out;
}

/**
 * Half the writer's typical gap between neighbouring letters, measured between pen outlines.
 * This becomes each glyph's side bearing, so set text keeps the spacing they wrote with.
 * Clamped so touching writers still get legible type and wide writers don't get gappy type.
 */
export function writerSidebearing(words: WordInk[]): number {
  const gaps: number[] = [];
  for (const w of words) {
    const pieces = piecesByLetter({ text: w.text, strokes: w.strokes.map((s) => ({ points: s.points })), letterOfStroke: w.letterOfStroke, splits: w.splits });
    const spans = pieces.map((ps) => {
      let x0 = Infinity;
      let x1 = -Infinity;
      for (const p of ps)
        for (let i = p.a; i <= p.b; i++) {
          const x = w.strokes[p.stroke].points[i][0];
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
        }
      return Number.isFinite(x0) ? [x0, x1] : null;
    });
    for (let j = 0; j + 1 < spans.length; j++) {
      const a = spans[j];
      const b = spans[j + 1];
      if (a && b) gaps.push(b[0] - a[1] - 0.8 * PEN_SIZE_XH * XH);
    }
  }
  if (!gaps.length) return 40;
  gaps.sort((p, q) => p - q);
  const med = gaps[Math.floor(gaps.length / 2)];
  return Math.round(Math.min(110, Math.max(22, med / 2)));
}

/** Score each sample as the letter it is meant to be (log P), for choosing variants. */
export function scoreSamples(samples: LetterSample[], model: LetterModel | null): void {
  if (!model) return;
  const guides = { baseline: 0, xHeight: XH };
  for (const s of samples) {
    try {
      const lp = model.score(
        s.strokes.map((st) => st.points),
        guides,
      );
      s.score = lp[classId(s.char)];
    } catch {
      s.score = NaN;
    }
  }
}

/** A variant this far (nats) below the writer's best sample of the letter leaves the rotation (SPEC.md §6.4). */
export const DROP_MARGIN = 3;

/**
 * Default and alternate sample per letter. The best-scored sample is the default; the next
 * one becomes the calt alternate unless the model scores it far below the default.
 */
export function chooseVariants(samples: LetterSample[]): { chosen: Map<string, LetterSample[]>; dropped: string[] } {
  const by = new Map<string, LetterSample[]>();
  for (const s of samples) {
    const l = by.get(s.char) ?? [];
    l.push(s);
    by.set(s.char, l);
  }
  const chosen = new Map<string, LetterSample[]>();
  const dropped: string[] = [];
  for (const [ch, list] of by) {
    const ranked = list.slice().sort((a, b) => {
      const sa = Number.isNaN(a.score) ? -Infinity : a.score;
      const sb = Number.isNaN(b.score) ? -Infinity : b.score;
      if (sa !== sb) return sb - sa;
      return a.word - b.word; // no model: first written first
    });
    const pick = [ranked[0]];
    const alt = ranked[1];
    if (alt) {
      const far = !Number.isNaN(ranked[0].score) && !Number.isNaN(alt.score) && ranked[0].score - alt.score > DROP_MARGIN;
      if (far) dropped.push(ch);
      else pick.push(alt);
    }
    chosen.set(ch, pick);
  }
  return { chosen, dropped };
}
