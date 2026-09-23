// SPEC.md §7: the Making timeline waits on the pipeline, takes ≥ 7 s on the first run, never
// finishes before the .otf exists, and has reachable reduced-motion and error states.
import type { BuildEvent, BuildResult, BuiltGlyph } from "@your-own-font/pipeline/font";
import { describe, expect, test } from "vitest";
import { BuildGate } from "../src/lib/build-gate";
import { MIN_MS, runMaking, type Clock, type MakingUI } from "../src/lib/making";

/** A fake clock: sleeping advances time instantly. */
function fakeClock(): Clock & { t: number } {
  const c = {
    t: 0,
    now: () => c.t,
    sleep: async (ms: number) => {
      c.t += ms;
      await Promise.resolve();
    },
  };
  return c;
}

const glyph = (ch: string): BuiltGlyph => ({ name: ch, char: ch, variant: 0, advance: 400, d: "M0 0Z", bounds: { xMin: 0, xMax: 1, yMin: 0, yMax: 1 }, strokes: [], derived: false });
const result = { otf: new ArrayBuffer(8), familyName: "My Hand", postScriptName: "MyHand-X", glyphs: [], missing: [] } as BuildResult;

function recorder(clock: { t: number }) {
  const log: string[] = [];
  const ui: MakingUI = {
    caption: (t) => log.push(`caption ${t}`),
    lift: (i) => void log.push(`lift ${i}@${clock.t}`),
    cast: (i) => log.push(`cast ${i}`),
    setRow: () => log.push("set"),
    roll: async () => void log.push("roll"),
    press: async () => {
      log.push(`press@${clock.t}`);
      clock.t += 1300;
    },
    fadeIn: (i) => log.push(`fade ${i}`),
    fold: () => log.push(`fold@${clock.t}`),
  };
  return { log, ui };
}

/** Virtual time with real concurrency: sleeps resolve in time order, as timers would. */
function timerClock() {
  const timers: { at: number; resolve: () => void }[] = [];
  const c = {
    t: 0,
    now: () => c.t,
    sleep: (ms: number) => new Promise<void>((resolve) => timers.push({ at: c.t + ms, resolve })),
    /** run until `p` settles */
    async until(p: Promise<unknown>) {
      let done = false;
      p.then(
        () => (done = true),
        () => (done = true),
      );
      for (;;) {
        for (let k = 0; k < 50; k++) await Promise.resolve();
        if (done) return;
        timers.sort((a, b) => a.at - b.at);
        const next = timers.shift();
        if (!next) throw new Error("stuck: no timers left");
        c.t = Math.max(c.t, next.at);
        next.resolve();
      }
    },
  };
  return c;
}

function feed(gate: BuildGate, upTo: "all" | number, built = true) {
  const n = upTo === "all" ? 26 : upTo;
  const push = (e: BuildEvent) => gate.push(e);
  push({ type: "stage", stage: "cast" });
  for (let i = 0; i < n; i++) push({ type: "glyph", index: i, glyph: glyph("abcdefghijklmnopqrstuvwxyz"[i]) });
  if (upTo !== "all") return;
  push({ type: "stage", stage: "set" });
  push({ type: "metrics", sidebearing: 30, space: 300 });
  push({ type: "stage", stage: "ink" });
  push({ type: "variants", alternates: ["e"], dropped: [] });
  push({ type: "stage", stage: "press" });
  if (built) push({ type: "built", result });
}

describe("Making", () => {
  test("first run: every step in order, and at least 7 s in total", async () => {
    const clock = fakeClock();
    const gate = new BuildGate();
    feed(gate, "all");
    const { log, ui } = recorder(clock);
    await runMaking(gate, ui, { reduced: false, minMs: MIN_MS, clock });
    expect(log.filter((l) => l.startsWith("lift")).length).toBe(26);
    const order = ["caption casting letters · 26/26", "caption setting the row", "set", "caption inking", "roll", "caption pressing"];
    let at = -1;
    for (const o of order) {
      const k = log.indexOf(o);
      expect(k, o).toBeGreaterThan(at);
      at = k;
    }
    expect(clock.t).toBeGreaterThanOrEqual(MIN_MS);
    expect(log.some((l) => l.startsWith("fade"))).toBe(false);
  });

  test("a letter is cast only after the worker reports it", async () => {
    const clock = fakeClock();
    const gate = new BuildGate();
    feed(gate, 5); // the worker has only done a–e so far
    const { log, ui } = recorder(clock);
    let finished = false;
    const p = runMaking(gate, ui, { reduced: false, minMs: MIN_MS, clock }).then(() => (finished = true));
    for (let k = 0; k < 200; k++) await Promise.resolve();
    expect(log.filter((l) => l.startsWith("lift")).length).toBe(5);
    expect(finished).toBe(false);
    feed(gate, "all");
    await p;
    expect(finished).toBe(true);
  });

  test("never shows a finished state before the .otf exists", async () => {
    const clock = fakeClock();
    const gate = new BuildGate();
    feed(gate, "all", false);
    const { log, ui } = recorder(clock);
    let finished = false;
    const p = runMaking(gate, ui, { reduced: false, minMs: MIN_MS, clock }).then(() => (finished = true));
    for (let k = 0; k < 400; k++) await Promise.resolve();
    expect(finished).toBe(false);
    expect(log.some((l) => l.startsWith("press"))).toBe(false);
    gate.push({ type: "built", result });
    await p;
    expect(log.some((l) => l.startsWith("press"))).toBe(true);
  });

  test("reduced motion: letters fade in, no flips, roller or press, still ≥ 7 s", async () => {
    const clock = fakeClock();
    const gate = new BuildGate();
    feed(gate, "all");
    const { log, ui } = recorder(clock);
    await runMaking(gate, ui, { reduced: true, minMs: MIN_MS, clock });
    expect(log.filter((l) => l.startsWith("fade")).length).toBe(26);
    expect(log.some((l) => /^(cast|roll|press|set$)/.test(l))).toBe(false);
    expect(clock.t).toBeGreaterThanOrEqual(MIN_MS);
  });

  test("error: a worker failure stops the press and rejects", async () => {
    const clock = fakeClock();
    const gate = new BuildGate();
    feed(gate, 12);
    const { log, ui } = recorder(clock);
    const p = runMaking(gate, ui, { reduced: false, minMs: MIN_MS, clock });
    for (let k = 0; k < 100; k++) await Promise.resolve();
    gate.fail(new Error("worker threw"));
    await expect(p).rejects.toThrow("worker threw");
    expect(log.some((l) => l.startsWith("press"))).toBe(false);
  });

  test("lifting from the sentences: a letter turns to type 200 ms after it lands, and z lands before the fold and the set", async () => {
    const FLIGHT = 900;
    const clock = timerClock();
    const gate = new BuildGate();
    feed(gate, "all");
    const { log, ui } = recorder(clock);
    const landedAt: number[] = [];
    const castAt: number[] = [];
    ui.lift = (i) => clock.sleep(FLIGHT).then(() => void (landedAt[i] = clock.t));
    ui.cast = (i) => void (castAt[i] = clock.t);
    ui.setRow = () => log.push(`set@${clock.t}`);
    await clock.until(runMaking(gate, ui, { reduced: false, minMs: MIN_MS, leadMs: 200, clock }));
    for (let i = 0; i < 26; i++) expect(castAt[i] - landedAt[i], `letter ${i}`).toBe(200);
    const at = (prefix: string) => Number(log.find((l) => l.startsWith(prefix))!.split("@")[1]);
    const lastLanding = Math.max(...landedAt);
    expect(at("fold")).toBe(lastLanding);
    expect(at("set")).toBeGreaterThanOrEqual(lastLanding);
    expect(clock.t).toBeGreaterThanOrEqual(MIN_MS);
  });

  test("the flights add no time: the row is set no later than when letters lifted in place", async () => {
    const setAt = async (leadMs: number | undefined, flight: number) => {
      const clock = timerClock();
      const gate = new BuildGate();
      feed(gate, "all");
      const { ui } = recorder(clock);
      let t = -1;
      ui.lift = () => (flight ? clock.sleep(flight) : undefined);
      ui.setRow = () => void (t = clock.t);
      await clock.until(runMaking(gate, ui, { reduced: false, minMs: MIN_MS, leadMs, clock }));
      return t;
    };
    const before = await setAt(undefined, 0); // letters lifted in place, 500 ms lead
    expect(before).toBe(500 + 26 * 125 + 500);
    // a lift (~150 ms) plus a paper-spring flight (~770 ms) from a 200 ms lead
    expect(await setAt(200, 920)).toBeLessThanOrEqual(before);
  });

  test("a slow flight holds the set step: it never runs ahead of a letter in the air", async () => {
    const clock = timerClock();
    const gate = new BuildGate();
    feed(gate, "all");
    const { ui } = recorder(clock);
    let setT = -1;
    let zLanded = -1;
    ui.lift = (i) => clock.sleep(i === 25 ? 3000 : 800).then(() => void (i === 25 && (zLanded = clock.t)));
    ui.setRow = () => void (setT = clock.t);
    await clock.until(runMaking(gate, ui, { reduced: false, minMs: MIN_MS, leadMs: 200, clock }));
    expect(setT).toBeGreaterThanOrEqual(zLanded);
  });

  test("reduced motion folds the sentences after z", async () => {
    const clock = fakeClock();
    const gate = new BuildGate();
    feed(gate, "all");
    const { log, ui } = recorder(clock);
    await runMaking(gate, ui, { reduced: true, minMs: MIN_MS, clock });
    expect(log.findIndex((l) => l.startsWith("fold"))).toBeGreaterThan(log.indexOf("fade 25"));
  });

  test("a second run has no 7 s floor", async () => {
    const clock = fakeClock();
    const gate = new BuildGate();
    feed(gate, "all");
    const { ui } = recorder(clock);
    await runMaking(gate, ui, { reduced: false, minMs: 0, clock, skipping: () => true });
    expect(clock.t).toBe(0);
  });
});
