"use client";
// The mark: a ruled tile with a handwritten "a" in the current ink, then the wordmark.
// Before a font exists the "a" is the house hand; after, it is the person's own.
import { HOUSE, houseStrokes, housePressure } from "@your-own-font/pipeline/house-hand";
import type { InkStroke } from "@your-own-font/pipeline/font";
import { useMemo } from "react";
import { strokePath } from "@/lib/ink";
import { PRODUCT_NAME } from "@/lib/config";

function houseA(): { paths: string[]; cx: number } {
  const g = HOUSE.a;
  const paths = houseStrokes("a").map((pts) => {
    const n = pts.length;
    return strokePath(
      pts.map(([x, y], i) => [x + 4, y, housePressure(i / Math.max(1, n - 1))]),
      50 * 1.5,
      true,
    );
  });
  return { paths, cx: (g.w + 8) / 2 };
}

export function LogoMark({ own }: { own?: InkStroke[] | null }) {
  const art = useMemo(() => {
    if (own && own.length) {
      // the person's own a, glyph units (x-height 500, baseline 0) → the tile's house units
      let x0 = Infinity;
      let x1 = -Infinity;
      for (const s of own) for (const p of s.points) (x0 = Math.min(x0, p[0])), (x1 = Math.max(x1, p[0]));
      const paths = own.map((s) => strokePath(s.points.map(([x, y, p]) => [(x - x0) / 10 + 4, 100 + y / 10, p]), 50 * 1.5, s.pen));
      return { paths, cx: (x1 - x0) / 20 + 4 };
    }
    return houseA();
  }, [own]);
  const { cx } = art;
  return (
    <span className="mark" aria-hidden="true">
      <svg viewBox={`${cx - 62} 16 124 124`}>
        <line x1={cx - 62} x2={cx + 62} y1={100} y2={100} stroke="#C9D6F7" strokeWidth={3} />
        <line x1={cx - 62} x2={cx + 62} y1={50} y2={50} stroke="#C9D6F7" strokeWidth={3} strokeDasharray="7 8" />
        <g fill="currentColor">
          {art.paths.map((d, i) => (
            <path key={i} d={d} />
          ))}
        </g>
      </svg>
    </span>
  );
}

export function Logo({ own, onHome }: { own?: InkStroke[] | null; onHome?: () => void }) {
  const inner = (
    <>
      <LogoMark own={own} />
      <span className="word">{PRODUCT_NAME}</span>
    </>
  );
  // past Hero the logo is the way home
  if (!onHome) return <span className="logo">{inner}</span>;
  return (
    <button type="button" className="logo home" aria-label={`${PRODUCT_NAME}, home`} onClick={onHome}>
      {inner}
    </button>
  );
}
