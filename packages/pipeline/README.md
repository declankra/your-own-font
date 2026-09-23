# @your-own-font/pipeline

The font pipeline that runs in the app's Web Worker: the letter model's runtime and the
stroke-to-letter solver (`src/letter-model/`), and the font build (`src/font/`:
`perfect-freehand` → `polygon-clipping` → `fit-curve` → `opentype.js`). Plain TypeScript: no
WASM, no WebGL, no server.

| Export | What |
|---|---|
| `./letter-model` | The model, `segment()`, `liveAssign()` (below) |
| `./font` | `buildFont(input, { model, onEvent })`: cast → set → ink → press, one event per step, then the `.otf` |
| `./worker` | `attachPipeline(self)`: the worker's message protocol (segment, build) |
| `./pen`, `./alt`, `./live`, `./fixture`, `./house-hand` | Light modules the page uses without pulling in opentype.js |

```ts
import { LetterModel, segment } from "@your-own-font/pipeline/letter-model";

const model = new LetterModel(await (await fetch(modelUrl)).arrayBuffer()); // letter-model.bin
const cache = new Map(); // one per word; keep it through undo (entries are keyed by the ink itself)
// after every pen-up while the word is being written:
const live = segment(strokes, "quick,", guides, { mode: "model", model, partial: true, cache });
// when the word is complete:
const { letterOfStroke, splits, unresolved } = segment(strokes, "quick,", guides, { mode: "model", model, cache });
```

`strokes` is one array of `[x, y, ...]` points per pen-down, in pad pixels.
`guides` is `{ baseline, xHeight }` in the same pixels.

| File | What |
|---|---|
| `raster.ts` | The model's input: a 40×32 raster framed by the guides, plus 7 scalars. Mirrors the Python rasterizer |
| `model.ts` | Loads `letter-model.bin` (fp16) and runs it. `score()` returns 32 log-probabilities |
| `segment.ts` | Candidates, dynamic programming, the dot/crossbar repair step, "nothing fits" |
| `live.ts` | The instant gap rule used while the pen moves (SPEC.md §6.1) |
| `fixture.ts`, `validate.ts` | The recorded-session format and its checks |

## Scripts

| Command | What |
|---|---|
| `npm test` | Parity with the Python pipeline (rasters within 1/255 per pixel, logits within 1e-3), and the font build end to end (segment the sentence pair, build, parse the `.otf`) |
| `npm run eval:segment -- --model <bin> <sessions>` | Per-letter exact match: model, geometry and the live rule |
| `npm run validate -- <session.json>` | Check a recorded session against the schema |
| `npm run bench:browser -- <out.json>` | `tools/bench` headless: Chromium, Chromium at 4× CPU throttling, and WebKit |
| `npm run e2e:collect -- <replay.json> <out.json>` | Drive `tools/collect` end to end from `file://` and validate the saved file |
| `npm run build:tools` | Rebuild `tools/*/lib.js` after a new model |

The training side lives in `packages/letter-model` (`./reproduce.sh`).
