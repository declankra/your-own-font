// The browser bundle for tools/collect and tools/bench: the letter model runtime, the
// segmenter, the live rule, fixture checks and the product's pen (perfect-freehand), exposed
// as the global `LM`. The model weights are inlined so the pages run from file:// with no server.
import { getStroke } from "perfect-freehand";
import { CLASSES } from "../src/letter-model/classes.ts";
import { checkWord, piecesByLetter } from "../src/letter-model/fixture.ts";
import { liveAssign, TARGET_LENGTH } from "../src/letter-model/live.ts";
import { LetterModel } from "../src/letter-model/model.ts";
import { rasterize } from "../src/letter-model/raster.ts";
import { buildUnits, DEFAULT_PARAMS, enumerateCandidates, segment } from "../src/letter-model/segment.ts";
import { validateSession } from "../src/letter-model/validate.ts";

declare const __MODEL_B64__: string;

function loadModel(): LetterModel {
  const bin = atob(__MODEL_B64__);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new LetterModel(bytes);
}

export {
  buildUnits,
  checkWord,
  CLASSES,
  DEFAULT_PARAMS,
  enumerateCandidates,
  getStroke,
  liveAssign,
  LetterModel,
  loadModel,
  piecesByLetter,
  rasterize,
  segment,
  TARGET_LENGTH,
  validateSession,
};
