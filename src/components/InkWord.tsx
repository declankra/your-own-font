"use client";
// A written word shown in type: the person's ink, sized in `ex` so its x-height is exactly the
// x-height of the surrounding Figtree (SPEC.md §5.1: "at matching x-height").
import { piecesByLetter } from "@your-own-font/pipeline/fixture";
import type { InkStroke } from "@your-own-font/pipeline/font";
import { forwardRef, useMemo } from "react";
import { strokePath } from "@/lib/ink";
import type { WrittenWord } from "@/lib/types";

/** Glyph units of margin around the ink: the pen's radius plus a little air. */
export const INK_PAD = 60;
/** 500 glyph units (the x-height) = 1ex */
export const EX_PER_UNIT = 1 / 500;

/** "word:letter", the key of one written letter */
export const letterKey = (word: number, letter: number) => `${word}:${letter}`;

/**
 * A written word in the person's ink. Until a letter lifts it is drawn exactly as in Writing,
 * one path per stroke. A stroke cut between two letters is redrawn as its pieces only once one
 * of those letters has lifted, so the rest of it stays in the word.
 */
export const InkWordSvg = forwardRef<SVGSVGElement, { word: WrittenWord; index: number; lifted?: ReadonlySet<string> }>(function InkWordSvg(
  { word, index, lifted },
  ref,
) {
  const { strokes, letterOfStroke } = word.ink;
  const whole = useMemo(() => strokes.map((s) => strokePath(s.points, 500, s.pen)), [strokes]);
  const pieces = useMemo(() => {
    const byStroke = new Map<number, { letter: number; d: string }[]>();
    if (!word.ink.splits.length) return byStroke;
    piecesByLetter({ text: word.ink.text, strokes, letterOfStroke, splits: word.ink.splits }).forEach((ps, letter) => {
      for (const p of ps) {
        const st: InkStroke = strokes[p.stroke];
        const l = byStroke.get(p.stroke) ?? [];
        l.push({ letter, d: strokePath(st.points.slice(p.a, p.b + 1), 500, st.pen) });
        byStroke.set(p.stroke, l);
      }
    });
    for (const [k, l] of byStroke) if (l.length < 2) byStroke.delete(k);
    return byStroke;
  }, [word.ink, strokes, letterOfStroke]);
  const gone = (letter: number) => !!lifted?.has(letterKey(index, letter));
  const w = word.width + 2 * INK_PAD;
  return (
    <svg
      ref={ref}
      viewBox={`${-INK_PAD} -1000 ${w} 1450`}
      style={{ width: `${w * EX_PER_UNIT}ex`, height: `${1450 * EX_PER_UNIT}ex`, verticalAlign: `${-450 * EX_PER_UNIT}ex` }}
      aria-hidden="true"
      focusable="false"
    >
      <g fill="currentColor">
        {strokes.map((_, k) => {
          const split = pieces.get(k);
          if (split && split.some((p) => gone(p.letter)))
            return split.map((p, q) => <path key={`${k}.${q}`} d={p.d} className={gone(p.letter) ? "gone" : undefined} />);
          return <path key={k} d={whole[k]} className={!split && gone(letterOfStroke[k]) ? "gone" : undefined} />;
        })}
      </g>
    </svg>
  );
});
