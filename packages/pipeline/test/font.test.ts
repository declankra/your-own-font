// The font pipeline end to end, in Node: house-hand words (touching letters, late i-dots and
// t-crossbars) → the model segmenter → buildFont → opentype.js parses the .otf back.
import { readFileSync } from "node:fs";
import { parse } from "opentype.js";
import { beforeAll, describe, expect, test } from "vitest";
import { altSequence, buildFont } from "../src/font/build.ts";
import { contourBounds, glyphContours, unionOutlines } from "../src/font/outline.ts";
import type { BuildEvent, BuildResult, WordInk } from "../src/font/types.ts";
import { HOUSE_BASELINE, HOUSE_XH, synthWord } from "../src/house-hand.ts";
import { LetterModel } from "../src/letter-model/model.ts";
import { segment } from "../src/letter-model/segment.ts";

const model = new LetterModel(readFileSync(new URL("../../letter-model/letter-model.bin", import.meta.url)));
const PAIR = ["quick,", "bring", "the", "jazz", "and", "warm", "pie.", "six", "lovely", "foxes", "nap", "by", "the", "old", "wharf."];
const S = 500 / HOUSE_XH;

function writeWords(opts: { gap: number; lateMarks: boolean; jitter: number }) {
  let exact = 0;
  let letters = 0;
  const words: WordInk[] = PAIR.map((text, wi) => {
    const w = synthWord(text, { ...opts, seed: 11 + wi });
    const guides = { baseline: HOUSE_BASELINE, xHeight: HOUSE_XH };
    const r = segment(w.strokes, text, guides, { mode: "model", model });
    letters += [...text].length;
    // per-letter exact match against the truth (no cuts in synthetic words)
    [...text].forEach((_, j) => {
      const truth = w.letterOfStroke.map((l, i) => (l === j ? i : -1)).filter((i) => i >= 0).join(",");
      const got = r.letterOfStroke.map((l, i) => (l === j && !r.splits.some((s) => s.stroke === i) ? i : -1)).filter((i) => i >= 0).join(",");
      if (truth === got) exact++;
    });
    let x0 = Infinity;
    for (const s of w.strokes) for (const p of s) x0 = Math.min(x0, p[0]);
    return {
      text,
      strokes: w.strokes.map((s) => ({ pen: false, points: s.map(([x, y], k) => [(x - x0) * S, (y - HOUSE_BASELINE) * S, 0.5, k * 8] as [number, number, number, number]) })),
      letterOfStroke: r.letterOfStroke,
      splits: r.splits,
    };
  });
  return { words, rate: exact / letters };
}

describe("segmentation on the sentence pair", () => {
  test("spaced letters: every stroke lands in its letter", () => {
    const { rate } = writeWords({ gap: 8, lateMarks: false, jitter: 0.3 });
    expect(rate).toBe(1);
  });
  test("touching letters with late dots and crossbars", () => {
    const { rate } = writeWords({ gap: -2, lateMarks: true, jitter: 0.5 });
    console.log(`touching + late marks: ${(rate * 100).toFixed(1)}% of letters exact`);
    expect(rate).toBeGreaterThanOrEqual(0.95);
  });
});

describe("buildFont", () => {
  let result: BuildResult;
  const events: BuildEvent[] = [];
  beforeAll(async () => {
    const { words } = writeWords({ gap: 6, lateMarks: true, jitter: 0.4 });
    result = await buildFont({ words, id: "TEST01" }, { model, onEvent: (e) => events.push(e) });
  });

  test("reports stages in order, one glyph event per letter a–z", () => {
    const stages = events.filter((e) => e.type === "stage").map((e) => (e as { stage: string }).stage);
    expect(stages).toEqual(["cast", "set", "ink", "press"]);
    const glyphs = events.filter((e) => e.type === "glyph") as Extract<BuildEvent, { type: "glyph" }>[];
    expect(glyphs.map((g) => g.glyph.char).join("")).toBe("abcdefghijklmnopqrstuvwxyz");
    expect(glyphs.map((g) => g.index)).toEqual([...Array(26).keys()]);
    expect(events[events.length - 1].type).toBe("built");
    expect(result.missing).toEqual([]);
  });

  test("the .otf parses and has a–z, A–Z, punctuation and calt", () => {
    const font = parse(result.otf);
    expect(font.getEnglishName("fontFamily")).toBe("My Hand");
    expect(font.getEnglishName("postScriptName")).toBe("MyHand-TEST01");
    for (const ch of "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ,.'’ ") {
      expect(font.hasChar(ch), ch).toBe(true);
      const g = font.charToGlyph(ch);
      if (ch !== " ") expect(g.path.commands.length, ch).toBeGreaterThanOrEqual(3);
    }
    const gsub = font.tables.gsub;
    expect(gsub.features.map((f: { tag: string }) => f.tag)).toContain("calt");
    // letters written twice in the pair have alternates
    const names = new Set(Array.from({ length: font.glyphs.length }, (_, i) => font.glyphs.get(i).name));
    for (const ch of "etaoinsrhl") expect(names.has(`${ch}.alt`), ch).toBe(true);
    // x-height 500 on a 1000 em, like Figtree
    expect(font.unitsPerEm).toBe(1000);
    expect(font.tables.os2.sxHeight).toBe(500);
  });

  test("late i-dots and t-crossbars stay in their own letters", () => {
    const font = parse(result.otf);
    const bb = (ch: string) => font.charToGlyph(ch).getBoundingBox();
    // the dot sits well above the x-height; without it an i would stop at ~540
    expect(bb("i").y2).toBeGreaterThan(620);
    // the crossbar makes the t wider than its stem
    expect(bb("t").x2 - bb("t").x1).toBeGreaterThan(220);
  });

  test("glyph outlines keep the shape: the o is one ring with a counter", () => {
    const o = result.glyphs.find((g) => g.char === "o" && g.variant === 0)!;
    expect((o.d.match(/M/g) ?? []).length).toBe(2);
  });

  test("the note's variant rule matches the font's calt", () => {
    const has = (c: string) => "el".includes(c);
    expect(altSequence("hello", has)).toEqual([0, 1, 0, 1, 0]);
    expect(altSequence("well, all", has)).toEqual([0, 1, 0, 1, 0, 0, 0, 1, 0]);
  });

  test("smoothing never strays from the ink (no spikes at cusps, e.g. the m's retraced stem)", () => {
    // letters whose unchecked fit spiked by 50–535 units (found by sweeping seeds and pointer spacing)
    const cases: [string, number, number][] = [["m", 32, 3], ["m", 38, 2], ["m", 130, 3], ["n", 107, 2], ["n", 130, 3], ["h", 37, 2], ["u", 92, 3], ["u", 143, 3]];
    for (const [ch, seed, every] of cases) {
      const w = synthWord(ch, { jitter: 0.5, seed });
      const strokes = w.strokes.map((s) => ({
        pen: false,
        points: s.filter((_, i) => i % every === 0 || i === s.length - 1).map(([x, y], k) => [x * S, (y - HOUSE_BASELINE) * S, 0.5, k * 8] as [number, number, number, number]),
      }));
      const raw = unionOutlines(strokes).flat();
      const f = contourBounds(glyphContours(strokes));
      const stray = Math.max(
        Math.min(...raw.map((p) => p[0])) - f.xMin,
        f.xMax - Math.max(...raw.map((p) => p[0])),
        Math.min(...raw.map((p) => p[1])) - f.yMin,
        f.yMax - Math.max(...raw.map((p) => p[1])),
      );
      expect(stray, `${ch} seed ${seed}`).toBeLessThanOrEqual(6);
    }
  });

  test("a failing stroke set still yields contours (no union crash)", () => {
    const pts = Array.from({ length: 40 }, (_, i) => [200 + 150 * Math.cos(i / 3), -250 + 150 * Math.sin(i / 2.7), 0.5, i] as [number, number, number, number]);
    expect(glyphContours([{ pen: false, points: pts }, { pen: false, points: pts.slice().reverse() }]).length).toBeGreaterThan(0);
  });
});
