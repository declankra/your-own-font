// SPEC.md §5.6: every pair in the pool meets the coverage rule (CI runs this).
import { describe, expect, test } from "vitest";
import { POOL, WORD_COUNT, checkPair, pickPair } from "../src/lib/sentences";

describe("sentence pool", () => {
  test("has about ten pairs", () => {
    expect(POOL.length).toBeGreaterThanOrEqual(10);
  });
  test.each(POOL.map((p, i) => [i + 1, p] as const))("pair %i meets the coverage rule", (_, pair) => {
    expect(checkPair(pair)).toEqual([]);
  });
  test("the first pair is the owner's", () => {
    expect(POOL[0]).toEqual(["quick, bring the jazz and warm pie.", "six lovely foxes nap by the old wharf."]);
  });
  test("the checker catches a miss", () => {
    expect(checkPair(["the quick brown fox.", "jumps over the dog"]).length).toBeGreaterThan(0);
  });
  test("every pair is 15 words and pickPair stays in range", () => {
    for (const p of POOL) expect(p.join(" ").split(/\s+/).length).toBe(WORD_COUNT);
    expect(pickPair(() => 0.9999).index).toBe(POOL.length - 1);
  });
});
