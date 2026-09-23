// SPEC.md §5.3–5.4 and §6: the live gap rule, settling to the solver, undo, redo-letter,
// and the export that goes into the font.
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { synthWord } from "../packages/pipeline/src/house-hand";
import { LetterModel } from "../packages/pipeline/src/letter-model/model";
import { segment } from "../packages/pipeline/src/letter-model/segment";
import { WordSession } from "../src/lib/word-session";

const model = new LetterModel(readFileSync(new URL("../packages/letter-model/letter-model.bin", import.meta.url)));
const guides = { baseline: 160, xHeight: 60 };

function write(s: WordSession, strokes: [number, number][][], solve = true) {
  let t = 0;
  for (const st of strokes) {
    s.penDown(st[0][0], st[0][1], 0.5, false, (t += 100));
    for (const p of st.slice(1)) s.penMove(p[0], p[1], 0.5, (t += 8));
    s.penUp();
    if (solve) {
      const { strokes: input, version } = s.solverInput();
      s.applySolve(segment(input, s.text, s.guides, { mode: "model", model, partial: true }), version, true);
    }
  }
}

function place(word: string, opts: Parameters<typeof synthWord>[1] = {}) {
  const w = synthWord(word, opts);
  const k = guides.xHeight / 50;
  return { ...w, strokes: w.strokes.map((s) => s.map(([x, y]) => [20 + x * k, guides.baseline + (y - 100) * k] as [number, number])) };
}

describe("WordSession", () => {
  test("the prompt fills as ink goes down, and the last letter fills", () => {
    const s = new WordSession("bring", guides, "t");
    write(s, place("bring").strokes);
    const f = s.fills();
    expect(f.every((x) => x > 0.5)).toBe(true);
    expect(s.current).toBe(4);
  });

  test("late i-dot lands back in the i after the re-solve", () => {
    const s = new WordSession("pie.", guides, "t");
    const w = place("pie.", { lateMarks: true, gap: -2 });
    write(s, w.strokes);
    const { strokes, version } = s.solverInput();
    s.applySolve(segment(strokes, s.text, s.guides, { mode: "model", model }), version, false);
    const ink = s.toWordInk();
    expect(ink.letterOfStroke).toEqual(w.letterOfStroke);
    expect(s.stuck).toBeNull();
  });

  test("a stale solver result is ignored", () => {
    const s = new WordSession("the", guides, "t");
    const w = place("the");
    write(s, w.strokes.slice(0, 1), false);
    const { strokes, version } = s.solverInput();
    write(s, w.strokes.slice(1, 2), false);
    expect(s.applySolve(segment(strokes, s.text, s.guides, { mode: "model", model, partial: true }), version, true)).toBeNull();
  });

  test("undo removes the last stroke; redo clears one letter only", () => {
    const s = new WordSession("the", guides, "t");
    write(s, place("the").strokes);
    const n = s.strokes.length;
    s.undo();
    expect(s.strokes.length).toBe(n - 1);
    const before = s.fills();
    s.redoLetter(1);
    const after = s.fills();
    expect(after[1]).toBe(0);
    expect(after[0]).toBeCloseTo(before[0]);
    expect(s.current).toBe(1);
  });

  test("export is in glyph units: x-height 500, baseline 0", () => {
    const s = new WordSession("o", guides, "t");
    write(s, place("o").strokes, false);
    const ink = s.toWordInk();
    const ys = ink.strokes.flatMap((st) => st.points.map((p) => p[1]));
    expect(Math.min(...ys)).toBeGreaterThan(-560);
    expect(Math.min(...ys)).toBeLessThan(-440);
    expect(Math.max(...ys)).toBeGreaterThan(-20);
    expect(Math.min(...ink.strokes.flatMap((st) => st.points.map((p) => p[0])))).toBe(0);
  });
});
