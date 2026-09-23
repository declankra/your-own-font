"use client";
// A written word shown in type: the person's ink, sized in `ex` so its x-height is exactly the
// x-height of the surrounding Figtree (SPEC.md §5.1: "at matching x-height").
import type { InkStroke } from "@your-own-font/pipeline/font";
import { forwardRef, useMemo } from "react";
import { inkPaths } from "@/lib/ink";

/** Glyph units of margin around the ink: the pen's radius plus a little air. */
export const INK_PAD = 60;
/** 500 glyph units (the x-height) = 1ex */
export const EX_PER_UNIT = 1 / 500;

export const InkWordSvg = forwardRef<SVGSVGElement, { strokes: InkStroke[]; width: number }>(function InkWordSvg({ strokes, width }, ref) {
  const paths = useMemo(() => inkPaths(strokes), [strokes]);
  const w = width + 2 * INK_PAD;
  return (
    <svg
      ref={ref}
      viewBox={`${-INK_PAD} -1000 ${w} 1450`}
      style={{ width: `${w * EX_PER_UNIT}ex`, height: `${1450 * EX_PER_UNIT}ex`, verticalAlign: `${-450 * EX_PER_UNIT}ex` }}
      aria-hidden="true"
      focusable="false"
    >
      <g fill="currentColor">
        {paths.map((d, i) => (
          <path key={i} d={d} />
        ))}
      </g>
    </svg>
  );
});
