// The data the font pipeline takes and the events it reports (SPEC.md §7).
//
// Glyph units: the font's own units. x-height is 500, the baseline is y = 0, and y points
// DOWN (like the writing pad and SVG), so ink above the baseline has negative y. The OTF
// build flips y at the very end. 1000 units = 1 em, so 0.5 em x-height matches Figtree's.

import type { Split } from "../letter-model/fixture.ts";

/** [x, y, pressure, tMs] in glyph units, y down. */
export type GlyphPoint = [number, number, number, number];

export interface InkStroke {
  points: GlyphPoint[];
  /** true when drawn with a stylus: real pressure. Otherwise perfect-freehand simulates it. */
  pen: boolean;
}

/** One written word, normalised to glyph units (x = 0 at the word's left ink edge). */
export interface WordInk {
  text: string;
  strokes: InkStroke[];
  /** From the segmenter: letter index of each stroke (a split stroke: the letter of its last piece). */
  letterOfStroke: number[];
  splits: Split[];
}

export interface BuildInput {
  words: WordInk[];
  /**
   * Letters rewritten on the Done sheet (SPEC.md §8.4). Each replaces every sample of that
   * letter, so it is the only form the font has.
   */
  overrides?: Record<string, InkStroke[]>;
  /** Unique PostScript name suffix; a random one is made when missing. */
  id?: string;
}

/** One sample of a letter, cut out of a written word, in the order the pen drew it. */
export interface LetterSample {
  char: string;
  strokes: InkStroke[];
  /** index of the word it came from (-1 for a rewritten letter) */
  word: number;
  /** index of the letter within that word's text (-1 for a rewritten letter) */
  letter: number;
  /** model log P(char) for this sample; NaN when no model was given */
  score: number;
}

export interface Bounds {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

/** A finished glyph, ready for the note and the tiles. Coordinates are glyph units, y down. */
export interface BuiltGlyph {
  name: string;
  char: string;
  /** 0 = default form, 1 = the calt alternate */
  variant: number;
  advance: number;
  /** SVG path data of the final outline (glyph units, y down, origin at the glyph's left edge) */
  d: string;
  bounds: Bounds;
  /** the sample it was made from, shifted into the glyph's own coordinates (for the replay) */
  strokes: InkStroke[];
  /** true when made by the pipeline rather than written: capitals, and ' from a comma */
  derived: boolean;
  /**
   * The written letter this glyph was cut from, for lifting it out of its word on screen:
   * `strokes` shifted left by `dx` are exactly that letter's ink in the word's own coordinates
   * (`WordInk`). Absent for derived glyphs and rewritten letters.
   */
  from?: { word: number; letter: number; dx: number };
}

export type BuildStage = "cast" | "set" | "ink" | "press";

export type BuildEvent =
  /** one letter a–z has its outline (perfect-freehand → polygon-clipping → fit-curve) */
  | { type: "glyph"; index: number; glyph: BuiltGlyph }
  | { type: "stage"; stage: BuildStage }
  | { type: "metrics"; sidebearing: number; space: number }
  | { type: "variants"; alternates: string[]; dropped: string[] }
  | { type: "built"; result: BuildResult };

export interface BuildResult {
  otf: ArrayBuffer;
  familyName: string;
  postScriptName: string;
  glyphs: BuiltGlyph[];
  /** chars a–z with no ink at all (never written); empty in a normal run */
  missing: string[];
}
