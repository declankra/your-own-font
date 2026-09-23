// Tune the solver's weights on validation words (never on test).
//
//   tsx scripts/tune-segment.ts --model <letter-model.bin> --out <segmenter.json> <val.jsonl>
//
// Geometry mode's prior weights are tuned for geometry mode first, so the baseline the model
// is compared with is the best geometry we have. The model mode then keeps those priors and
// tunes only how much geometry to add to -log P(letter), and how lenient to be with the
// letter still being written (measured after every pen-up).
import { readFileSync, writeFileSync } from "node:fs";
import type { FixtureWord } from "../src/letter-model/fixture.ts";
import { LetterModel } from "../src/letter-model/model.ts";
import { DEFAULT_PARAMS, segment, type SegmentParams } from "../src/letter-model/segment.ts";
import { letterMatches, polylines, readSessions } from "./common.ts";

const arg = (n: string) => {
  const i = process.argv.indexOf(n);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const model = new LetterModel(readFileSync(arg("--model")!));
const files = process.argv.slice(2).filter((a, i, all) => !a.startsWith("--") && !all[i - 1]?.startsWith("--"));
const words: FixtureWord[] = files.flatMap((f) => readSessions(f).flatMap((s) => s.words));
const cache = new Map<string, Map<string, Float32Array>>();

function score(mode: "model" | "geometry", params: Partial<SegmentParams>): number {
  let ok = 0;
  let n = 0;
  words.forEach((w, k) => {
    let c = cache.get(`${k}`);
    if (!c) cache.set(`${k}`, (c = new Map()));
    const pp = { ...DEFAULT_PARAMS, ...params };
    if (mode === "geometry" && params.cutCost !== undefined) pp.geoCutCost = params.cutCost;
    const r = segment(polylines(w), w.text, w.guides, { mode, model, params: pp, cache: c });
    const m = letterMatches(w, r);
    ok += m.filter(Boolean).length;
    n += m.length;
  });
  return (100 * ok) / n;
}
function settle(params: Partial<SegmentParams>): number {
  let ok = 0;
  let n = 0;
  words.forEach((w, k) => {
    const strokes = polylines(w);
    const last = new Array<number>([...w.text].length).fill(-1);
    w.letterOfStroke.forEach((l, s) => (last[l] = Math.max(last[l], s)));
    for (const sp of w.splits) last[sp.left] = Math.max(last[sp.left], sp.stroke);
    for (let p = 1; p < strokes.length; p++) {
      const r = segment(strokes.slice(0, p), w.text, w.guides, { mode: "model", model, partial: true, params: { ...DEFAULT_PARAMS, ...params }, cache: cache.get(`${k}`) });
      const m = letterMatches(w, r, p);
      m.forEach((good, j) => {
        if (last[j] < 0 || last[j] >= p - 1) return;
        n++;
        if (good) ok++;
      });
    }
  });
  return (100 * ok) / n;
}

const log: string[] = [];
const say = (s: string) => {
  console.log(s);
  log.push(s);
};
// 1. geometry priors, for geometry mode
let geo: Partial<SegmentParams> = {};
let best = -1;
for (const wWidth of [0.5, 1, 2])
  for (const wVert of [0.3, 0.6, 1.2])
    for (const wGap of [2, 6, 15])
      for (const wCount of [0.2, 0.5, 1])
        for (const cutCost of [0, 1, 3, 5, 8]) {
          const p = { wWidth, wVert, wGap, wCount, cutCost };
          const s = score("geometry", p);
          if (s > best) {
            best = s;
            geo = p;
          }
        }
say(`geometry: ${best.toFixed(2)}% with ${JSON.stringify(geo)} (defaults ${score("geometry", {}).toFixed(2)}%)`);
// 2. model mode: how much geometry to add, and what a cut costs (the model's own evidence
//    about cuts differs from geometry's, so the cut cost is tuned per mode; the geometry
//    mode keeps its best cut cost through `geoCutCost` below)
let mp: Partial<SegmentParams> = { ...geo };
best = -1;
for (const wGeoInModel of [0, 0.1, 0.2, 0.35, 0.5, 0.8])
  for (const cutCost of [0, 1, 2, 4, 6, 10]) {
    const p = { ...geo, wGeoInModel, cutCost };
    const s = score("model", p);
    if (s > best) {
      best = s;
      mp = p;
    }
  }
say(`model: ${best.toFixed(2)}% with wGeoInModel ${mp.wGeoInModel}, cutCost ${mp.cutCost}`);
// 3. leniency for the letter being written, on the after-every-pen-up metric
let bs = -1;
let cap = DEFAULT_PARAMS.partialCap;
let bonus = DEFAULT_PARAMS.partialLetterBonus;
for (const partialCap of [1.5, 2.5, 3.5, 5])
  for (const partialLetterBonus of [0, 3, 5, 7, 10, 14, 20]) {
    const s = settle({ ...mp, partialCap, partialLetterBonus });
    if (s > bs) {
      bs = s;
      cap = partialCap;
      bonus = partialLetterBonus;
    }
  }
mp.partialCap = cap;
mp.partialLetterBonus = bonus;
say(`settle after each pen-up: ${bs.toFixed(2)}% with partialCap ${cap}, partialLetterBonus ${bonus}`);
// geometry mode reads `geoCutCost` (so each mode keeps its own best cut cost)
writeFileSync(arg("--out")!, JSON.stringify({ ...mp, geoCutCost: geo.cutCost, _tuning: log }, null, 1));
