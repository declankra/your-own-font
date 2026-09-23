// The house hand: the brand's own handwriting, from design/homepage-prototype.html (`const G`).
// It writes "handwriting" on the hero and the "a" in the logo. It is drawn with the product's
// pen like any other ink, never set in a script font.
//
// Units: baseline at y = 100, x-height 50 (the x-height line is y = 50), y down.
// Also used by tests and the browser end-to-end run to write words as a person would.

export const HOUSE_XH = 50;
export const HOUSE_BASELINE = 100;

export const HOUSE: Record<string, { w: number; s: string[] }> = {
  a: { w: 48, s: ["M 38 58 C 32 49, 16 50, 10 64 C 4 80, 10 99, 24 99 C 34 99, 40 88, 41 74", "M 41 52 C 41 68, 41 84, 44 100"] },
  b: { w: 44, s: ["M 10 14 C 10 44, 10 74, 10 100", "M 10 70 C 14 56, 26 50, 34 53 C 44 58, 44 88, 34 97 C 26 103, 14 100, 10 92"] },
  c: { w: 40, s: ["M 37 58 C 30 49, 14 50, 9 64 C 4 80, 12 100, 26 99 C 32 99, 36 96, 39 92"] },
  d: { w: 48, s: ["M 38 58 C 32 49, 16 50, 10 64 C 4 80, 10 99, 24 99 C 34 99, 40 88, 41 74", "M 40 14 C 40 44, 41 74, 43 100"] },
  e: { w: 44, s: ["M 8 76 C 20 76, 34 73, 40 65 C 44 57, 36 50, 26 51 C 12 52, 6 66, 7 80 C 8 96, 26 104, 40 93"] },
  f: { w: 36, s: ["M 36 24 C 32 15, 22 13, 18 22 C 15 30, 15 50, 15 70 C 15 82, 15 92, 15 100", "M 4 52 C 12 51, 22 50, 32 49"] },
  g: { w: 48, s: ["M 38 58 C 32 49, 16 50, 10 64 C 5 79, 11 95, 24 95 C 34 95, 40 85, 41 72", "M 41 52 C 41 76, 42 104, 39 120 C 36 136, 16 140, 7 128"] },
  h: { w: 44, s: ["M 9 14 C 9 44, 9 74, 10 100", "M 10 72 C 14 58, 22 51, 30 52 C 40 53, 42 62, 42 74 C 42 84, 42 92, 43 100"] },
  i: { w: 20, s: ["M 10 54 C 10 70, 10 86, 11 100", "M 10 33 L 11 34"] },
  j: { w: 26, s: ["M 18 54 C 18 76, 19 104, 16 120 C 13 136, 2 138, -2 128", "M 18 33 L 19 34"] },
  k: { w: 44, s: ["M 10 14 C 10 44, 10 74, 11 100", "M 38 52 C 30 60, 20 68, 11 76 C 22 82, 32 90, 42 100"] },
  l: { w: 22, s: ["M 10 14 C 10 44, 9 72, 11 90 C 12 98, 16 101, 21 99"] },
  m: { w: 66, s: ["M 8 50 C 8 66, 8 84, 8 100 C 8 82, 11 58, 21 52 C 31 48, 34 58, 34 70 C 34 82, 34 92, 34 100 C 34 80, 38 56, 48 52 C 58 49, 61 58, 61 70 C 61 82, 61 92, 62 100"] },
  n: { w: 46, s: ["M 8 50 C 8 66, 8 84, 8 100 C 8 82, 12 58, 26 52 C 38 48, 43 58, 43 70 C 43 82, 43 92, 44 100"] },
  o: { w: 46, s: ["M 34 54 C 26 47, 12 52, 8 66 C 4 82, 12 100, 26 99 C 40 98, 45 84, 43 70 C 41 58, 34 51, 26 51"] },
  p: { w: 46, s: ["M 9 52 C 9 80, 9 110, 10 138", "M 9 66 C 14 54, 26 49, 34 52 C 44 57, 44 88, 33 96 C 24 102, 13 98, 9 90"] },
  q: { w: 50, s: ["M 38 58 C 32 49, 16 50, 10 64 C 4 80, 10 99, 24 99 C 34 99, 40 88, 41 74", "M 41 52 C 41 80, 41 110, 43 136 C 44 140, 48 139, 50 136"] },
  r: { w: 34, s: ["M 9 50 C 9 66, 9 84, 9 100", "M 9 72 C 12 58, 20 50, 32 53"] },
  s: { w: 40, s: ["M 36 58 C 30 49, 12 49, 11 60 C 10 72, 36 72, 38 86 C 40 100, 16 104, 5 94"] },
  t: { w: 34, s: ["M 16 26 C 16 48, 15 72, 17 88 C 18 99, 28 102, 34 95", "M 4 51 C 12 50, 22 50, 32 49"] },
  u: { w: 46, s: ["M 8 52 C 8 66, 8 80, 12 90 C 16 100, 32 102, 38 90 C 41 82, 42 66, 42 52 C 42 70, 42 86, 44 100"] },
  v: { w: 42, s: ["M 5 51 C 10 68, 16 84, 21 100 C 27 84, 33 68, 39 51"] },
  w: { w: 62, s: ["M 4 51 C 8 68, 12 84, 16 100 C 21 86, 26 72, 31 62 C 35 74, 40 88, 45 100 C 49 84, 54 68, 58 51"] },
  x: { w: 42, s: ["M 6 52 C 16 66, 26 84, 38 100", "M 37 51 C 27 66, 17 84, 5 100"] },
  y: { w: 46, s: ["M 6 52 C 9 68, 16 86, 29 98", "M 42 52 C 36 76, 30 100, 22 120 C 16 134, 8 136, 3 128"] },
  z: { w: 40, s: ["M 6 52 C 16 52, 26 51, 36 51 C 26 66, 16 84, 5 100 C 16 99, 26 99, 38 99"] },
  "'": { w: 12, s: ["M 7 16 C 7 22, 6 28, 4 33"] },
  ",": { w: 12, s: ["M 6 96 C 7 100, 6 106, 2 111"] },
  ".": { w: 12, s: ["M 5 99 L 6 100"] },
  "!": { w: 14, s: ["M 7 16 C 7 40, 7 62, 7 84", "M 7 99 L 8 100"] },
  "?": { w: 36, s: ["M 6 28 C 8 14, 30 10, 32 26 C 34 40, 18 46, 18 62 C 18 70, 18 76, 18 82", "M 18 99 L 19 100"] },
};

/** Letters whose last stroke is a dot or a crossbar, which writers often add at the end of the word. */
export const LATE_MARK = new Set(["i", "j", "t", "f", "x", "!", "?"]);

type P = [number, number];

function cubic(p0: P, c1: P, c2: P, e: P, t: number): P {
  const u = 1 - t;
  return [
    u * u * u * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * e[0],
    u * u * u * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * e[1],
  ];
}

/** Sample an SVG path of M/L/C commands at roughly `step` units, like getPointAtLength would. */
export function samplePath(d: string, step = 2): P[] {
  const tok = d.replace(/,/g, " ").trim().split(/\s+/);
  const dense: P[] = [];
  let cur: P = [0, 0];
  let cmd = "";
  for (let i = 0; i < tok.length; ) {
    if (/^[MLC]$/i.test(tok[i])) cmd = tok[i++].toUpperCase();
    if (cmd === "M") {
      cur = [+tok[i], +tok[i + 1]];
      i += 2;
      dense.push(cur);
      cmd = "L";
    } else if (cmd === "L") {
      const e: P = [+tok[i], +tok[i + 1]];
      i += 2;
      for (let k = 1; k <= 8; k++) dense.push([cur[0] + ((e[0] - cur[0]) * k) / 8, cur[1] + ((e[1] - cur[1]) * k) / 8]);
      cur = e;
    } else if (cmd === "C") {
      const c1: P = [+tok[i], +tok[i + 1]];
      const c2: P = [+tok[i + 2], +tok[i + 3]];
      const e: P = [+tok[i + 4], +tok[i + 5]];
      i += 6;
      for (let k = 1; k <= 48; k++) dense.push(cubic(cur, c1, c2, e, k / 48));
      cur = e;
    } else i++;
  }
  // resample evenly by arc length
  const cum = [0];
  for (let k = 1; k < dense.length; k++) cum.push(cum[k - 1] + Math.hypot(dense[k][0] - dense[k - 1][0], dense[k][1] - dense[k - 1][1]));
  const L = cum[cum.length - 1];
  const n = Math.max(2, Math.ceil(L / step));
  const out: P[] = [];
  let j = 0;
  for (let k = 0; k <= n; k++) {
    const s = (L * k) / n;
    while (j < cum.length - 2 && cum[j + 1] < s) j++;
    const seg = cum[j + 1] - cum[j] || 1;
    const t = Math.min(1, Math.max(0, (s - cum[j]) / seg));
    out.push([dense[j][0] + (dense[j + 1 < dense.length ? j + 1 : j][0] - dense[j][0]) * t, dense[j][1] + (dense[j + 1 < dense.length ? j + 1 : j][1] - dense[j][1]) * t]);
  }
  return out;
}

/** The house pen's pressure along a stroke (0..1 of its length), as in the prototype. */
export function housePressure(t: number): number {
  return 0.38 + 0.26 * Math.sin(Math.PI * Math.min(1, t * 1.15 + 0.04));
}

const cache = new Map<string, P[][]>();
/** Sampled strokes of one house-hand letter, in house units. */
export function houseStrokes(ch: string, step = 2): P[][] {
  const key = `${ch}:${step}`;
  let s = cache.get(key);
  if (!s) {
    const g = HOUSE[ch];
    if (!g) throw new Error(`no house glyph for ${JSON.stringify(ch)}`);
    s = g.s.map((d) => samplePath(d, step));
    cache.set(key, s);
  }
  return s;
}

export interface SynthOptions {
  /** gap between letters in house units (x-height 50); negative = touching */
  gap?: number;
  /** write dots and crossbars after the whole word */
  lateMarks?: boolean;
  /** 0..1: how much the hand wobbles */
  jitter?: number;
  seed?: number;
  step?: number;
}

export interface SynthWord {
  /** strokes in house units, in the order they were written */
  strokes: P[][];
  /** truth: letter index of each stroke */
  letterOfStroke: number[];
  width: number;
}

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

/** Write a word in the house hand, the way a person might: spacing, late marks, wobble. */
export function synthWord(word: string, o: SynthOptions = {}): SynthWord {
  const gap = o.gap ?? 6;
  const r = rng(o.seed ?? 7);
  const j = o.jitter ?? 0;
  const strokes: P[][] = [];
  const letterOfStroke: number[] = [];
  const late: { s: P[]; l: number }[] = [];
  let x = 4;
  [...word].forEach((ch, li) => {
    const g = HOUSE[ch];
    const slant = (r() - 0.5) * 0.12 * j;
    const sy = 1 + (r() - 0.5) * 0.14 * j;
    const dy = (r() - 0.5) * 6 * j;
    const glyph = houseStrokes(ch, o.step ?? 2);
    glyph.forEach((pts, k) => {
      const s: P[] = pts.map(([px, py]) => {
        const yy = HOUSE_BASELINE + (py - HOUSE_BASELINE) * sy + dy;
        return [x + px + (HOUSE_BASELINE - yy) * slant + (r() - 0.5) * 0.6 * j, yy + (r() - 0.5) * 0.6 * j];
      });
      const isMark = k === glyph.length - 1 && k > 0 && LATE_MARK.has(ch);
      if (o.lateMarks && isMark) late.push({ s, l: li });
      else {
        strokes.push(s);
        letterOfStroke.push(li);
      }
    });
    x += g.w + gap + (r() - 0.5) * 4 * j;
  });
  for (const m of late) {
    strokes.push(m.s);
    letterOfStroke.push(m.l);
  }
  return { strokes, letterOfStroke, width: x - gap };
}
