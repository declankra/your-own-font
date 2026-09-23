// Segmentation evaluation on fixture sessions (synthetic now, real writers in phase 2).
//
//   tsx scripts/eval-segment.ts --model <letter-model.bin> --out <report.json> <sessions.jsonl|json>...
//        [--params '{"wGeoInModel":0.3}'] [--geo-params '{...}'] [--no-live] [--no-incremental]
//
// Metric (SPEC.md §6.5): the share of letters whose ink exactly matches the labelled truth.
// A letter matches when it touches exactly the same strokes as the truth and, where a stroke
// is split, the cut lies within 0.5 x-height (measured along the pen path) of the true cut.
// Reported for the model, geometry-only, and the live gap rule, overall and by subset.

import { readFileSync, writeFileSync } from "node:fs";
import type { FixtureWord, Split } from "../src/letter-model/fixture.ts";
import { liveAssign } from "../src/letter-model/live.ts";
import { LetterModel } from "../src/letter-model/model.ts";
import { segment, type SegmentParams } from "../src/letter-model/segment.ts";
import { letterMatches, polylines, readSessions } from "./common.ts";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const files = process.argv.slice(2).filter((a, i, all) => !a.startsWith("--") && !all[i - 1]?.startsWith("--"));
const model = new LetterModel(readFileSync(arg("--model")!));
const params: Partial<SegmentParams> = JSON.parse(arg("--params") ?? "{}");
const geoParams: Partial<SegmentParams> = JSON.parse(arg("--geo-params") ?? arg("--params") ?? "{}");
const doLive = !process.argv.includes("--no-live");
const doIncr = !process.argv.includes("--no-incremental");
const outPath = arg("--out");

type Assign = { letterOfStroke: number[]; splits: Split[] };

interface Tally {
  letters: number;
  ok: number;
  words: number;
  wordsOk: number;
  unresolved: number;
}
const tally = (): Tally => ({ letters: 0, ok: 0, words: 0, wordsOk: 0, unresolved: 0 });
const add = (t: Tally, m: boolean[], unresolved: boolean) => {
  t.letters += m.length;
  t.ok += m.filter(Boolean).length;
  t.words++;
  if (m.every(Boolean)) t.wordsOk++;
  if (unresolved) t.unresolved++;
};

const modes = ["model", "geometry", ...(doLive ? ["live"] : [])] as const;
const subsets: Record<string, (w: FixtureWord, writer: string) => boolean> = {
  all: () => true,
  touching: (w) => w.meta?.kind === "touching",
  tight: (w) => w.meta?.kind === "tight",
  wide: (w) => w.meta?.kind === "wide",
  runOn: (w) => Number(w.meta?.joined ?? 0) > 0,
  lateDotsBars: (w) => w.meta?.late === true,
  uji: (_w, wr) => wr.includes(":uji:"),
  fonts: (_w, wr) => wr.includes(":font:"),
  omniglot: (_w, wr) => wr.includes(":omniglot:"),
  real: (_w, wr) => !wr.includes(":"),
};
const res: Record<string, Record<string, Tally>> = {};
for (const m of modes) res[m] = Object.fromEntries(Object.keys(subsets).map((k) => [k, tally()]));
const incr = { model: { steps: 0, ok: 0 }, geometry: { steps: 0, ok: 0 } };
const failures: { file: string; session: number; word: number; text: string; model: Assign; geometry: Assign; okModel: boolean[]; okGeo: boolean[] }[] = [];
const times: number[] = [];

for (const file of files) {
  readSessions(file).forEach((sess, si) => {
    const writer = `${sess.writerId}`.replace(/^([^:]+):/, "$1:");
    const wr = sess.pointerType === "synthetic" ? `:${writer.split(":").slice(1).join(":")}:` : writer;
    sess.words.forEach((w, wi) => {
      const strokes = polylines(w);
      const t0 = performance.now();
      const rm = segment(strokes, w.text, w.guides, { mode: "model", model, params });
      times.push(performance.now() - t0);
      const rg = segment(strokes, w.text, w.guides, { mode: "geometry", model, params: geoParams });
      const okM = letterMatches(w, rm);
      const okG = letterMatches(w, rg);
      const okL = doLive ? letterMatches(w, { letterOfStroke: liveAssign(strokes, w.text, w.guides), splits: [] }) : [];
      for (const [k, f] of Object.entries(subsets)) {
        if (!f(w, wr)) continue;
        add(res.model[k], okM, rm.unresolved !== undefined);
        add(res.geometry[k], okG, rg.unresolved !== undefined);
        if (doLive) add(res.live[k], okL, false);
      }
      if (!okM.every(Boolean) || !okG.every(Boolean))
        failures.push({ file, session: si, word: wi, text: w.text, model: rm, geometry: rg, okModel: okM, okGeo: okG });
      // settle accuracy while writing: after each pen-up, are the finished letters right?
      if (doIncr) {
        const cache = new Map<string, Float32Array>();
        const lastStroke = new Array<number>([...w.text].length).fill(-1);
        w.letterOfStroke.forEach((l, s) => (lastStroke[l] = Math.max(lastStroke[l], s)));
        for (const sp of w.splits) lastStroke[sp.left] = Math.max(lastStroke[sp.left], sp.stroke);
        for (let p = 1; p < strokes.length; p++) {
          const pre = strokes.slice(0, p);
          for (const mode of ["model", "geometry"] as const) {
            const r = segment(pre, w.text, w.guides, { mode, model, partial: true, cache: mode === "model" ? cache : undefined, params: mode === "model" ? params : geoParams });
            const ok = letterMatches(w, r, p);
            // letters finished by stroke p-1 and followed by ink of a later letter
            for (let j = 0; j < ok.length; j++) {
              if (lastStroke[j] < 0 || lastStroke[j] >= p - 1) continue;
              incr[mode].steps++;
              if (ok[j]) incr[mode].ok++;
            }
          }
        }
      }
    });
  });
}

const pct = (t: Tally) => (t.letters ? +(100 * (t.ok / t.letters)).toFixed(2) : null);
const summary: Record<string, unknown> = {};
for (const m of modes)
  summary[m] = Object.fromEntries(
    Object.entries(res[m])
      .filter(([, t]) => t.letters > 0)
      .map(([k, t]) => [k, { letterExact: pct(t), letters: t.letters, wordExact: +(100 * (t.wordsOk / t.words)).toFixed(2), words: t.words, unresolvedWords: t.unresolved }]),
  );
times.sort((a, b) => a - b);
const out = {
  summary,
  incremental: {
    model: incr.model.steps ? +(100 * (incr.model.ok / incr.model.steps)).toFixed(2) : null,
    geometry: incr.geometry.steps ? +(100 * (incr.geometry.ok / incr.geometry.steps)).toFixed(2) : null,
    steps: incr.model.steps,
  },
  nodeSolveMs: { p50: times[Math.floor(times.length * 0.5)], p95: times[Math.floor(times.length * 0.95)] },
  failures,
};
if (outPath) writeFileSync(outPath, JSON.stringify(out));
const s = summary as Record<string, Record<string, { letterExact: number; letters: number }>>;
const line = (k: string) =>
  `${k.padEnd(13)} ` + modes.map((m) => `${m} ${String(s[m][k]?.letterExact ?? "-").padStart(6)}`).join("  ") + `  (n=${s.model[k]?.letters ?? 0})`;
console.log(Object.keys(subsets).filter((k) => s.model[k]).map(line).join("\n"));
console.log(`incremental settle: model ${out.incremental.model} geometry ${out.incremental.geometry} (${out.incremental.steps} checks)`);
console.log(`node solve ms p50 ${out.nodeSolveMs.p50?.toFixed(2)} p95 ${out.nodeSolveMs.p95?.toFixed(2)}`);
