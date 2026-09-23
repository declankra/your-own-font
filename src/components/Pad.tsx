"use client";
// The writing area (SPEC.md §5.1–5.2): the page itself, four guides that fade at the edges,
// one felt-tip pen. Pointer samples are collected with getCoalescedEvents and moves under
// 0.6px are ignored. The stroke in progress is painted directly, outside React, every frame.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { strokePath } from "@/lib/ink";
import type { Guides, PadStroke, WordSession } from "@/lib/word-session";

export interface PadSize {
  W: number;
  H: number;
  xh: number;
  base: number;
}

const pathCache = new WeakMap<PadStroke, { xh: number; d: string }>();
function committedPath(s: PadStroke, xh: number): string {
  const c = pathCache.get(s);
  if (c && c.xh === xh) return c.d;
  const d = strokePath(s.points, xh, s.pen, true);
  pathCache.set(s, { xh, d });
  return d;
}

export function padGuides(W: number, H: number): PadSize {
  const xh = Math.max(44, Math.min(72, H * 0.24));
  return { W, H, xh, base: Math.round(H * 0.64) };
}

export function Pad({
  session,
  version,
  disabled,
  ink,
  label,
  onSize,
  onPenDown,
  onPenMove,
  onPenUp,
  children,
}: {
  session: WordSession | null;
  version: number;
  disabled?: boolean;
  ink: string;
  label: string;
  onSize: (size: PadSize, guides: Guides) => void;
  onPenDown: (popped: number | null) => void;
  onPenMove: () => void;
  onPenUp: () => void;
  children?: ReactNode;
}) {
  const el = useRef<HTMLDivElement>(null);
  const livePath = useRef<SVGPathElement>(null);
  const pointer = useRef<{ id: number; type: string } | null>(null);
  const [size, setSize] = useState<PadSize | null>(null);
  const sizeRef = useRef<PadSize | null>(null);
  const cb = useRef({ onSize, onPenDown, onPenMove, onPenUp, session, disabled });
  cb.current = { onSize, onPenDown, onPenMove, onPenUp, session, disabled };

  useLayoutEffect(() => {
    const node = el.current!;
    const measure = () => {
      const r = node.getBoundingClientRect();
      const next = padGuides(r.width, r.height);
      const prev = sizeRef.current;
      if (prev && Math.abs(prev.W - next.W) < 0.5 && Math.abs(prev.H - next.H) < 0.5) return;
      sizeRef.current = next;
      setSize(next);
      cb.current.onSize(next, { baseline: next.base, xHeight: next.xh });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(node);
    return () => ro.disconnect();
  }, []);

  // pen cursor: a 9px dot in the current ink
  useEffect(() => {
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16'><circle cx='8' cy='8' r='4.5' fill='${ink}'/></svg>`;
    el.current!.style.cursor = `url("data:image/svg+xml,${encodeURIComponent(svg)}") 8 8, crosshair`;
  }, [ink]);

  useEffect(() => {
    const node = el.current!;
    const local = (e: PointerEvent): [number, number, number] => {
      const r = node.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top, e.pointerType === "pen" ? e.pressure || 0.5 : 0.5];
    };
    const paintLive = (last: boolean) => {
      const s = cb.current.session?.live;
      const p = livePath.current;
      if (!p) return;
      p.setAttribute("d", s && sizeRef.current ? strokePath(s.points, sizeRef.current.xh, s.pen, last) : "");
    };
    const down = (e: PointerEvent) => {
      const { session, disabled } = cb.current;
      if (!session || disabled || !sizeRef.current) return;
      if (pointer.current) return; // one pen at a time; a resting palm doesn't draw
      if (e.button !== 0 && e.pointerType === "mouse") return;
      e.preventDefault();
      try {
        node.setPointerCapture(e.pointerId);
      } catch {}
      pointer.current = { id: e.pointerId, type: e.pointerType };
      const [x, y, p] = local(e);
      const popped = session.penDown(x, y, p, e.pointerType === "pen", e.timeStamp);
      paintLive(false);
      cb.current.onPenDown(popped);
    };
    const move = (e: PointerEvent) => {
      const s = cb.current.session;
      if (!pointer.current || pointer.current.id !== e.pointerId || !s?.live) return;
      e.preventDefault();
      const evs = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [];
      let moved = false;
      for (const ev of evs.length ? evs : [e]) {
        const [x, y, p] = local(ev);
        moved = s.penMove(x, y, p, ev.timeStamp) || moved;
      }
      if (moved) {
        paintLive(false);
        cb.current.onPenMove();
      }
    };
    const up = (e: PointerEvent) => {
      if (!pointer.current || pointer.current.id !== e.pointerId) return;
      pointer.current = null;
      const s = cb.current.session;
      if (!s?.live) return;
      paintLive(true); // stays until React has drawn the committed stroke (no flicker)
      s.penUp();
      cb.current.onPenUp();
    };
    node.addEventListener("pointerdown", down);
    node.addEventListener("pointermove", move);
    node.addEventListener("pointerup", up);
    node.addEventListener("pointercancel", up);
    // stop iOS from scrolling or zooming while writing
    const block = (e: TouchEvent) => e.preventDefault();
    node.addEventListener("touchstart", block, { passive: false });
    node.addEventListener("touchmove", block, { passive: false });
    return () => {
      node.removeEventListener("pointerdown", down);
      node.removeEventListener("pointermove", move);
      node.removeEventListener("pointerup", up);
      node.removeEventListener("pointercancel", up);
      node.removeEventListener("touchstart", block);
      node.removeEventListener("touchmove", block);
    };
  }, []);

  useEffect(() => {
    if (!session?.live && livePath.current) livePath.current.setAttribute("d", "");
  }, [version, session]);

  const xh = size?.xh ?? 60;
  const strokes = session?.strokes ?? [];
  return (
    <div className="pad" ref={el} role="group" aria-label={label} data-version={version}>
      <svg viewBox={size ? `0 0 ${size.W} ${size.H}` : undefined} aria-hidden="true">
        {size && (
          <g className="guides" key={`${size.W}x${size.H}`}>
            <line x1={0} x2={size.W} y1={size.base - size.xh * 1.75} y2={size.base - size.xh * 1.75} className="guide" opacity={0.4} />
            <line x1={0} x2={size.W} y1={size.base - size.xh} y2={size.base - size.xh} className="guide dash" />
            <line x1={0} x2={size.W} y1={size.base} y2={size.base} className="guide" />
            <line x1={0} x2={size.W} y1={size.base + size.xh * 0.75} y2={size.base + size.xh * 0.75} className="guide" opacity={0.4} />
          </g>
        )}
        <g className="inkg" fill="currentColor">
          {strokes.map((s) => (
            <path key={s.id} d={committedPath(s, xh)} />
          ))}
          <path ref={livePath} />
        </g>
      </svg>
      {children}
    </div>
  );
}
