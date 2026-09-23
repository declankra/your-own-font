// Which strokes belong to which letter (SPEC.md §6.2, docs/letter-model.md §6).
//
// 1. Units. Every stroke is a unit, except that a stroke running across two letters may be
//    cut where the word's ink is thinnest (a "valley": a column the stroke crosses once and
//    few other strokes cross). Units are sorted left to right by the centre of their ink.
// 2. Candidates. A letter takes a run of up to `maxUnits` consecutive units. Each distinct
//    run is one candidate group; the model scores it once for all 32 classes.
// 3. Dynamic programming assigns runs to the word's letters in order at minimum total cost.
//    Cost = -log P(letter) (model mode) plus geometry priors: width and height against the
//    writer's own scale, internal gaps, unit count, and a cost for every stroke a letter
//    shares with a neighbour (a cut has to earn its keep; without it the solver shaved
//    slivers off x diagonals and t-bars). Geometry mode uses the priors alone.
// 4. Repair. Dots and crossbars are often written late or drift over a neighbour, so after
//    the DP each small unit may move to an adjacent letter if that lowers the total cost.
//
// While writing (`partial: true`) the letters after the last one written stay empty and the
// last written letter is scored leniently (it may be unfinished). Each letter counted as
// written earns a credit, or "finished letter + first stroke of the next" as one lenient
// group would undercut the right answer.

import { CLASSES, NULL_ID, N_CLASSES, classId } from "./classes.ts";
import type { Split } from "./fixture.ts";
import type { ClassPrior, LetterModel } from "./model.ts";
import type { Guides, Polyline } from "./raster.ts";

export type Mode = "model" | "geometry";

export interface SegmentParams {
  maxUnits: number;
  cutMinWidth: number;
  cutEdge: number;
  cutBandTop: number;
  cutBandBottom: number;
  cutMaxCrossings: number;
  maxCutsPerStroke: number;
  wModel: number;
  wGeoInModel: number;
  wWidth: number;
  wVert: number;
  wGap: number;
  wCount: number;
  gapFree: number;
  partialCap: number;
  partialCapGeo: number;
  partialLetterBonus: number;
  unresolvedP: number;
  unresolvedGeo: number;
  smallMax: number;
  moveReach: number;
  prunePrior: number;
  cutCost: number;
  geoCutCost: number;
}

export const DEFAULT_PARAMS: SegmentParams = {
  maxUnits: 4, // a letter is at most this many units
  cutMinWidth: 0.8, // x-heights: narrower strokes are never cut
  cutEdge: 0.25, // x-heights: no cut this close to a stroke's left or right end
  cutBandTop: 1.3, // x-heights above the baseline: highest cut
  cutBandBottom: 0.3, // x-heights below the baseline: lowest cut
  cutMaxCrossings: 2, // a valley column is crossed by at most this many strokes
  maxCutsPerStroke: 3,
  wModel: 1.0, // model mode: weight of -log P(letter)
  wGeoInModel: 0.25, // model mode: weight of the geometry priors
  wWidth: 1.0,
  wVert: 0.6,
  wGap: 6.0,
  wCount: 0.4,
  gapFree: 0.12, // writer x-heights: internal gaps up to this are free
  partialCap: 3.0, // nats: the letter being written costs at most this (model mode)
  partialCapGeo: 3.0, // same, geometry mode
  // While writing, each letter counted as written earns this much, so that "finished letter +
  // the first stroke of the next" (one lenient group) doesn't undercut the right answer.
  partialLetterBonus: 10,
  unresolvedP: 0.02, // model mode: P(letter) under this, with ∅ likely, is "nothing fits"
  unresolvedGeo: 14, // geometry mode: cost over this is "nothing fits"
  smallMax: 0.45, // x-heights: a unit no bigger than this (or a thin bar) can move letters
  moveReach: 0.35, // x-heights: how far outside a letter's ink a moved unit may sit
  prunePrior: 40, // geometry cost above which a group is not sent to the model
  cutCost: 6, // per stroke a letter shares with a neighbour (a cut must earn its keep)
  geoCutCost: 5, // the same, in geometry mode
};

export interface SegmentOptions {
  mode: Mode;
  /** The loaded model. Geometry mode only reads its priors. */
  model?: LetterModel;
  /** Geometry priors, if no model is given. */
  priors?: Record<string, ClassPrior>;
  /** true while the word is being written: trailing letters may be empty, the last is lenient. */
  partial?: boolean;
  /**
   * Scores reused across calls for the same word. Entries are keyed by each stroke piece's own
   * points, so the cache stays valid through undo and redo-letter; start a new one per word.
   */
  cache?: Map<string, Float32Array>;
  params?: Partial<SegmentParams>;
}

export interface SegmentResult {
  letterOfStroke: number[];
  splits: Split[];
  cost: number;
  /** The first letter no grouping fits (SPEC.md §6.3). */
  unresolved?: number;
  /** How many letters received ink (all of them unless partial). */
  lettersWritten: number;
  /** Groups the model scored in this call (cache misses). */
  modelCalls: number;
  /** Distinct candidate groups costed in this call. */
  candidates: number;
}

export interface Unit {
  stroke: number;
  a: number;
  b: number;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  cx: number;
  len: number;
  small: boolean;
}

interface Group {
  key: string;
  units: number[];
  /** strokes this group shares with other letters (some of their pieces are outside it) */
  shared: number;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  gap: number;
  lp: Float32Array | null; // log-probabilities, model mode only
}

const INF = 1e18;

// ------------------------------------------------------------------------------ units

function pieceBBox(s: Polyline, a: number, b: number) {
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  let len = 0;
  for (let i = a; i <= b; i++) {
    const x = s[i][0];
    const y = s[i][1];
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
    if (i > a) len += Math.hypot(x - s[i - 1][0], y - s[i - 1][1]);
  }
  return { x0, x1, y0, y1, len };
}

/** Candidate cut points (point indices) per stroke: valleys in the word's column profile. */
export function findCuts(strokes: ArrayLike<Polyline>, guides: Guides, P: SegmentParams): number[][] {
  const xh = guides.xHeight;
  const cw = 0.1 * xh;
  let X0 = Infinity;
  let X1 = -Infinity;
  for (let k = 0; k < strokes.length; k++)
    for (let i = 0; i < strokes[k].length; i++) {
      X0 = Math.min(X0, strokes[k][i][0]);
      X1 = Math.max(X1, strokes[k][i][0]);
    }
  const cuts: number[][] = Array.from({ length: strokes.length }, () => []);
  if (!Number.isFinite(X0)) return cuts;
  const nc = Math.floor((X1 - X0) / cw) + 2;
  const total = new Int32Array(nc);
  const colOf = (x: number) => (x - X0) / cw - 0.5; // column c has its centre line at colOf = c
  const each = (s: Polyline, f: (c: number, i: number) => void) => {
    if (s.length === 1) {
      const c = Math.round(colOf(s[0][0]));
      if (c >= 0 && c < nc) f(c, 0);
      return;
    }
    for (let i = 0; i + 1 < s.length; i++) {
      const u = colOf(s[i][0]);
      const v = colOf(s[i + 1][0]);
      const lo = Math.ceil(Math.min(u, v));
      const hi = Math.ceil(Math.max(u, v)) - 1; // centre lines in [min, max)
      for (let c = Math.max(0, lo); c <= Math.min(nc - 1, hi); c++) f(c, i);
    }
  };
  for (let k = 0; k < strokes.length; k++) each(strokes[k], (c) => total[c]++);
  for (let k = 0; k < strokes.length; k++) {
    const s = strokes[k];
    if (s.length < 5) continue;
    const bb = pieceBBox(s, 0, s.length - 1);
    if (bb.x1 - bb.x0 < P.cutMinWidth * xh) continue;
    const own = new Int32Array(nc);
    const at = new Int32Array(nc).fill(-1);
    each(s, (c, i) => {
      own[c]++;
      at[c] = i;
    });
    const lo = Math.ceil(colOf(bb.x0 + P.cutEdge * xh));
    const hi = Math.floor(colOf(bb.x1 - P.cutEdge * xh));
    const ok: boolean[] = [];
    for (let c = 0; c < nc; c++) {
      let good = c >= lo && c <= hi && own[c] === 1 && total[c] <= P.cutMaxCrossings;
      if (good) {
        for (let d = -3; d <= 3 && good; d++) if (c + d >= 0 && c + d < nc && total[c + d] < total[c]) good = false;
      }
      if (good) {
        const i = at[c];
        const y = (s[i][1] + s[i + 1][1]) / 2;
        const h = (guides.baseline - y) / xh;
        if (h > P.cutBandTop || h < -P.cutBandBottom) good = false;
      }
      ok.push(good);
    }
    const found: { idx: number; score: number }[] = [];
    for (let c = 0; c < nc; ) {
      if (!ok[c]) {
        c++;
        continue;
      }
      let e = c;
      while (e + 1 < nc && ok[e + 1]) e++;
      const mid = Math.round((c + e) / 2);
      const i = at[mid];
      const xc = X0 + (mid + 0.5) * cw;
      let idx = Math.abs(s[i][0] - xc) <= Math.abs(s[i + 1][0] - xc) ? i : i + 1;
      idx = Math.min(Math.max(idx, 1), s.length - 2);
      found.push({ idx, score: total[mid] * 10 - (e - c) });
      c = e + 1;
    }
    found.sort((p, q) => p.score - q.score);
    const chosen = found.slice(0, P.maxCutsPerStroke).map((f) => f.idx).sort((p, q) => p - q);
    const dedup: number[] = [];
    for (const idx of chosen) if (!dedup.length || idx - dedup[dedup.length - 1] >= 2) dedup.push(idx);
    cuts[k] = dedup;
  }
  return cuts;
}

export function buildUnits(strokes: ArrayLike<Polyline>, guides: Guides, P: SegmentParams): Unit[] {
  const xh = guides.xHeight;
  const cuts = findCuts(strokes, guides, P);
  const units: Unit[] = [];
  for (let k = 0; k < strokes.length; k++) {
    const s = strokes[k];
    if (!s.length) continue;
    const bounds = [0, ...cuts[k], s.length - 1]; // pieces share their cut point
    for (let q = 0; q + 1 < bounds.length; q++) {
      const a = bounds[q];
      const b = bounds[q + 1];
      const bb = pieceBBox(s, a, b);
      const w = bb.x1 - bb.x0;
      const h = bb.y1 - bb.y0;
      const small = Math.max(w, h) <= P.smallMax * xh || (h < 0.3 * xh && w > 2.5 * h);
      units.push({ stroke: k, a, b, ...bb, cx: (bb.x0 + bb.x1) / 2, small });
    }
  }
  units.sort((u, v) => u.cx - v.cx || u.stroke - v.stroke || u.a - v.a);
  return units;
}

// ------------------------------------------------------------------------------ solver

export function segment(
  strokes: ArrayLike<Polyline>,
  word: string,
  guides: Guides,
  opts: SegmentOptions,
): SegmentResult {
  const P: SegmentParams = { ...DEFAULT_PARAMS, ...(opts.model?.header.segmenter as Partial<SegmentParams> | undefined), ...opts.params };
  const letters = [...word].map(classId);
  const L = letters.length;
  const priors = opts.priors ?? opts.model?.header.priors;
  if (!priors) throw new Error("segment needs a model or priors");
  if (opts.mode === "model" && !opts.model) throw new Error("model mode needs a model");
  const pri = letters.map((c) => priors[CLASSES[c]]);
  const xh = guides.xHeight;
  const base = guides.baseline;
  const units = buildUnits(strokes, guides, P);
  const n = units.length;
  const cache = opts.cache ?? new Map<string, Float32Array>();
  const partial = !!opts.partial;
  let modelCalls = 0;

  const empty = (): SegmentResult => ({
    letterOfStroke: Array.from({ length: strokes.length }, () => 0),
    splits: [],
    cost: 0,
    lettersWritten: 0,
    modelCalls: 0,
    candidates: 0,
    ...(partial ? {} : { unresolved: 0 }),
  });
  if (!n || !L) return empty();

  // ---- groups
  const piecesOf = new Map<number, number>();
  for (const u of units) piecesOf.set(u.stroke, (piecesOf.get(u.stroke) ?? 0) + 1);
  const groups = new Map<string, Group>();
  const keyOf = (ids: number[]) => {
    const sorted = ids.slice().sort((p, q) => p - q);
    return sorted
      .map((i) => {
        const u = units[i];
        const s = strokes[u.stroke];
        return `${u.stroke}:${u.a}:${u.b}:${s[u.a][0]},${s[u.a][1]}:${s[u.b][0]},${s[u.b][1]}`;
      })
      .join("|");
  };
  const group = (ids: number[]): Group => {
    const key = keyOf(ids);
    let g = groups.get(key);
    if (g) return g;
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    const iv: [number, number][] = [];
    for (const i of ids) {
      const u = units[i];
      x0 = Math.min(x0, u.x0);
      x1 = Math.max(x1, u.x1);
      y0 = Math.min(y0, u.y0);
      y1 = Math.max(y1, u.y1);
      iv.push([u.x0, u.x1]);
    }
    iv.sort((p, q) => p[0] - q[0]);
    let gap = 0;
    let reach = iv[0][1];
    for (let k = 1; k < iv.length; k++) {
      gap = Math.max(gap, iv[k][0] - reach);
      reach = Math.max(reach, iv[k][1]);
    }
    let shared = 0;
    const inside = new Map<number, number>();
    for (const i of ids) inside.set(units[i].stroke, (inside.get(units[i].stroke) ?? 0) + 1);
    for (const [stroke, k] of inside) if (k < (piecesOf.get(stroke) ?? 1)) shared++;
    g = { key, units: ids.slice(), shared, x0, x1, y0, y1, gap, lp: null };
    groups.set(key, g);
    return g;
  };
  const logp = (g: Group): Float32Array => {
    if (g.lp) return g.lp;
    let lp = cache.get(g.key);
    if (!lp) {
      const polys: Polyline[] = g.units.map((i) => {
        const u = units[i];
        return Array.prototype.slice.call(strokes[u.stroke], u.a, u.b + 1) as Polyline;
      });
      lp = opts.model!.score(polys, guides, new Float32Array(N_CLASSES));
      cache.set(g.key, lp);
      modelCalls++;
    }
    g.lp = lp;
    return lp;
  };

  // ---- costs
  let scale = 1.0;
  const geoCost = (j: number, g: Group): number => {
    const pr = pri[j];
    const sx = scale * xh;
    const w = Math.max(g.x1 - g.x0, 0.04 * xh) / sx;
    const zw = (Math.log(w) - pr.logW[0]) / pr.logW[1];
    const top = (base - g.y0) / sx;
    const bot = (base - g.y1) / sx;
    const zt = (top - pr.top[0]) / pr.top[1];
    const zb = (bot - pr.bottom[0]) / pr.bottom[1];
    const gp = Math.max(0, g.gap / sx - P.gapFree);
    const extra = Math.max(0, g.units.length - 2);
    return (
      P.wWidth * 0.5 * Math.min(zw * zw, 60) +
      P.wVert * 0.5 * (Math.min(zt * zt, 60) + Math.min(zb * zb, 60)) +
      P.wGap * gp * gp +
      P.wCount * extra +
      0.5 * (opts.mode === "geometry" ? P.geoCutCost : P.cutCost) * g.shared // each cut is shared by the two letters it separates
    );
  };
  const strict = (j: number, g: Group): number => {
    const geo = geoCost(j, g);
    if (opts.mode === "geometry") return geo;
    if (geo > P.prunePrior) return P.wModel * 20 + P.wGeoInModel * geo;
    return -P.wModel * logp(g)[letters[j]] + P.wGeoInModel * geo;
  };
  const lenient = (j: number, g: Group): number => {
    if (opts.mode === "geometry") return Math.min(geoCost(j, g), P.partialCapGeo);
    const geo = geoCost(j, g);
    if (geo > P.prunePrior) return P.partialCap + P.wGeoInModel * geo;
    const lp = logp(g);
    const pl = Math.exp(lp[letters[j]]) + Math.exp(lp[NULL_ID]);
    return Math.min(-P.wModel * Math.log(Math.max(pl, 1e-12)), P.partialCap) + P.wGeoInModel * Math.min(geo, 10);
  };

  // ---- dynamic programming over runs of consecutive units
  const K = Math.max(P.maxUnits, Math.ceil(n / L));
  const run = (i: number, k: number) => group(Array.from({ length: k - i }, (_, q) => i + q));
  let assign: Int32Array = new Int32Array(n);
  let written = L;
  let total = INF;

  const solve = (): void => {
    const W = n + 1;
    const dp = new Float64Array((L + 1) * W).fill(INF);
    const back = new Int32Array((L + 1) * W).fill(-1);
    dp[0] = 0;
    for (let j = 0; j < L; j++) {
      const lastPossible = j === L - 1;
      for (let i = 0; i < n; i++) {
        const cur = dp[j * W + i];
        if (cur >= INF) continue;
        for (let k = i + 1; k <= Math.min(n, i + K); k++) {
          if (!partial && n - k < L - j - 1) break; // later letters each need a unit
          if (!partial && lastPossible && k !== n) continue;
          const c = cur + strict(j, run(i, k));
          if (c < dp[(j + 1) * W + k]) {
            dp[(j + 1) * W + k] = c;
            back[(j + 1) * W + k] = i;
          }
        }
      }
    }
    let bestM = -1;
    let bestI = -1;
    let best = INF;
    if (partial) {
      // letters 0..m-1 written, the last of them possibly unfinished
      for (let m = 1; m <= L; m++)
        for (let i = Math.max(0, n - K); i < n; i++) {
          const cur = dp[(m - 1) * W + i];
          if (cur >= INF) continue;
          const c = cur + lenient(m - 1, run(i, n)) - P.partialLetterBonus * m;
          if (c < best) {
            best = c;
            bestM = m;
            bestI = i;
          }
        }
    } else if (dp[L * W + n] < INF) {
      best = dp[L * W + n];
      bestM = L;
      bestI = back[L * W + n];
    }
    if (bestM < 0) return;
    const a = new Int32Array(n);
    let k = n;
    let i = bestI;
    for (let j = bestM - 1; j >= 0; j--) {
      for (let q = i; q < k; q++) a[q] = j;
      k = i;
      if (j > 0) i = back[j * W + k];
    }
    assign = a;
    written = bestM;
    total = best;
  };

  solve();
  if (total >= INF) {
    // more letters than units: give each unit its own letter; the first empty one is unresolved
    if (partial || n >= L) return empty();
    for (let q = 0; q < n; q++) assign[q] = q;
    written = n;
    total = 0;
  }

  // second pass with the writer's own scale, measured from the first solution
  const letterGroups = (): Group[] => {
    const ids: number[][] = Array.from({ length: written }, () => []);
    for (let q = 0; q < n; q++) ids[assign[q]].push(q);
    return ids.map((u) => group(u));
  };
  {
    const logs: number[] = [];
    letterGroups().forEach((g, j) => {
      if (partial && j === written - 1) return;
      const pr = pri[j];
      logs.push(Math.log(Math.max(g.x1 - g.x0, 0.04 * xh) / xh) - pr.logW[0]);
      if (pr.top[0] > 0.6) logs.push(Math.log(Math.max(base - g.y0, 0.1 * xh) / xh / pr.top[0]));
    });
    if (logs.length >= 2) {
      logs.sort((p, q) => p - q);
      const med = logs[Math.floor(logs.length / 2)];
      scale = Math.min(1.5, Math.max(0.6, Math.exp(med)));
      solve();
    }
  }

  // ---- repair: move dots and crossbars to a neighbouring letter when that is cheaper
  const letterCost = (j: number, g: Group) => (partial && j === written - 1 ? lenient(j, g) : strict(j, g));
  const nSmall = units.filter((u) => u.small).length;
  for (let pass = 0; pass < Math.min(4, nSmall); pass++) {
    const gs = letterGroups();
    const costs = gs.map((g, j) => letterCost(j, g));
    let best = { gain: 1e-6, u: -1, to: -1, from: -1 };
    for (let q = 0; q < n; q++) {
      const u = units[q];
      if (!u.small) continue;
      const from = assign[q];
      if (gs[from].units.length < 2) continue;
      for (const to of [from - 1, from + 1]) {
        if (to < 0 || to >= written) continue;
        const r = P.moveReach * scale * xh;
        if (u.x1 < gs[to].x0 - r || u.x0 > gs[to].x1 + r) continue;
        const gFrom = group(gs[from].units.filter((x) => x !== q));
        const gTo = group([...gs[to].units, q]);
        const gain = costs[from] + costs[to] - letterCost(from, gFrom) - letterCost(to, gTo);
        if (gain > best.gain) best = { gain, u: q, to, from };
      }
    }
    if (best.u < 0) break;
    assign[best.u] = best.to;
    total -= best.gain;
  }

  // ---- unresolved: a letter nothing fits (SPEC.md §6.3)
  let unresolved: number | undefined = !partial && written < L ? written : undefined;
  const gs = letterGroups();
  for (let j = 0; j < written && unresolved === undefined; j++) {
    if (partial && j === written - 1) continue;
    const g = gs[j];
    if (opts.mode === "model") {
      const lp = logp(g);
      if (Math.exp(lp[letters[j]]) < P.unresolvedP && Math.exp(lp[NULL_ID]) > 0.5) {
        unresolved = j;
        break;
      }
    } else if (geoCost(j, g) > P.unresolvedGeo) {
      unresolved = j;
      break;
    }
  }

  // ---- back to strokes
  const byStroke = new Map<number, { a: number; b: number; letter: number }[]>();
  for (let q = 0; q < n; q++) {
    const u = units[q];
    const l = byStroke.get(u.stroke) ?? [];
    l.push({ a: u.a, b: u.b, letter: assign[q] });
    byStroke.set(u.stroke, l);
  }
  const letterOfStroke: number[] = Array.from({ length: strokes.length }, () => 0);
  const splits: Split[] = [];
  for (const [stroke, pieces] of byStroke) {
    pieces.sort((p, q) => p.a - q.a);
    letterOfStroke[stroke] = pieces[pieces.length - 1].letter;
    for (let k = 1; k < pieces.length; k++)
      if (pieces[k].letter !== pieces[k - 1].letter)
        splits.push({ stroke, atPoint: pieces[k].a, left: pieces[k - 1].letter, right: pieces[k].letter });
  }
  splits.sort((p, q) => p.stroke - q.stroke || p.atPoint - q.atPoint);
  return {
    letterOfStroke,
    splits,
    cost: total,
    ...(unresolved !== undefined ? { unresolved } : {}),
    lettersWritten: written,
    modelCalls,
    candidates: groups.size,
  };
}

/**
 * Every group the solver could cost for these strokes: runs of up to `maxUnits` consecutive
 * units, plus runs with one nearby dot or crossbar added (what the repair step tries).
 * Used to build training data from the same candidates the product proposes.
 */
export function enumerateCandidates(
  strokes: ArrayLike<Polyline>,
  word: string,
  guides: Guides,
  params?: Partial<SegmentParams>,
): { units: Unit[]; groups: number[][] } {
  const P = { ...DEFAULT_PARAMS, ...params };
  const units = buildUnits(strokes, guides, P);
  const n = units.length;
  const L = [...word].length;
  const K = Math.max(P.maxUnits, Math.ceil(n / Math.max(1, L)));
  const seen = new Set<string>();
  const groups: number[][] = [];
  const add = (ids: number[]) => {
    const k = ids.slice().sort((p, q) => p - q).join(",");
    if (seen.has(k)) return;
    seen.add(k);
    groups.push(ids);
  };
  const xh = guides.xHeight;
  for (let i = 0; i < n; i++)
    for (let k = i + 1; k <= Math.min(n, i + K); k++) {
      const run = Array.from({ length: k - i }, (_, q) => i + q);
      add(run);
      if (run.length > 3) continue;
      let x0 = Infinity;
      let x1 = -Infinity;
      for (const q of run) {
        x0 = Math.min(x0, units[q].x0);
        x1 = Math.max(x1, units[q].x1);
      }
      for (let q = Math.max(0, i - 3); q < Math.min(n, k + 3); q++) {
        if (q >= i && q < k) continue;
        const u = units[q];
        if (!u.small) continue;
        if (u.x1 < x0 - P.moveReach * xh || u.x0 > x1 + P.moveReach * xh) continue;
        add([...run, q]);
      }
    }
  return { units, groups };
}
