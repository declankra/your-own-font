"use client";
// The note on Done (SPEC.md §8.1): written back to you in your own font, replaying each glyph's
// real stroke order. Repeated letters take their forms by the same rule as the font's calt.
import { altSequence } from "@your-own-font/pipeline/alt";
import type { BuildResult, BuiltGlyph } from "@your-own-font/pipeline/font";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { strokePath } from "@/lib/ink";
import { writeOn, type WriteItem } from "@/lib/write-on";

export const NOTE = "hello, it's me. well, it's you. this is your own hand, and it's all yours now.";
const SPACE = 300;
const TOP = -1000;
const HEIGHT = 1450;

interface Placed {
  glyph: BuiltGlyph;
  x: number;
}

function layout(result: BuildResult, maxUnits: number): { lines: Placed[][]; widths: number[] } {
  const byKey = new Map<string, BuiltGlyph>();
  for (const g of result.glyphs) byKey.set(`${g.char}:${g.variant}`, g);
  const forms = altSequence(NOTE, (ch) => byKey.has(`${ch}:1`));
  const words: { glyphs: BuiltGlyph[]; w: number }[] = [];
  let cur: BuiltGlyph[] = [];
  [...NOTE].forEach((ch, i) => {
    if (ch === " ") {
      words.push({ glyphs: cur, w: cur.reduce((a, g) => a + g.advance, 0) });
      cur = [];
      return;
    }
    const g = byKey.get(`${ch}:${forms[i]}`) ?? byKey.get(`${ch}:0`);
    if (g) cur.push(g);
  });
  words.push({ glyphs: cur, w: cur.reduce((a, g) => a + g.advance, 0) });
  const lines: Placed[][] = [[]];
  const widths = [0];
  for (const w of words) {
    let lw = widths[widths.length - 1];
    if (lw > 0 && lw + SPACE + w.w > maxUnits) {
      lines.push([]);
      widths.push(0);
      lw = 0;
    }
    let x = lw > 0 ? lw + SPACE : 0;
    for (const g of w.glyphs) {
      lines[lines.length - 1].push({ glyph: g, x });
      x += g.advance;
    }
    widths[widths.length - 1] = x;
  }
  return { lines, widths };
}

export function Note({ result, animate, onWritten }: { result: BuildResult; animate: boolean; onWritten?: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [lh, setLh] = useState(58);
  const written = useRef(false);
  const cb = useRef(onWritten);
  cb.current = onWritten;

  useLayoutEffect(() => {
    const el = box.current!;
    const measure = () => {
      setWidth(el.clientWidth);
      setLh(parseFloat(getComputedStyle(el).getPropertyValue("--lh")) || 58);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const maxUnits = width ? (width / lh) * HEIGHT : 0;
  const { lines, widths } = useMemo(() => (maxUnits ? layout(result, Math.max(2400, maxUnits - 40)) : { lines: [], widths: [] }), [result, maxUnits]);

  useEffect(() => {
    const el = box.current;
    if (!el || !lines.length) return;
    const paths = Array.from(el.querySelectorAll<SVGPathElement>("path.nib"));
    const items: WriteItem[] = [];
    let k = 0;
    for (const line of lines)
      for (const p of line)
        for (const s of p.glyph.strokes) items.push({ el: paths[k++], pts: s.points.map(([x, y, pr]) => [x + p.x, y, pr]), xh: 500, pen: s.pen });
    let alive = true;
    // about 5 s at a natural pen speed, whatever the handwriting's size
    let total = 0;
    for (const it of items) for (let i = 1; i < it.pts.length; i++) total += Math.hypot(it.pts[i][0] - it.pts[i - 1][0], it.pts[i][1] - it.pts[i - 1][1]);
    const lift = 22;
    const secs = Math.max(2, 5 - (items.length * lift) / 1000);
    const instant = !animate || written.current;
    writeOn(items, { speed: total / 500 / secs, lift, instant, alive: () => alive }).then(() => {
      if (!alive) return;
      written.current = true;
      cb.current?.();
    });
    return () => {
      alive = false;
    };
  }, [lines, animate]);

  return (
    <div className="note" ref={box} role="img" aria-label={`A note written in your font: ${NOTE}`}>
      {lines.map((line, li) => {
        const w = Math.max(widths[li], maxUnits);
        return (
          <svg key={li} viewBox={`0 ${TOP} ${w} ${HEIGHT}`} preserveAspectRatio="xMinYMid meet" aria-hidden="true">
            <line x1={0} x2={w} y1={0} y2={0} className="guide" opacity={0.7} />
            <g fill="currentColor">
              {line.flatMap((p, gi) =>
                p.glyph.strokes.map((s, si) => (
                  <path
                    key={`${gi}:${si}`}
                    className="nib"
                    d={!animate || written.current ? strokePath(s.points.map(([x, y, pr]) => [x + p.x, y, pr]), 500, s.pen) : ""}
                  />
                )),
              )}
            </g>
          </svg>
        );
      })}
    </div>
  );
}
