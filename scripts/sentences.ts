// The sentence pool's tool (SPEC.md §5.6).
//
//   npm run sentences                 check every pair in src/lib/sentences.ts (exits 1 on a miss)
//   npm run sentences -- --suggest 8  set-cover search: 15-word bags from a friendly word list
//                                     that meet the coverage rule, to hand-edit into a note
//
// The same check runs in CI through test/sentences.test.ts.

import { ALPHABET, FREQUENT, POOL, WORD_COUNT, checkPair, letterCounts } from "../src/lib/sentences.ts";

const VOCAB = `a about all and apple as at away back bag bake baked be big bike birds blue book box boxes bread
bring brown but by cake calm can cat club coat cocoa cold come cozy cup dance day dog drink drove
each egg every fig fix five fizzy fly fog for fox foxes friends from fun gave glad go good grab gran
green hand happy hat have he hello here hey hi his hold home hop hot how hum i in is it its jacket
jam jar jazz jelly jog join joke jolly jump jumped just keep kind king kite knit lake lazy lemon
light like little long love lovely lucky make me milk mix moon my nap new next nice night now of
off old on one our out over owl owls pack paint park pie pies pink play plum quick quiet quilt
quiz quite rain read red river road sang see sea six sky slow snow so soft song soon sun swim tea
the then they this to toast took tree up van very vivid wave waves we warm was wax well went wet
what wharf when why wild will with wizard wool yes yellow you your zebra zest zig zip zone zoo`.split(/\s+/);

function deficit(counts: Record<string, number>): number {
  let d = 0;
  for (const ch of ALPHABET) d += Math.max(0, (FREQUENT.includes(ch) ? 2 : 1) - (counts[ch] ?? 0));
  return d;
}

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** Randomised greedy set cover: pick words that close the most coverage gap, then pad to 15. */
export function suggest(n: number, seed = 1): string[][] {
  const r = rng(seed);
  const out: string[][] = [];
  for (let attempt = 0; out.length < n && attempt < n * 200; attempt++) {
    const bag: string[] = [];
    let counts: Record<string, number> = {};
    while (bag.length < WORD_COUNT && deficit(counts) > 0) {
      let best: string[] = [];
      let bestGain = 0;
      for (const w of VOCAB) {
        const gain = deficit(counts) - deficit(letterCounts(bag.concat(w).join(" ")));
        if (gain > bestGain) {
          bestGain = gain;
          best = [w];
        } else if (gain === bestGain && gain > 0) best.push(w);
      }
      if (!best.length) break;
      bag.push(best[Math.floor(r() * best.length)]);
      counts = letterCounts(bag.join(" "));
    }
    if (deficit(counts) > 0) continue;
    while (bag.length < WORD_COUNT) bag.push(VOCAB[Math.floor(r() * VOCAB.length)]);
    if (bag.length === WORD_COUNT) out.push(bag);
  }
  return out;
}

const args = process.argv.slice(2);
const at = args.indexOf("--suggest");
if (at >= 0) {
  const n = Number(args[at + 1] ?? 8) || 8;
  for (const bag of suggest(n, Date.now() % 100000)) console.log(bag.join(" "));
} else {
  let bad = 0;
  POOL.forEach((pair, i) => {
    const errs = checkPair(pair);
    console.log(`${errs.length ? "✗" : "✓"} ${i + 1}. ${pair[0]} / ${pair[1]}${errs.length ? `  — ${errs.join("; ")}` : ""}`);
    bad += errs.length ? 1 : 0;
  });
  console.log(`${POOL.length - bad}/${POOL.length} pairs meet the rule`);
  if (bad) process.exit(1);
}
