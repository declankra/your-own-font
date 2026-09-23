import type { WordInk } from "@your-own-font/pipeline/font";

/** A finished word: its ink in glyph units plus the segmenter's letter assignment. */
export interface WrittenWord {
  text: string;
  ink: WordInk;
  /** ink width in glyph units */
  width: number;
}

export type Phase = "hero" | "writing" | "making" | "done";
