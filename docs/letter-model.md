# Letter model: training spec

Owner decision, 2026-09-22: stroke-to-letter matching uses a small on-device model that
**we train ourselves**. No hosted models, no LLMs, no jev, and nothing leaves the device.
The row in `DECISIONS.md` (Letter validation and matching) and `SPEC.md` §6 say where the
model sits in the product. This document is how to build it.

## 1. The job

The person is told exactly which word to write. The model never has to read their
handwriting. It answers a narrower question, many times per word:

> Given this group of strokes, and the letter it would be if we grouped it this way, how
> likely is it that the group is exactly that letter, rather than part of a letter or two
> letters stuck together?

A dynamic-programming segmenter (`SPEC.md` §6.2) uses these scores, plus geometry priors,
to decide which strokes make which letter. It runs after every pen-up.

**What good looks like:** a writer whose letters touch, who dots every i at the end of the
word, or who crosses t's late, still gets every stroke into the right glyph without doing
anything. The prompt fill quietly settles to the right letter.

**Misses** (any one of these fails the work):
- The model looks great on a public dataset but loses to plain geometry on our own
  recorded writing.
- It needs a multi-megabyte runtime (onnxruntime-web, TF.js) or a server.
- It is trained on data whose licence doesn't allow shipping the weights in an MIT repo.
- It is used to reject, block or "correct" what someone drew.
- The Python and TypeScript sides rasterize differently, so shipped scores don't match the
  scores we trained and measured.

## 2. Contract

| | |
|---|---|
| Classes (32) | `a`–`z`, `,` `.` `'` `!` `?`, and `∅` ("not exactly one letter") |
| Input | one stroke group plus the writing guides (baseline y, x-height px), rasterized per §3 |
| Output | 32 logits → log-softmax. The segmenter reads log P(expected letter) and log P(∅) |
| Runs in | the pipeline Web Worker, in our own TypeScript. No WASM runtime, no WebGL |
| Weights | ≤ 300 KB gzipped, fp16 |
| Speed | ≤ 0.5 ms per candidate group on an iPhone 12 / Pixel 6 class phone. The whole per-pen-up re-solve (≤ 40 candidates for a 7-letter word) takes ≤ 8 ms p95 |
| Determinism | same strokes → same scores, in both Python and TS (parity test, §6) |

## 3. Input representation (the same in Python and TypeScript)

- **Frame from the guides, not from the ink.** Let `xh` be the x-height in px. The raster
  window runs vertically from `baseline − 2.0·xh` to `baseline + 1.0·xh` (3·xh tall, so
  ascenders and descenders keep their position) and maps to **40 rows**. Horizontally it
  is centred on the group's ink at the same scale, **32 columns** (2.4·xh). Wider groups
  (m, w, merged pairs) are squeezed horizontally to fit; the squeeze factor becomes a
  scalar feature.
- **Rasterizer:** each stroke segment is a capsule of radius `0.08·xh`, scaled into the
  frame. Pixel value = `clamp(r − d + 0.5, 0, 1)`, where `d` is the pixel centre's
  distance to the nearest segment. There is no pressure, so every pen and every
  pointerType looks alike. Write it once in TS and once in Python, and keep them in
  parity.
- **Scalar features** (normalised by `xh`): ink width, ink height, ink top and ink bottom
  relative to the baseline, stroke count, total ink length, squeeze factor. That's 7
  values.
- One raster channel is the default. A second channel (for example stroke order or
  direction) is allowed if it measurably helps on the real-writer set.
- **Pinned down while building (2026-09-22, agent):**
  - Pixel (row, col) has its centre at (col + 0.5, row + 0.5) cells.
  - The column window is centred on the ink bounding box.
  - A group is squeezed when its ink is wider than 32 cells minus the pen radius on each
    side. The squeeze scales x about the ink centre. The pen radius (1.067 cells) is not
    squeezed, so strokes keep their thickness.
  - A one-point stroke (a tap) is a disc.
  - Stroke count counts pieces: a stroke cut in two counts twice.
  - Scalars are standardised inside the model; the mean and sd ship in the file header.
  - The reference implementations are `packages/letter-model/src/letter_model/raster.py`
    and `packages/pipeline/src/letter-model/raster.ts`.

## 4. Data

Every source must pass a **licence gate** before use. Record the licence text or link,
attribution, and "can we ship weights trained on this in an MIT repo? yes/no" in
`packages/letter-model/DATA.md`. If the licence is unclear, don't use the source, and list
it as unused with the reason.

| Source | What it gives | Status |
|---|---|---|
| **Synthetic, from single-line glyphs** | Unlimited online strokes. Seeds: the house hand in `design/homepage-prototype.html` (`const G`), Hershey single-stroke fonts, and any OFL single-line fonts | Main bootstrap source. Hershey and each font need the licence gate |
| **UJI Pen Characters v2** (UCI) | About 11.6k real online characters from 60 writers, including lowercase and punctuation. No guides, so place them per class (see below) | Licence not yet verified; gate required |
| **EMNIST ByClass** (NIST) | Offline 28×28 bitmaps, with lowercase as its own classes | Optional pretraining for the conv trunk only (no strokes, so no scalar features). Licence gate required |
| **Our own recorded sessions** (§5) | The real distribution: our guides, our words, our devices | Required for evaluation and fine-tuning. Needs the owner to recruit writers |
| IAM-OnDB and derivatives | — | **Excluded**: research-only terms |

**Placing guide-less data on guides.** Put the ink bottom at the baseline and the top at
the x-height for x-height letters. Ascenders reach 1.5–1.9·xh. Descenders drop
0.6–0.9·xh. Punctuation sits at the baseline, or the upper band for `'`. Add ±0.15·xh of
jitter so the model tolerates writers who ignore the lines.

*As built (2026-09-22, agent), status of each source:*

- **Licence gate:** see `packages/letter-model/DATA.md`. Used: UJI v2 (CC BY 4.0), Omniglot's
  lowercase Latin (MIT), Hershey, 13 EMS single-line fonts, Relief SingleLine and Cutlings
  (OFL), and the house hand. Rejected: EMNIST (licence unclear), UNIPEN, BRUSH and the
  other recorded-handwriting sets.
- **UJI has guides after all.** Its boxes have two guide lines, but writers wrote about 25%
  smaller than the x-height they mark and kept to the baseline. So each UJI session is
  placed on its own frame: the median bottom and the median height of that session's
  x-height letters. Letters keep their real relative sizes. Punctuation is re-placed by
  class, as above, because UJI writers put it anywhere in the box.
- **Omniglot** is placed per class, as above.
- **Writer size.** In training, a writer's own x-height is 0.65–1.35× the guide x-height
  (log-normal around 0.92), because UJI showed people don't fill the guides.

**Augmentation (online):**
- slant from −15° to +20°, x-scale 0.8–1.25, smooth elastic point noise;
- a stroke split into two pen-lifts, and overshoot or undershoot at joins;
- open bowls on a/o/g, and dots that drift from the stem;
- realistic stroke-order variants: t crossbar first or last, i dot first or last.

**Negatives (`∅`), built from words, not from noise:**
- two adjacent letters merged;
- a letter cut at 25–75% of its width;
- a letter plus a fragment of its neighbour;
- a letter missing a component that holds ≥ 30% of its ink.

A dotless `i` or an uncrossed `t` stays a **positive**. People do write that way, and the
product must accept it.

**What ∅ means (decision refined 2026-09-22, agent).** Some cut and truncated letters are
not "not a letter" at all: they are another letter. The stem of an `h` is an `l`. Two
thirds of an `m` is an `n`. An unfinished `o` is a `c`. Labelling those ∅ makes the model
call real `l`, `n` and `c` ∅ too. With every generated negative labelled ∅, 7–9% of real
letters were predicted ∅. The segmenter doesn't need those labels: it already asks for the
*expected* letter, and an `h`-stem scores low as `h` whatever it is called. So a negative
is not used as a ∅ example when either rule holds:

1. **Confidently a letter.** A model trained with ∅ labels, scoring out-of-fold (folds by
   writer), still reads it as one specific letter with P ≥ 0.5 (confident learning). This
   catches 1–10% per type.
2. **Letter-shaped partial.** It is part of a single letter (types *cut* and *missing*, and
   candidate groups whose ink comes from one letter), and a letters-only model reads it as
   one specific letter with P ≥ 0.9. This rule is not applied to ink from two letters: a
   letters-only model has never seen junk and calls `on` an `m`.

These samples are dropped, not relabelled. `MODEL_CARD.md` reports ∅ precision and recall
three ways, with sample images: on negatives that are not letter-shaped (the headline),
with only rule 1, and on every generated negative.

**Words.** Compose synthetic words from synthetic glyphs, with spacing that ranges from
wide to touching (negative gaps), for segmentation training and evaluation. Use the
sentence pairs (`SPEC.md` §5.6) as the word list.

*As built:*

- Spacing is wide, tight or touching, with gaps of −0.14 to +0.55 of the writer's x-height.
- The baseline drifts by up to ±0.15 xh.
- In 35% of words, dots and crossbars are written after the whole word.
- In 40% of words the pen runs on into the next letter. That only happens where it's
  natural: the stroke ends on the right of one letter, the next starts on its left, and the
  hop is under 0.9 xh. The connector's extent is recorded in the split's optional `range`.
- Training words mix the sentence pair with about 330 common words, including `' ! ?`.
  Evaluation uses the sentence pair, plus a second list of 60 other words.

**Splits.** Always split **by writer**, never by sample. Hold out 20% of UJI writers and
20% of real writers.

## 5. Real writers: the collection tool and fixture format

Build `tools/collect/index.html`, a standalone page like the prototype, runnable locally,
with no server.
- It uses the product's pen, guides and one-word-at-a-time flow, and records raw pointer
  events.
- After each word, a review step shows the proposed letter boundaries, so the labeller can
  fix them by tapping strokes. For a stroke that spans two letters, the labeller drags a
  cut point.
- The session saves as one JSON file through the browser's download. Consent line on the
  first screen: "Your handwriting will be used to train an open-source model and may be
  published with it." The owner must approve this wording (§8).

Fixture format (`packages/letter-model/data/real/<writerId>.json`, one file per session):

```json
{
  "version": 1,
  "writerId": "w017",
  "device": "iPhone 13",
  "pointerType": "touch",
  "recordedAt": "2026-10-01",
  "words": [
    {
      "text": "quick,",
      "guides": { "baseline": 190.0, "xHeight": 60.0 },
      "strokes": [ { "points": [[x, y, pressure, tMs], ...] } ],
      "letterOfStroke": [0, 0, 1, 2, 2, 3, 4, 4, 5],
      "splits": [ { "stroke": 6, "atPoint": 31, "left": 3, "right": 4 } ]
    }
  ]
}
```

`letterOfStroke[i]` is the index into `text` of stroke *i*. `splits` handles one stroke
that spans two letters. These same files are the pipeline fixtures that `DECISIONS.md` and
`SPEC.md` §6.5 refer to.

*Pinned down while building (2026-09-22, agent). Schema:
`packages/letter-model/fixture.schema.json`. Check a file with
`npm run validate -- <file.json>` in `packages/pipeline`.*

- **The cut point.** `atPoint` belongs to both pieces: left is `[0..atPoint]`, right is
  `[atPoint..]`.
- **Several cuts on one stroke** chain in point order (`right` of one = `left` of the next).
- **`letterOfStroke` of a split stroke** is the letter of its last piece, as in the example
  above (stroke 6: `right` 4).
- **Optional fields:**
  - `consent` (session): the line shown to the writer.
  - `proposal` (word): what the segmenter proposed before the labeller's fixes, so bias
    toward the proposal can be measured.
  - `meta` (word): free-form.
  - `range` (split): synthetic words only, the run-on connector's first and last point.
- **Exact match**, the §7 metric: a letter matches when it touches exactly the same strokes
  as the truth, and every cut lies within 0.5·xh (along the pen path) of the labelled cut.
  For synthetic words, a cut anywhere inside the recorded connector counts, because
  connector ink belongs to neither letter's shape.

## 6. Training, export, inference

- **Training:** `packages/letter-model/` holds Python 3.12 managed by `uv`, with PyTorch.
  It runs on Apple Silicon (MPS) or CPU. One command runs the whole pipeline
  (download/prepare → synthesize → train → evaluate → export). Seeds are fixed. A full
  run takes ≤ 60 min on an M-series MacBook. Raw downloads go under `data/raw/`, and
  that folder is ignored by version control.
- **Starting architecture** (the receiver may change it within the §2 budgets):
  - trunk: conv3×3 1→16, conv 16→16, max-pool, conv 16→32 twice, max-pool, conv 32→64;
  - head: global average pool, concatenate with the 7 scalars, FC 64, FC 32.
  - About 40k parameters.
- **Changed (2026-09-22, agent): the starting architecture is too slow, so it is the teacher.**
  - Its 40k parameters cost about 9M multiply-adds per candidate: 2.6 ms in plain
    TypeScript on an M4 Pro, about 10 ms at 4× throttling. That is twenty times the
    0.5 ms budget. Plain JS runs about 1–2 ns per multiply-add, whatever the loop layout.
  - It is kept as a **teacher**: trained first, then distilled into the shipped
    **student**, `dsflat`, a depthwise-separable net:
    - conv3×3/2 1→16, dw3×3/2, pw 16→32, dw3×3/2, pw 32→48;
    - flatten 5×4×48, concatenate the 7 scalars, FC 64, FC 32;
    - about 67k weights, 199k multiply-adds, about 90 µs per candidate in V8 on an
      M4 Pro, raster included.
  - Convolutions run in scatter form and skip zero inputs; most of the raster is blank.
  - BatchNorm is folded at export.
  - A ∅ logit margin, calibrated on validation letters and negatives, is folded into the
    last bias.
  - Other students tried, with the same teacher: `ds12` (107k multiply-adds, clearly less
    accurate); `ds16` (x-pooled head, about 1 point behind); `s1pool` (full-resolution
    first layer: accurate, but 280 µs).
- **Export:** a single `letter-model.bin`. It holds a JSON header (version, architecture,
  class list, input spec, training data hash) followed by fp16 tensors. Next to it goes a
  `MODEL_CARD.md` with the data sources, licences, metrics from §7 and known failure
  modes.
- **Inference:** `packages/pipeline/src/letter-model/` contains:
  - `rasterize(strokes, guides)` and `score(group, guides) → Float32Array(32)`, in plain
    TypeScript (conv, ReLU, pool, dense);
  - `segment(strokes, word, guides, opts) → { letterOfStroke, splits, cost, unresolved?: number }`,
    with `opts.mode: "model" | "geometry"`, so the two can always be compared.
  - *As built:*
    - `score()` returns the log-softmax.
    - `opts` also takes `partial` (while writing: trailing letters may be empty, and the
      last letter is scored leniently) and `cache`, a per-word map of group scores reused
      across pen-ups.
    - The result also carries `lettersWritten`, `modelCalls` and `candidates`.
    - Geometry mode uses data-driven width, height and gap priors from the model file, and
      its weights are tuned on validation for geometry mode itself, so it is a fair
      baseline.
    - `liveAssign()` is the §6.1 gap rule, reported as a third number.
    - Two solver terms found necessary on validation words:
      - **Cut cost.** A cost per stroke that a letter shares with a neighbour. Without it,
        the valley cutter handed slivers of `x` diagonals and `t`-bars to the next letter.
      - **Pen-up credit.** A credit per letter counted as written while the word is in
        progress. Without it, "finished letter + first stroke of the next letter" scored
        as one lenient group beat the right answer. "Settle after every pen-up" went from
        65% to 96% on validation.
    - All solver weights are tuned by the pipeline's `tune` stage on validation words and
      stored in the model file's header.
- **Parity tests (vitest):**
  - TS and Python rasters of the same 200 groups differ by ≤ 1/255 per pixel;
  - TS and PyTorch logits on 1,000 samples differ by ≤ 1e-3.

## 7. Acceptance

**Phase 1** (can be finished by an agent alone):
- [x] `DATA.md` covers every source considered, used or rejected, with its licence
      verdict.
- [x] One command reproduces training from scratch within the time budget.
      *`./packages/letter-model/reproduce.sh`: 15–19 min on an M4 Pro.*
- [ ] Classifier on held-out writers (UJI held-out plus synthetic): top-1 ≥ 95% on the
      31 real classes, and `∅` precision and recall ≥ 90%.
      *Not met: top-1 93.5%, ∅ precision 99.0%, ∅ recall 87.2%. The trade-off and why are
      in `MODEL_CARD.md`. Even the starting architecture (45× the compute budget) reaches
      only 94.6% / 90.7%.*
- [x] Segmentation on held-out synthetic words, including touching letters: model beats
      geometry-only, with both numbers reported.
      *94.9% vs 89.6% overall; touching 91.7% vs 86.3%.*
- [ ] Parity tests pass. The weights file is within budget. A benchmark page
      (`tools/bench/index.html`) reports per-candidate and per-re-solve timings. It has
      been run in desktop Safari and Chrome with 4× CPU throttling, and in real phone
      browsers if one is reachable.
      *Mostly met.*
      - *Parity passes (5e-7 per pixel, 4e-6 logits); weights are 124 KB gzipped.*
      - *The bench ran in Chrome (the desktop app's built-in browser, which has no
        throttling control), in headless Chromium at 4× DevTools throttling, and in WebKit,
        Safari's engine, headless. At 4×, the per-pen-up re-solve is p95 5.3 ms (within
        budget). Per candidate is p50 0.43 ms and p95 0.49–0.52 ms across runs, right
        on the 0.5 ms line.*
      - *Not done: desktop Safari itself (driving it needs Safari's remote-automation
        setting, which I did not switch on) and a real phone (none reachable).*
- [x] The collection tool works end to end: record, review and label, then save JSON that
      validates against the fixture schema. The owner can hand it to a writer.
      *Driven by hand in the built-in browser. The one command also drives it headless
      from `file://` every run, and validates the saved file.*

**Phase 2** (after the owner has collected ≥ 20 real writers):
- [ ] Fine-tune on real writers (held-out writers excluded).
- [ ] Segmentation exact-match per letter on held-out real writers is ≥ 98%, reported by
      pointerType, and beats geometry-only.
- [ ] `MODEL_CARD.md` is updated with real-writer numbers and the worst failure cases
      (with images).

## 8. Needs the owner

- Approve the consent wording and decide whether volunteers' handwriting may be published
  in the open-source repo. Until then, real sessions stay out of version control.
- Recruit ≥ 20 writers across finger, stylus and mouse, including at least a few messy
  writers and people whose letters touch.
- Initialise git for the repo, if work should be committed.
