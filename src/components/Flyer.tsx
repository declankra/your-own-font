"use client";
// One letter lifting out of its word and flying to its slot (SPEC.md §3 and §7, the Cast step;
// mock: design/done-transition.html, `fly()`). The flyer is the glyph's own sample, drawn with
// the same pen as the word, laid exactly over that letter's ink in the sentence. It lifts in
// full ink on `nib`, flies on `paper`, and lands where the slot draws the same glyph. It moves
// with transform only.
import type { BuiltGlyph } from "@your-own-font/pipeline/font";
import { spring } from "motion";
import { animate } from "motion/react";
import { useLayoutEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { inkPaths, strokesBox } from "@/lib/ink";
import { NIB, PAPER } from "@/lib/springs";
import { INK_PAD } from "./InkWord";

/** How long the letter lifts before it sets off (the nib spring is ~90% there) */
export const LIFT_MS = 140;
const LIFT_SCALE = 1.16;
/** the pen's radius and a little air, in glyph units */
const PAD = 70;

/**
 * When a paper-spring flight of `px` stays within `tol` px of its slot: the letter has landed.
 * Motion only reports rest ~400 ms later (its scale key settles last), long after the eye sees
 * the letter arrive, so landing on it would hold the whole timeline.
 */
export function landingMs(px: number, tol = 0.75): number {
  const g = spring({ keyframes: [0, px], ...PAPER });
  let last = 0;
  for (let t = 0; t < 3000; t += 8) {
    const { value, done } = g.next(t);
    if (Math.abs(value - px) > tol) last = t + 8;
    if (done) break;
  }
  return last;
}

export function Flyer({
  glyph,
  word,
  slot,
  sheet,
  onLand,
}: {
  glyph: BuiltGlyph & { from: NonNullable<BuiltGlyph["from"]> };
  /** the written word's svg in the sentence */
  word: SVGSVGElement;
  /** the letter's slot (its face is the glyph's square tile) */
  slot: () => HTMLElement | null;
  /** the sheet, which may still be rising in */
  sheet: () => HTMLElement | null;
  onLand: () => void;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const paths = useMemo(() => inkPaths(glyph.strokes), [glyph]);
  const box = useMemo(() => strokesBox(glyph.strokes, PAD), [glyph]);
  const bw = box.x1 - box.x0;
  const bh = box.y1 - box.y0;

  useLayoutEffect(() => {
    const el = ref.current!;
    // start: exactly over the letter's ink in the word (same units, same pen)
    const wr = word.getBoundingClientRect();
    const sW = wr.width / word.viewBox.baseVal.width;
    const left = wr.left + window.scrollX + (box.x0 - glyph.from.dx + INK_PAD) * sW;
    const top = wr.top + window.scrollY + (box.y0 + 1000) * sW;
    const w = bw * sW;
    const h = bh * sW;
    Object.assign(el.style, { left: `${left}px`, top: `${top}px`, width: `${w}px`, height: `${h}px` });

    let live = true;
    const lift = animate(el, { x: (-(LIFT_SCALE - 1) * w) / 2, y: (-(LIFT_SCALE - 1) * h) / 2 - 6, scale: LIFT_SCALE }, NIB);
    let fly: ReturnType<typeof animate> | null = null;
    let land: ReturnType<typeof setTimeout> | undefined;
    const t = setTimeout(() => {
      const s = slot();
      if (!s) return onLand();
      // end: where the slot's tile draws the glyph (GlyphArt: 1320 units square, centred on the
      // advance, baseline 920 units down), measured without the sheet's rise-in offset
      const r = s.getBoundingClientRect();
      const sheetEl = sheet();
      const rise = sheetEl ? new DOMMatrixReadOnly(getComputedStyle(sheetEl).transform).m42 : 0;
      const sT = r.width / 1320;
      const x = r.left + window.scrollX + (box.x0 - glyph.advance / 2 + 660) * sT - left;
      const y = r.top - rise + window.scrollY + (box.y0 + 920) * sT - top;
      fly = animate(el, { x, y, scale: sT / sW }, PAPER);
      const k = LIFT_SCALE - sT / sW; // the scale's travel, in px at the flyer's size
      land = setTimeout(() => live && onLand(), landingMs(Math.max(Math.hypot(x, y), Math.abs(k) * Math.max(w, h))));
    }, LIFT_MS);
    return () => {
      live = false;
      clearTimeout(t);
      clearTimeout(land);
      lift.stop();
      fly?.stop();
    };
    // a flyer is mounted once per letter and never re-measured
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return createPortal(
    <svg ref={ref} className="flyer" viewBox={`${box.x0} ${box.y0} ${bw} ${bh}`} aria-hidden="true" focusable="false">
      <g fill="currentColor">
        {paths.map((d, k) => (
          <path key={k} d={d} />
        ))}
      </g>
    </svg>,
    document.body,
  );
}
