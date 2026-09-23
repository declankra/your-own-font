// The Making timeline (SPEC.md §7), separate from React so it can be tested with a fake clock.
//
//   cast   each letter lifts in once the worker has reported its outline, then turns to type
//   set    the row closes up once metrics exist
//   ink    the roller sweeps; the step ends only when the variants are built
//   press  the head comes down only once the .otf exists
//
// On the first run the whole thing takes at least `minMs` (7 s). Reduced motion: no flips,
// roller or press; each letter fades in as it is cast, then straight to Done.

import type { BuildGate } from "./build-gate";

export interface MakingUI {
  caption(text: string): void;
  lift(i: number): void;
  cast(i: number): void;
  setRow(): void;
  /** the roller's sweep; resolves when it has passed the whole row */
  roll(): Promise<void>;
  /** head down, thunk, sorts flip back as printed paper, head up */
  press(): Promise<void>;
  /** reduced motion: letter i fades in */
  fadeIn(i: number): void;
}

export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const realClock: Clock = {
  now: () => performance.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

export class Cancelled extends Error {}

/** Roughly how long ui.press() takes, so the 7 s floor can be met before it starts. */
export const PRESS_MS = 1300;
export const MIN_MS = 7000;

export async function runMaking(
  gate: BuildGate,
  ui: MakingUI,
  opts: { reduced: boolean; minMs: number; clock?: Clock; alive?: () => boolean; skipping?: () => boolean },
): Promise<void> {
  const clock = opts.clock ?? realClock;
  const alive = opts.alive ?? (() => true);
  const skipping = opts.skipping ?? (() => false);
  const start = clock.now();
  const sleep = async (ms: number) => {
    if (!skipping()) await clock.sleep(ms);
    if (!alive()) throw new Cancelled();
  };
  const step = async <T>(p: Promise<T>) => {
    const v = await p;
    if (!alive()) throw new Cancelled();
    return v;
  };

  if (opts.reduced) {
    const per = opts.minMs / 26;
    for (let i = 0; i < 26; i++) {
      await step(gate.glyph(i));
      ui.fadeIn(i);
      ui.caption(`casting letters · ${i + 1}/26`);
      await sleep(per);
    }
    await step(gate.set());
    ui.caption("setting the row");
    await step(gate.inked());
    ui.caption("inking");
    await step(gate.built());
    ui.caption("pressing");
    return;
  }

  await sleep(500);
  for (let i = 0; i < 26; i++) {
    await step(gate.glyph(i)); // the next letter waits to be cast if the work is slow
    ui.lift(i);
    ui.caption(`casting letters · ${i + 1}/26`);
    clock.sleep(skipping() ? 0 : 200).then(() => alive() && ui.cast(i));
    await sleep(125);
  }
  await sleep(500);
  await step(gate.set());
  ui.caption("setting the row");
  ui.setRow();
  await sleep(700);
  ui.caption("inking");
  await step(Promise.all([skipping() ? Promise.resolve() : ui.roll(), gate.inked()]));
  ui.caption("pressing");
  await step(gate.built()); // never a finished state before the Blob exists
  const hold = opts.minMs - (clock.now() - start) - PRESS_MS;
  if (hold > 0) await sleep(hold);
  if (!skipping()) await step(ui.press());
}
