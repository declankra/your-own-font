// One word being written (SPEC.md §5.3–5.4, §6).
//
// While the pen moves, the gap rule (§6.1) decides which letter a new stroke feeds, so the
// prompt fills with zero latency. After every pen-up the pipeline worker re-solves the whole
// word with the letter model (§6.2) and `applySolve` settles the fills to match. What the
// person sees filled is exactly what goes into the font: `toWordInk` exports these pieces.

import type { InkStroke, WordInk } from "@your-own-font/pipeline/font";
import type { SegmentResult, Split } from "@your-own-font/pipeline/letter-model";
import { TARGET_LENGTH } from "@your-own-font/pipeline/live";

export type PadPoint = [number, number, number, number]; // x, y, pressure, ms since the word began

export interface PadStroke {
  id: number;
  points: PadPoint[];
  pen: boolean;
  /** cumulative path length at each point */
  cum: number[];
}

export interface Piece {
  a: number;
  b: number;
  letter: number;
}

export interface Guides {
  baseline: number;
  xHeight: number;
}

let ids = 1;

export class WordSession {
  readonly text: string;
  readonly chars: string[];
  guides: Guides;
  strokes: PadStroke[] = [];
  pieces = new Map<number, Piece[]>();
  /** the letter new ink goes to */
  current = 0;
  /** the stroke being drawn */
  live: PadStroke | null = null;
  /** bumps whenever committed strokes change; stale solver results are dropped */
  version = 0;
  /** a letter no grouping fits (§6.3), shown grey with a nudge */
  stuck: number | null = null;
  readonly key: string;
  private t0 = 0;

  constructor(text: string, guides: Guides, key: string) {
    this.text = text;
    this.chars = [...text];
    this.guides = guides;
    this.key = key;
  }

  get empty(): boolean {
    return this.strokes.length === 0 && !this.live;
  }

  // ------------------------------------------------------------------ measuring

  private pieceLen(s: PadStroke, p: Piece): number {
    return s.cum[p.b] - s.cum[p.a] + 0.12 * this.guides.xHeight; // every stroke counts, so a dot registers
  }

  letterInk(j: number): { len: number; maxX: number; count: number } {
    let len = 0;
    let maxX = -Infinity;
    let count = 0;
    const add = (s: PadStroke, p: Piece) => {
      len += this.pieceLen(s, p);
      count++;
      for (let i = p.a; i <= p.b; i++) if (s.points[i][0] > maxX) maxX = s.points[i][0];
    };
    for (const s of this.strokes) for (const p of this.pieces.get(s.id) ?? []) if (p.letter === j) add(s, p);
    if (this.live && this.current === j) add(this.live, { a: 0, b: this.live.points.length - 1, letter: j });
    return { len, maxX, count };
  }

  fill(j: number): number {
    const target = (TARGET_LENGTH[this.chars[j]] ?? 3) * this.guides.xHeight;
    return Math.min(1, this.letterInk(j).len / target);
  }

  fills(): number[] {
    return this.chars.map((_, j) => this.fill(j));
  }

  // ------------------------------------------------------------------ the pen

  /** Pen down: the gap rule picks the letter. Returns the letter that just completed, if any. */
  penDown(x: number, y: number, pressure: number, pen: boolean, now: number): number | null {
    if (this.empty) this.t0 = now;
    let popped: number | null = null;
    const L = this.letterInk(this.current);
    const gap = (this.fill(this.current) >= 1 ? 0.05 : 0.3) * this.guides.xHeight;
    if (L.count > 0 && x > L.maxX + gap && this.current < this.chars.length - 1) {
      popped = this.current;
      this.current++;
    }
    this.live = { id: ids++, points: [[x, y, pressure, now - this.t0]], pen, cum: [0] };
    this.stuck = null;
    return popped;
  }

  /** Returns false when the point is under 0.6px from the last one (ignored, SPEC.md §5.2). */
  penMove(x: number, y: number, pressure: number, now: number): boolean {
    const s = this.live;
    if (!s) return false;
    const q = s.points[s.points.length - 1];
    const d = Math.hypot(x - q[0], y - q[1]);
    if (d < 0.6) return false;
    s.points.push([x, y, pressure, now - this.t0]);
    s.cum.push(s.cum[s.cum.length - 1] + d);
    return true;
  }

  penUp(): PadStroke | null {
    const s = this.live;
    if (!s) return null;
    this.live = null;
    this.strokes.push(s);
    this.pieces.set(s.id, [{ a: 0, b: s.points.length - 1, letter: this.current }]);
    this.version++;
    return s;
  }

  // ------------------------------------------------------------------ the solver

  /** What the worker needs: strokes as [x, y, p, t] arrays, in writing order. */
  solverInput(): { strokes: number[][][]; version: number } {
    return { strokes: this.strokes.map((s) => s.points), version: this.version };
  }

  /**
   * Settle to the model's grouping. Returns the letters whose fill changed, or null when the
   * result is stale (the ink changed since it was asked for).
   */
  applySolve(r: SegmentResult, version: number, partial: boolean): number[] | null {
    if (version !== this.version) return null;
    const before = this.fills();
    const bySplit = new Map<number, Split[]>();
    for (const sp of r.splits) bySplit.set(sp.stroke, [...(bySplit.get(sp.stroke) ?? []), sp]);
    this.strokes.forEach((s, i) => {
      const n = s.points.length;
      const sp = (bySplit.get(i) ?? []).sort((p, q) => p.atPoint - q.atPoint);
      if (!sp.length) {
        this.pieces.set(s.id, [{ a: 0, b: n - 1, letter: r.letterOfStroke[i] }]);
        return;
      }
      const ps: Piece[] = [];
      let a = 0;
      for (const cut of sp) {
        ps.push({ a, b: cut.atPoint, letter: cut.left });
        a = cut.atPoint;
      }
      ps.push({ a, b: n - 1, letter: sp[sp.length - 1].right });
      this.pieces.set(s.id, ps);
    });
    if (partial && !this.live) this.current = Math.max(0, Math.min(this.chars.length - 1, r.lettersWritten - 1));
    this.stuck = !partial && r.unresolved !== undefined ? r.unresolved : null;
    const after = this.fills();
    return after.map((f, j) => (Math.abs(f - before[j]) > 1e-3 ? j : -1)).filter((j) => j >= 0);
  }

  // ------------------------------------------------------------------ fixing things

  undo(): PadStroke | null {
    const s = this.strokes.pop() ?? null;
    if (!s) return null;
    const ps = this.pieces.get(s.id) ?? [];
    this.pieces.delete(s.id);
    // the letter it fed becomes active again, so the next stroke goes back into it
    if (ps.length) this.current = ps[ps.length - 1].letter;
    this.stuck = null;
    this.version++;
    return s;
  }

  /** Clear one letter's ink (strokes shared with a neighbour keep the neighbour's part). */
  redoLetter(j: number): void {
    const next: PadStroke[] = [];
    for (const s of this.strokes) {
      const ps = this.pieces.get(s.id) ?? [];
      if (!ps.some((p) => p.letter === j)) {
        next.push(s);
        continue;
      }
      this.pieces.delete(s.id);
      // keep each run of other letters' pieces as a stroke of its own
      let run: Piece[] = [];
      const flush = () => {
        if (!run.length) return;
        const a = run[0].a;
        const b = run[run.length - 1].b;
        const pts = s.points.slice(a, b + 1);
        if (pts.length) {
          const cum = [0];
          for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
          const ns: PadStroke = { id: ids++, points: pts, pen: s.pen, cum };
          next.push(ns);
          this.pieces.set(ns.id, run.map((p) => ({ a: p.a - a, b: p.b - a, letter: p.letter })));
        }
        run = [];
      };
      for (const p of ps) {
        if (p.letter === j) flush();
        else run.push(p);
      }
      flush();
    }
    this.strokes = next;
    this.current = j;
    this.stuck = null;
    this.version++;
  }

  clear(): void {
    this.strokes = [];
    this.pieces.clear();
    this.live = null;
    this.current = 0;
    this.stuck = null;
    this.version++;
  }

  // ------------------------------------------------------------------ export

  /** Pad pixels → glyph units (x-height 500, baseline 0, y down; x = 0 at the left ink edge). */
  toWordInk(): WordInk & { width: number } {
    const { baseline, xHeight } = this.guides;
    const k = 500 / xHeight;
    let x0 = Infinity;
    let x1 = -Infinity;
    for (const s of this.strokes)
      for (const p of s.points) {
        x0 = Math.min(x0, p[0]);
        x1 = Math.max(x1, p[0]);
      }
    const strokes: InkStroke[] = this.strokes.map((s) => ({
      pen: s.pen,
      points: s.points.map(([x, y, p, t]) => [(x - x0) * k, (y - baseline) * k, p, t]),
    }));
    const letterOfStroke: number[] = [];
    const splits: Split[] = [];
    this.strokes.forEach((s, i) => {
      const ps = (this.pieces.get(s.id) ?? []).slice().sort((p, q) => p.a - q.a);
      letterOfStroke.push(ps.length ? ps[ps.length - 1].letter : 0);
      for (let k2 = 1; k2 < ps.length; k2++)
        if (ps[k2].letter !== ps[k2 - 1].letter && ps[k2].a > 0 && ps[k2].a < s.points.length - 1)
          splits.push({ stroke: i, atPoint: ps[k2].a, left: ps[k2 - 1].letter, right: ps[k2].letter });
    });
    return { text: this.text, strokes, letterOfStroke, splits, width: (x1 - x0) * k };
  }

  /** Where the word's ink sits on the pad, for the flight into the sentence. */
  inkBounds(): { x0: number; x1: number } {
    let x0 = Infinity;
    let x1 = -Infinity;
    for (const s of this.strokes)
      for (const p of s.points) {
        x0 = Math.min(x0, p[0]);
        x1 = Math.max(x1, p[0]);
      }
    return { x0, x1 };
  }
}
