// Dump the candidate groups the segmenter would propose for synthetic training words, each
// labelled against the known truth, so the model trains on the product's own candidates.
//
//   tsx scripts/candidates.ts <sessions.jsonl> <out.jsonl> [prefixes=2] [seed=1]
//
// Label: the class of the letter when the group is that letter (impurity <= 10% and >= 88%
// of the letter's ink, or everything but a dot/crossbar of i, j, t); -1 (skip) for the
// ambiguous band in between; otherwise 31 (∅, "not exactly one letter"). Prefix states (the
// word part-written) are included, labelled against the finished word, because the
// segmenter scores those groups after every pen-up.

import { createWriteStream } from "node:fs";
import { classId, NULL_ID } from "../src/letter-model/classes.ts";
import { enumerateCandidates, type Unit } from "../src/letter-model/segment.ts";
import { inkByLetter, polylines, readSessions, segmentOwners } from "./common.ts";

const [inPath, outPath, prefArg, seedArg] = process.argv.slice(2);
if (!inPath || !outPath) throw new Error("usage: candidates.ts <in.jsonl> <out.jsonl> [prefixes] [seed]");
const nPrefixes = Number(prefArg ?? 2);
let seed = Number(seedArg ?? 1) >>> 0;
const rand = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 2 ** 32;
};

const out = createWriteStream(outPath);
const counts = { pos: 0, nul: 0, skip: 0, words: 0 };
const sessions = readSessions(inPath);
sessions.forEach((sess, si) => {
  sess.words.forEach((w, wi) => {
    counts.words++;
    const chars = [...w.text];
    const so = segmentOwners(w);
    const all = polylines(w);
    const letterTotal = inkByLetter(
      w.strokes.map((s, i) => ({ stroke: i, a: 0, b: s.points.length - 1 })),
      so,
      chars.length,
    );
    const prefixes = new Set<number>([all.length]);
    for (let q = 0; q < nPrefixes && all.length > 1; q++) prefixes.add(1 + Math.floor(rand() * (all.length - 1)));
    const seen = new Set<string>();
    for (const p of prefixes) {
      const strokes = all.slice(0, p);
      const { units, groups } = enumerateCandidates(strokes, w.text, w.guides);
      // majority truth letter of each unit
      const unitLetter = units.map((u) => {
        const ink = inkByLetter([{ stroke: u.stroke, a: u.a, b: u.b }], so, chars.length);
        let best = -1;
        let bv = 0;
        ink.forEach((v, j) => {
          if (v > bv) {
            bv = v;
            best = j;
          }
        });
        return best;
      });
      for (const g of groups) {
        const pieces = g.map((q) => ({ stroke: units[q].stroke, a: units[q].a, b: units[q].b }));
        const key = pieces
          .map((pc) => `${pc.stroke}:${pc.a}:${pc.b}`)
          .sort()
          .join("|");
        if (seen.has(key)) continue;
        seen.add(key);
        const ink = inkByLetter(pieces, so, chars.length);
        let tot = 0;
        let j = -1;
        let jv = 0;
        ink.forEach((v, k) => {
          tot += v;
          if (v > jv) {
            jv = v;
            j = k;
          }
        });
        let y = NULL_ID;
        let part = false; // ∅ that is part of one letter only (vs ink from two letters)
        if (j >= 0 && tot > 0) {
          part = 1 - jv / tot <= 0.1;
          const impurity = 1 - jv / tot;
          const coverage = jv / letterTotal[j];
          const missing = units
            .map((u: Unit, q: number) => ({ u, q }))
            .filter(({ q }) => unitLetter[q] === j && !g.includes(q));
          // ink of letter j not written yet in this prefix counts as missing too
          const unwritten = coverage < 0.999 && missing.length === 0 && p < all.length;
          const onlySmall = missing.length > 0 && missing.every(({ u }) => u.small);
          if (impurity <= 0.1 && coverage >= 0.88) y = classId(chars[j]);
          else if (impurity <= 0.1 && coverage >= 0.5 && onlySmall && !unwritten && "ijt".includes(chars[j]))
            y = classId(chars[j]);
          else if (impurity <= 0.1 && coverage >= 0.7) y = -1;
          else if (impurity > 0.1 && impurity < 0.16 && coverage >= 0.88) y = -1;
        }
        if (y === -1) counts.skip++;
        else if (y === NULL_ID) counts.nul++;
        else counts.pos++;
        if (y === -1) continue;
        out.write(JSON.stringify({ s: si, w: wi, g: pieces.map((pc) => [pc.stroke, pc.a, pc.b]), y, part }) + "\n");
      }
    }
  });
});
out.end(() => console.log(JSON.stringify(counts)));
