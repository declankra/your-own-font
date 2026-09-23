export { CLASSES, LETTERS, NULL_CLASS, NULL_ID, N_CLASSES, PUNCT, classId } from "./classes.ts";
export { COLS, N_SCALARS, ROWS, SCALAR_NAMES, rasterize, type Guides, type Point, type Polyline } from "./raster.ts";
export { LetterModel, type ClassPrior, type LayerSpec, type ModelHeader } from "./model.ts";
export {
  DEFAULT_PARAMS,
  buildUnits,
  enumerateCandidates,
  findCuts,
  segment,
  type Mode,
  type SegmentOptions,
  type SegmentParams,
  type SegmentResult,
  type Unit,
} from "./segment.ts";
export { liveAssign, TARGET_LENGTH } from "./live.ts";
export {
  checkWord,
  piecesByLetter,
  type FixturePoint,
  type FixtureSession,
  type FixtureWord,
  type Piece,
  type Split,
} from "./fixture.ts";
