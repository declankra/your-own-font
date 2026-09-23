// Python and TypeScript must see the same input and produce the same scores
// (docs/letter-model.md §6). Fixtures come from `uv run letter-model export`.
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { LetterModel } from "../src/letter-model/model.ts";
import { N_SCALARS, rasterize } from "../src/letter-model/raster.ts";

const root = new URL("../../letter-model/", import.meta.url);
const bin = readFileSync(new URL("letter-model.bin", root));
const fx = JSON.parse(readFileSync(new URL("./fixtures/parity.json", import.meta.url), "utf8"));

describe("parity with the Python pipeline", () => {
  test("fixtures belong to this model file", () => {
    expect(fx.modelBytes).toBe(bin.byteLength);
    const m = new LetterModel(bin);
    expect(m.header.trainingDataHash).toBe(fx.trainingDataHash);
  });

  test(`raster: ${fx.raster.length} groups within 1/255 per pixel`, () => {
    let worst = 0;
    let worstScalar = 0;
    for (const g of fx.raster) {
      const { raster, scalars } = rasterize(g.strokes, g.guides);
      for (let i = 0; i < raster.length; i++) worst = Math.max(worst, Math.abs(raster[i] - g.raster[i]));
      for (let j = 0; j < N_SCALARS; j++)
        worstScalar = Math.max(worstScalar, Math.abs(scalars[j] - g.scalars[j]) / Math.max(1, Math.abs(g.scalars[j])));
    }
    console.log(`raster parity: max |ts - py| = ${worst.toExponential(2)} per pixel, scalars ${worstScalar.toExponential(2)}`);
    expect(worst).toBeLessThanOrEqual(1 / 255);
    expect(worstScalar).toBeLessThanOrEqual(1e-5);
  });

  test(`logits: ${fx.logits.length} samples within 1e-3`, () => {
    const m = new LetterModel(bin);
    let worst = 0;
    let agree = 0;
    for (const g of fx.logits) {
      const z = m.logits(g.strokes, g.guides);
      let am = 0;
      let bm = 0;
      for (let i = 0; i < z.length; i++) {
        worst = Math.max(worst, Math.abs(z[i] - g.logits[i]));
        if (z[i] > z[am]) am = i;
        if (g.logits[i] > g.logits[bm]) bm = i;
      }
      if (am === bm) agree++;
    }
    console.log(`logit parity: max |ts - torch| = ${worst.toExponential(2)}, argmax agrees ${agree}/${fx.logits.length}`);
    expect(worst).toBeLessThanOrEqual(1e-3);
  });
});
