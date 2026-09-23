// Which form of each letter a run of text shows: the rule the font's calt feature encodes
// (see build.ts). Kept apart from the build so the page can use it without opentype.js.

export const LOWER = "abcdefghijklmnopqrstuvwxyz";

/**
 * Which form of each letter the font shows in a run of text: the same rule as the calt
 * feature, so the note on Done matches what apps will render.
 */
export function altSequence(text: string, hasAlt: (ch: string) => boolean): number[] {
  const out: number[] = [];
  let prevDefaultLetter = false;
  for (const ch of text) {
    const isLetter = LOWER.includes(ch);
    const v: number = prevDefaultLetter && hasAlt(ch) ? 1 : 0;
    out.push(v);
    prevDefaultLetter = isLetter && v === 0;
  }
  return out;
}
