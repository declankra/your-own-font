"use client";
// "handwriting" on the hero: drawn stroke by stroke in the house hand on faint guides.
import { HOUSE, houseStrokes, housePressure } from "@your-own-font/pipeline/house-hand";
import { useEffect, useMemo, useRef } from "react";
import { writeOn } from "@/lib/write-on";
import { strokePath } from "@/lib/ink";

const U = 0.0105; // em per house unit

export function HouseWord({ text, color, reduce, delay = 350 }: { text: string; color?: string; reduce: boolean; delay?: number }) {
  const g = useRef<SVGGElement>(null);
  const layout = useMemo(() => {
    let x = 0;
    const items: { pts: number[][] }[] = [];
    for (const ch of text) {
      for (const pts of houseStrokes(ch)) {
        const n = pts.length;
        items.push({ pts: pts.map(([a, b], i) => [a + x, b, housePressure(i / Math.max(1, n - 1))]) });
      }
      x += HOUSE[ch].w + 6;
    }
    return { items, w: x - 6 };
  }, [text]);

  useEffect(() => {
    const root = g.current;
    if (!root) return;
    let alive = true;
    const els = Array.from(root.querySelectorAll("path"));
    const list = layout.items.map((it, i) => ({ el: els[i] as SVGPathElement, pts: it.pts, xh: 50 * 1.05, pen: true }));
    // ~1.5 s for the whole word: the speed follows its total ink length
    let total = 0;
    for (const it of layout.items) for (let i = 1; i < it.pts.length; i++) total += Math.hypot(it.pts[i][0] - it.pts[i - 1][0], it.pts[i][1] - it.pts[i - 1][1]);
    const lift = 35;
    const speed = total / 52.5 / Math.max(0.3, 1.5 - (lift * list.length) / 1000);
    if (reduce) writeOn(list, { speed, lift, instant: true });
    else {
      list.forEach((s) => s.el.setAttribute("d", ""));
      const t = setTimeout(() => writeOn(list, { speed, lift, alive: () => alive }), delay);
      return () => {
        alive = false;
        clearTimeout(t);
      };
    }
    return () => {
      alive = false;
    };
  }, [layout, reduce, delay]);

  const { w } = layout;
  return (
    <svg
      className="hw"
      role="img"
      aria-label={text}
      viewBox={`-6 0 ${w + 12} 140`}
      style={{ width: `${(w + 12) * U}em`, height: `${140 * U}em`, verticalAlign: `${-40 * U}em`, marginLeft: "-.05em", color }}
    >
      <line x1={-6} x2={w + 6} y1={100} y2={100} className="guide" />
      <line x1={-6} x2={w + 6} y1={50} y2={50} className="guide dash" />
      <g ref={g} fill="currentColor">
        {layout.items.map((it, i) => (
          <path key={i} d={reduce ? strokePath(it.pts, 50 * 1.05, true) : ""} />
        ))}
      </g>
    </svg>
  );
}
