"use client";
// One glyph in a square tile. Once the font is loaded it is real text set in the font (SVG
// <text> in the font's own family); before that, the outline the worker cast.
import type { BuiltGlyph } from "@your-own-font/pipeline/font";

export function GlyphArt({ glyph, family, className }: { glyph: BuiltGlyph; family?: string | null; className?: string }) {
  const cx = glyph.advance / 2;
  return (
    <svg className={className} viewBox={`${cx - 660} -920 1320 1320`} aria-hidden="true" focusable="false">
      {family ? (
        <text x={cx} y={0} textAnchor="middle" fontFamily={`'${family}'`} fontSize={1000} fill="currentColor">
          {glyph.char}
        </text>
      ) : (
        <path d={glyph.d} fill="currentColor" />
      )}
    </svg>
  );
}
