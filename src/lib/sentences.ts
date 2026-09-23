// The writing prompt: a pool of sentence pairs, one picked at random per visit (DECISIONS.md →
// The writing prompt; SPEC.md §5.6). `scripts/sentences.ts` searches for candidates by set
// cover and checks the rule; the pairs below were then hand-edited to read like a note.
//
// Rule: each pair, together, covers a–z at least once and "etaoinsrhl" at least twice.
// Lowercase only; punctuation limited to . , ' ! ? — and every pair has a comma, because the
// font's apostrophe is made from the writer's comma when the pair has no apostrophe.
// Every pair is 15 words, so the counter always reads n / 15.

export const POOL: readonly (readonly [string, string])[] = [
  ["quick, bring the jazz and warm pie.", "six lovely foxes nap by the old wharf."],
  ["just a quick note, from my own hand.", "now relax, the big pizza is lovely!"],
  ["save me a cozy spot, i'll bring the quilt.", "we'll fix hot drinks and jokes."],
  ["how was the concert, and your quiz?", "we baked you six lovely fig jam pies."],
  ["the quiet owls glide by the jazz club.", "a kind fox, very warm, plays on."],
  ["my dog jumps over the quiet brick wall.", "six fuzzy hens nap, then they hum."],
  ["pack the jam, six quilts and warm bread.", "zoe gave the lazy dog one fig."],
  ["hey, grab the jacket, my socks and quiz book.", "we fix our lovely pink van."],
  ["the vixen jumped, quick as a whiz.", "my gran knits blue fog hats for owls."],
  ["join the quiz, bring five warm snacks.", "why not paddle to the lazy old ox?"],
];

export const WORD_COUNT = 15;
export const FREQUENT = "etaoinsrhl";
export const ALPHABET = "abcdefghijklmnopqrstuvwxyz";

export function letterCounts(text: string): Record<string, number> {
  const c: Record<string, number> = {};
  for (const ch of text) if (ALPHABET.includes(ch)) c[ch] = (c[ch] ?? 0) + 1;
  return c;
}

/** Problems with a pair against the coverage rule; empty when it passes. */
export function checkPair(pair: readonly [string, string]): string[] {
  const text = pair.join(" ");
  const errs: string[] = [];
  if (text !== text.toLowerCase()) errs.push("not all lowercase");
  const bad = [...new Set([...text].filter((ch) => !ALPHABET.includes(ch) && !" .,'!?".includes(ch)))];
  if (bad.length) errs.push(`characters outside a–z and . , ' ! ?: ${bad.join(" ")}`);
  const c = letterCounts(text);
  const missing = [...ALPHABET].filter((ch) => !c[ch]);
  if (missing.length) errs.push(`missing ${missing.join("")}`);
  const thin = [...FREQUENT].filter((ch) => (c[ch] ?? 0) < 2);
  if (thin.length) errs.push(`fewer than two: ${thin.join("")}`);
  const words = words15(pair);
  if (words.length !== WORD_COUNT) errs.push(`${words.length} words, not ${WORD_COUNT}`);
  if (!text.includes(",")) errs.push("no comma");
  return errs;
}

export function words15(pair: readonly [string, string]): string[] {
  return pair.flatMap((s) => s.split(/\s+/).filter(Boolean));
}

export function pickPair(random: () => number = Math.random): { index: number; pair: readonly [string, string] } {
  const index = Math.floor(random() * POOL.length) % POOL.length;
  return { index, pair: POOL[index] };
}
