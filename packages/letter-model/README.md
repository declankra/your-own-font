# letter-model

Trains the small on-device model that decides which strokes belong to which letter
(docs/letter-model.md is the spec; `MODEL_CARD.md` has the numbers). Python 3.12 with `uv` and
PyTorch, on Apple Silicon (MPS) or CPU.

## One command

```bash
./packages/letter-model/reproduce.sh
```

It runs these stages in order, with fixed seeds, in about 25 minutes on an M4 Pro:

| Stage | What it does | Output |
|---|---|---|
| `prepare` | Download the sources that passed the licence gate (`DATA.md`); place every glyph on our guides; split by writer | `data/raw/`, `data/cache/glyphs.pkl` |
| `synth` | Augmented letters, the four ∅ types, synthetic words in the fixture format | `data/cache/*.npz`, `words_*.jsonl` |
| `candidates` | Run the product's segmenter (TypeScript) over the training words; label every candidate group against the truth | `data/cache/cand_*.npz` |
| `train` | Confident-learning cleanup of ∅ labels; teacher (the spec's starting net); distilled student; ∅ margin | `data/cache/model.pt` |
| `export` | fp16 `letter-model.bin` with geometry priors; parity fixtures | `letter-model.bin`, `../pipeline/test/fixtures/parity.json` |
| `tune` | Tune the solver's weights on validation words (geometry mode first, for a fair baseline), re-export | `letter-model.bin` |
| `tools` | Bundle the model and solver for `tools/collect` and `tools/bench` | `tools/*/lib.js` |
| `parity` | vitest: TS and Python rasters and logits agree | |
| `evaluate` | Classifier and segmentation on held-out writers, headless browser bench, failure images | `report/`, the metrics block in `MODEL_CARD.md` |

Run a single stage with `uv run letter-model <stage>` from this folder. Pass `--no-bench` to
skip the headless browser bench.

Nothing under `data/` goes into version control: raw downloads, synthesized arrays and real
handwriting (`data/real/`) all stay local.

## Layout

- `src/letter_model/`
  - `raster.py`: the input representation. Mirrors `packages/pipeline/src/letter-model/raster.ts`.
  - `glyphs.py`, `data/`: sources, and placing them on guides.
  - `augment.py`, `negatives.py`, `words.py`, `synth.py`: synthesis.
  - `model.py`, `train.py`, `export.py`: the network, training and the `.bin` writer.
  - `evaluate.py`, `render.py`: metrics and images.
- `fixture.schema.json`: the recorded-session format (docs/letter-model.md §5).
- `letter-model.bin`: the shipped weights.
- `report/`: `metrics.json`, `metrics.md`, failure sheets, the headless bench, and the last run's log.

## Real writers (phase 2)

1. Put each session file from `tools/collect/index.html` in `data/real/`.
2. Check it: `cd ../pipeline && npm run validate -- ../letter-model/data/real/*.json`.
3. Measure the current model on it:

   ```bash
   npx tsx scripts/eval-segment.ts --model ../letter-model/letter-model.bin ../letter-model/data/real/*.json
   ```

   This reports model, geometry and the live rule side by side (subset `real`).

Fine-tuning on real writers is phase 2 (docs/letter-model.md §7).
