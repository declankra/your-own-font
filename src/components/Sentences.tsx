"use client";
// The two sentences (SPEC.md §5.1). Writing and Making render them with this one component at
// the same place on the same screen, so the hand-off between them moves nothing (SPEC.md §3).
// In Making, letters lift out of their words: `lifted` hides a letter's ink in its word, while
// the Foundry flies the same ink (the sample the font uses) to its slot.
import type { Ref } from "react";
import type { WrittenWord } from "@/lib/types";
import { InkWordSvg } from "./InkWord";

export function Sentences({
  pair,
  written,
  active = -1,
  locked = false,
  spent = false,
  lifted,
  onReopen,
  wordRef,
  sentencesRef,
}: {
  pair: readonly [string, string];
  written: (WrittenWord | null)[];
  /** the word being written (highlighted) */
  active?: number;
  /** written words can't be reopened (the beat, and Making) */
  locked?: boolean;
  /** Making: the written words go faint */
  spent?: boolean;
  /** Making: letters that have left their words */
  lifted?: ReadonlySet<string>;
  onReopen?: (i: number) => void;
  wordRef?: (i: number, el: SVGSVGElement | null) => void;
  sentencesRef?: Ref<HTMLDivElement>;
}) {
  let wi = 0;
  return (
    <div className={`sentences${locked ? " locked" : ""}${spent ? " spent" : ""}`} aria-label="Your two sentences" ref={sentencesRef}>
      {pair.map((sentence, si) => (
        <p className="sent" key={si}>
          {sentence
            .split(/\s+/)
            .filter(Boolean)
            .map((t) => {
              const i = wi++;
              const w = written[i];
              if (w)
                return (
                  <button
                    key={i}
                    className="w written"
                    aria-label={`Rewrite “${t}”`}
                    aria-disabled={locked || undefined}
                    tabIndex={locked ? -1 : undefined}
                    onClick={() => !locked && onReopen?.(i)}
                  >
                    <InkWordSvg ref={(el) => wordRef?.(i, el)} word={w} index={i} lifted={lifted} />
                  </button>
                );
              return (
                <span key={i} className={`w${i === active ? " now" : ""}`}>
                  {t}
                </span>
              );
            })}
        </p>
      ))}
    </div>
  );
}
