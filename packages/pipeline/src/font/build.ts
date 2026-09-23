/// <reference path="./opentype.d.ts" />
// The whole font pipeline, stage by stage (SPEC.md §7). Each stage reports an event as soon as
// its work is done, and the Making animation waits on those events: it never shows a step
// finished before the work behind it is.
//
//   cast   per letter a–z: perfect-freehand outlines → polygon-clipping union → fit-curve
//   set    metrics: side bearings from the writer's own spacing, advances from ink bounds
//   ink    calt variants from repeated letters, capitals from lowercase, ' from the comma
//   press  opentype.js writes a CFF .otf

import { Font, Glyph, Path } from "opentype.js";
import type { LetterModel } from "../letter-model/model.ts";
import { contourBounds, contoursToPath, glyphContours, transformContours, type Contour, type Pt } from "./outline.ts";
import { XH } from "./pen.ts";
import { chooseVariants, letterSamples, scoreSamples, writerSidebearing } from "./samples.ts";
import type { BuildEvent, BuildInput, BuildResult, BuiltGlyph, InkStroke, LetterSample } from "./types.ts";
import { LOWER } from "./alt.ts";

export { altSequence } from "./alt.ts";

export const FAMILY = "My Hand";
export { LOWER };
export const PUNCT_ORDER = ",.'!?";
const UNITS_PER_EM = 1000;
const CAP_TARGET = 660; // centre-line top of a capital; with the pen, capitals reach ~700
const SPACE = 300;

const GLYPH_NAME: Record<string, string> = {
  ",": "comma",
  ".": "period",
  "'": "quotesingle",
  "!": "exclam",
  "?": "question",
};

export interface BuildOptions {
  model?: LetterModel | null;
  onEvent?: (e: BuildEvent) => void;
  /** Let the host breathe between glyphs (the worker passes a macrotask yield). */
  yieldEvery?: () => Promise<void>;
  now?: () => Date;
}

interface Made {
  char: string;
  name: string;
  variant: number;
  unicodes: number[];
  contours: Contour[]; // sample coordinates, y down
  strokes: InkStroke[]; // sample coordinates
  derived: boolean;
  from: { word: number; letter: number } | null; // the written letter, when there is one
  // filled by the set stage
  advance?: number;
  dx?: number;
}

function randomId(): string {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  const r = new Uint8Array(6);
  (globalThis.crypto ?? { getRandomValues: (a: Uint8Array) => a.map(() => Math.floor(Math.random() * 256)) }).getRandomValues(r);
  for (const b of r) s += abc[b % abc.length];
  return s;
}

function scaleStrokes(strokes: InkStroke[], s: number, dy = 0): InkStroke[] {
  return strokes.map((st) => ({
    pen: st.pen,
    points: st.points.map(([x, y, p, t]) => [x * s, y * s + dy, p, t] as [number, number, number, number]),
  }));
}

function inkTop(strokes: InkStroke[]): number {
  let top = Infinity;
  for (const st of strokes) for (const p of st.points) top = Math.min(top, p[1]);
  return top;
}

export async function buildFont(input: BuildInput, opts: BuildOptions = {}): Promise<BuildResult> {
  const emit = opts.onEvent ?? (() => {});
  const breathe = opts.yieldEvery ?? (async () => {});

  // ---- samples, scored so the best sample of each letter leads
  let samples: LetterSample[] = letterSamples(input.words);
  for (const [ch, strokes] of Object.entries(input.overrides ?? {})) {
    if (!strokes.length) continue;
    samples = samples.filter((s) => s.char !== ch);
    samples.push({ char: ch, strokes, word: -1, letter: -1, score: NaN });
  }
  scoreSamples(samples, opts.model ?? null);
  const { chosen, dropped } = chooseVariants(samples);

  // ---- cast: a–z in order, one event each; then the punctuation that was written
  emit({ type: "stage", stage: "cast" });
  const made: Made[] = [];
  const missing: string[] = [];
  const cast = (ch: string, sample: LetterSample, variant: number): Made | null => {
    const contours = glyphContours(sample.strokes);
    if (!contours.length) return null;
    const base = GLYPH_NAME[ch] ?? ch;
    const m: Made = {
      char: ch,
      name: variant ? `${base}.alt` : base,
      variant,
      unicodes: variant ? [] : [ch.codePointAt(0)!],
      contours,
      strokes: sample.strokes,
      derived: false,
      from: sample.word >= 0 ? { word: sample.word, letter: sample.letter } : null,
    };
    made.push(m);
    return m;
  };
  let index = 0;
  for (const ch of LOWER) {
    const list = chosen.get(ch);
    const m = list ? cast(ch, list[0], 0) : null;
    if (!m) missing.push(ch);
    else emit({ type: "glyph", index, glyph: preview(m) });
    index++;
    await breathe();
  }
  for (const ch of PUNCT_ORDER) {
    const list = chosen.get(ch);
    if (list) cast(ch, list[0], 0);
  }

  // ---- set: side bearings from the writer's spacing; advances from ink bounds
  emit({ type: "stage", stage: "set" });
  const sb = writerSidebearing(input.words);
  const place = (m: Made) => {
    const b = contourBounds(m.contours);
    m.dx = sb - b.xMin;
    m.advance = Math.round(b.xMax - b.xMin + 2 * sb);
  };
  made.forEach(place);
  emit({ type: "metrics", sidebearing: sb, space: SPACE });
  await breathe();

  // ---- ink: calt alternates, capitals, and an apostrophe from the comma if none was written
  emit({ type: "stage", stage: "ink" });
  const alternates: string[] = [];
  for (const ch of [...LOWER, ...PUNCT_ORDER]) {
    const list = chosen.get(ch);
    if (!list || list.length < 2 || !made.some((m) => m.char === ch && m.variant === 0)) continue;
    const m = cast(ch, list[1], 1);
    if (m) {
      place(m);
      alternates.push(ch);
    }
    await breathe();
  }
  for (const ch of LOWER) {
    const base = made.find((m) => m.char === ch && m.variant === 0);
    if (!base) continue;
    const s = Math.min(1.6, Math.max(0.7, CAP_TARGET / Math.max(60, -inkTop(base.strokes))));
    const strokes = scaleStrokes(base.strokes, s);
    const contours = glyphContours(strokes);
    if (!contours.length) continue;
    const up = ch.toUpperCase();
    const m: Made = { char: up, name: up, variant: 0, unicodes: [up.codePointAt(0)!], contours, strokes, derived: true, from: null };
    place(m);
    made.push(m);
  }
  const apostrophe = made.find((m) => m.char === "'" && m.variant === 0);
  if (apostrophe) apostrophe.unicodes.push(0x2019);
  else {
    const comma = made.find((m) => m.char === "," && m.variant === 0);
    if (comma) {
      const strokes = scaleStrokes(comma.strokes, 1, -800 - inkTop(comma.strokes));
      const contours = glyphContours(strokes);
      if (contours.length) {
        const m: Made = { char: "'", name: "quotesingle", variant: 0, unicodes: [0x27, 0x2019], contours, strokes, derived: true, from: null };
        place(m);
        made.push(m);
      }
    }
  }
  emit({ type: "variants", alternates, dropped });
  await breathe();

  // ---- press: write the .otf
  emit({ type: "stage", stage: "press" });
  const id = input.id ?? randomId();
  const postScriptName = `MyHand-${id}`;
  const otf = writeOtf(made, postScriptName, opts.now?.() ?? new Date());
  const glyphs = made.map(preview);
  const result: BuildResult = { otf, familyName: FAMILY, postScriptName, glyphs, missing };
  emit({ type: "built", result });
  return result;
}

/** A glyph for the screen: outline path and strokes in the glyph's own coordinates. */
function preview(m: Made): BuiltGlyph {
  let dx = m.dx;
  let advance = m.advance;
  if (dx === undefined || advance === undefined) {
    // before the set stage: centre on the ink with a provisional bearing
    const b = contourBounds(m.contours);
    dx = 40 - b.xMin;
    advance = Math.round(b.xMax - b.xMin + 80);
  }
  const shift = (p: Pt): Pt => [p[0] + dx!, p[1]];
  const contours = transformContours(m.contours, shift);
  return {
    name: m.name,
    char: m.char,
    variant: m.variant,
    advance,
    d: contoursToPath(contours),
    bounds: contourBounds(contours),
    strokes: m.strokes.map((st) => ({ pen: st.pen, points: st.points.map(([x, y, p, t]) => [x + dx!, y, p, t] as [number, number, number, number]) })),
    derived: m.derived,
    ...(m.from ? { from: { ...m.from, dx: dx! } } : {}),
  };
}

function toOtPath(cs: Contour[], dx: number): Path {
  const path = new Path();
  const X = (p: Pt) => Math.round(p[0] + dx);
  const Y = (p: Pt) => Math.round(-p[1]); // y up in the font
  for (const c of cs) {
    path.moveTo(X(c.start), Y(c.start));
    for (const [a, b, e] of c.curves) path.curveTo(X(a), Y(a), X(b), Y(b), X(e), Y(e));
    path.close();
  }
  return path;
}

function writeOtf(made: Made[], postScriptName: string, now: Date): ArrayBuffer {
  const order = (m: Made) => {
    const lower = LOWER.indexOf(m.char);
    const upper = LOWER.toUpperCase().indexOf(m.char);
    const punct = PUNCT_ORDER.indexOf(m.char);
    const slot = lower >= 0 ? lower : punct >= 0 ? 26 + punct : 40 + upper;
    return m.variant * 100 + slot;
  };
  const sorted = made.slice().sort((a, b) => order(a) - order(b));

  const notdefPath = new Path();
  notdefPath.moveTo(60, 0);
  notdefPath.lineTo(60, 700);
  notdefPath.lineTo(440, 700);
  notdefPath.lineTo(440, 0);
  notdefPath.close();
  notdefPath.moveTo(110, 50);
  notdefPath.lineTo(390, 50);
  notdefPath.lineTo(390, 650);
  notdefPath.lineTo(110, 650);
  notdefPath.close();
  const glyphs: Glyph[] = [
    new Glyph({ name: ".notdef", advanceWidth: 500, path: notdefPath }),
    new Glyph({ name: "space", unicodes: [0x20, 0xa0], advanceWidth: SPACE, path: new Path() }),
  ];
  let yMin = 0;
  let yMax = 0;
  for (const m of sorted) {
    const b = contourBounds(m.contours);
    yMin = Math.min(yMin, -b.yMax);
    yMax = Math.max(yMax, -b.yMin);
    glyphs.push(new Glyph({ name: m.name, unicodes: m.unicodes, advanceWidth: m.advance!, path: toOtPath(m.contours, m.dx!) }));
  }
  const indexOf = new Map<string, number>();
  glyphs.forEach((g, i) => indexOf.set(g.name, i));

  const ascender = Math.max(900, Math.ceil(yMax));
  const descender = Math.min(-300, Math.floor(yMin));
  const year = now.getUTCFullYear();
  const font = new Font({
    familyName: FAMILY,
    styleName: "Regular",
    fullName: FAMILY,
    postScriptName,
    manufacturer: "your own font",
    designer: "You",
    description: "A font of your own handwriting, drawn on your own device.",
    copyright: `Copyright ${year} the person who wrote it.`,
    license:
      "You own this font outright. It was made from your own handwriting, on your own device; nothing was uploaded. Use it, share it, or sell things made with it, however you like.",
    version: "Version 1.000",
    unitsPerEm: UNITS_PER_EM,
    ascender,
    descender,
    weightClass: 400,
    glyphs,
    tables: {
      os2: {
        usWeightClass: 400,
        sxHeight: XH,
        sCapHeight: 700,
        sTypoLineGap: 0,
        usWinAscent: ascender,
        usWinDescent: -descender,
        fsType: 0, // installable embedding: it's theirs
      },
    },
  });
  // A unique ID per build, so two builds can be installed side by side.
  for (const platform of ["unicode", "macintosh", "windows"]) {
    font.names[platform].uniqueID = { en: `your own font: ${postScriptName}` };
  }

  // calt: a letter written twice alternates between its two forms. A glyph becomes its
  // alternate whenever the glyph before it is a default letter, so repeats never look stamped
  // ("ll" → l l.alt) and the rhythm doesn't depend on which letters have alternates.
  const withAlt = sorted.filter((m) => m.variant === 1).map((m) => GLYPH_NAME[m.char] ?? m.char);
  if (withAlt.length) {
    const base = withAlt.map((n) => indexOf.get(n)!).filter((i) => i !== undefined);
    const pairs = withAlt.map((n) => [indexOf.get(n)!, indexOf.get(`${n}.alt`)!] as const).sort((a, b) => a[0] - b[0]);
    const defaults = sorted.filter((m) => m.variant === 0 && !m.derived && LOWER.includes(m.char)).map((m) => indexOf.get(m.name)!);
    defaults.sort((a, b) => a - b);
    base.sort((a, b) => a - b);
    const langSys = { reserved: 0, reqFeatureIndex: 0xffff, featureIndexes: [0] };
    font.tables.gsub = {
      version: 1,
      scripts: [
        { tag: "DFLT", script: { defaultLangSys: langSys, langSysRecords: [] } },
        { tag: "latn", script: { defaultLangSys: langSys, langSysRecords: [] } },
      ],
      features: [{ tag: "calt", feature: { featureParams: 0, lookupListIndexes: [1] } }],
      lookups: [
        {
          lookupType: 1,
          lookupFlag: 0,
          subtables: [{ substFormat: 2, coverage: { format: 1, glyphs: pairs.map((p) => p[0]) }, substitute: pairs.map((p) => p[1]) }],
        },
        {
          lookupType: 6,
          lookupFlag: 0,
          subtables: [
            {
              substFormat: 3,
              backtrackCoverage: [{ format: 1, glyphs: defaults }],
              inputCoverage: [{ format: 1, glyphs: base }],
              lookaheadCoverage: [],
              lookupRecords: [{ sequenceIndex: 0, lookupListIndex: 0 }],
            },
          ],
        },
      ],
    };
  }
  return font.toArrayBuffer();
}
