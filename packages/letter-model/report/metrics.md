### Classifier (held-out writers and styles, shipped fp16 weights)

| Test set | n | top-1 (31 classes, ∅ counts as wrong) |
|---|---:|---:|
| all held-out | 2626 | **93.49** |
| UJI writers (real, stylus) | 1488 | 91.8 |
| Omniglot drawers (real, mouse) | 208 | 95.19 |
| font styles (synthetic) | 930 | 95.81 |
| all held-out, ∅ ignored (argmax over letters) | 2626 | 95.2 |

| ∅ (not exactly one letter) | n | precision | recall |
|---|---:|---:|---:|
| negatives that are not letter-shaped | 7110 | 98.95 | 87.24 |
| negatives, only confident lookalikes excluded | 7548 | 98.97 | 83.94 |
| negatives, all (the spec's four types as generated) | 8000 | 98.97 | 79.3 |
| &nbsp;&nbsp;cut (14.48% of this type are letter-shaped) | 1524 | – | 83.73 |
| &nbsp;&nbsp;fragment (4.69% of this type are letter-shaped) | 1869 | – | 88.01 |
| &nbsp;&nbsp;merged (1.09% of this type are letter-shaped) | 2088 | – | 98.32 |
| &nbsp;&nbsp;missing (24.09% of this type are letter-shaped) | 1629 | – | 75.45 |

The two targets pull against each other through the ∅ margin (letter-shaped negatives excluded):

| Operating point | top-1 | ∅ precision | ∅ recall |
|---|---:|---:|---:|
| shipped (margin chosen on validation) | 93.49 | 98.95 | 87.24 |
| best top-1 with ∅ recall ≥ 90% | 92.5 | 98.45 | 91.03 |
| best ∅ recall with top-1 ≥ 95% | 95.13 | 99.84 | 63.16 |

Real letters called ∅: 2.51%. Most common confusions: n→m (9), i→∅ (8), v→∅ (7), l→∅ (7), x→∅ (5), y→g (4), ?→! (4), c→∅ (4).

### Segmentation (held-out synthetic words, per-letter exact match, %)

| Subset | letters | model | geometry | live gap rule |
|---|---:|---:|---:|---:|
| all | 7008 | **94.89** | 89.58 | 42.68 |
| wide spacing | 2336 | **97.82** | 94.14 | 67.94 |
| tight spacing | 2336 | **95.12** | 88.31 | 39.85 |
| touching / overlapping | 2336 | **91.74** | 86.3 | 20.25 |
| run-on strokes (one stroke, two letters) | 1373 | **79.53** | 71.38 | 16.82 |
| dots and crossbars written last | 2470 | **94.37** | 88.38 | 38.46 |
| UJI writers | 4320 | **94.51** | 90.37 | 43.7 |
| font styles | 2160 | **95.83** | 88.94 | 40.69 |
| Omniglot drawers | 528 | **94.13** | 85.8 | 42.42 |
| after every pen-up (finished letters) | 8908 checks | **95.39** | 82.72 | – |

Second word list (60 other common words, incl. `' ! ?`): model 93.77%, geometry 88.7%, live rule 44.8% (8979 letters).

### Size

66800 weights, `letter-model.bin` 134.8 KB, **123.9 KB gzipped** (budget 300 KB).

### Latency (tools/bench, headless, this Mac: Apple M4 Pro)

| Browser | per candidate p50 / p95 (ms) | per pen-up re-solve p50 / p95 (ms) | cold whole-word re-solve p50 / p95 (ms) |
|---|---:|---:|---:|
| chromium | 0.098 / 0.112 | 0.40 / 1.20 | 2.00 / 4.40 |
| chromium 4x | 0.427 / 0.488 | 1.90 / 5.30 | 9.00 / 19.30 |
| webkit | 0.071 / 0.086 | 0.00 / 1.00 | 1.00 / 3.00 |
