# Data sources and licence gate

Every source considered for the letter model, with its licence and one verdict: **can we
ship weights trained on it in an MIT repo?** Rule (docs/letter-model.md §4): if the licence
is unclear, the source is not used. IAM-OnDB and anything derived from it are excluded
outright. Checked 2026-09-22.

None of these datasets is committed to this repo. `uv run letter-model prepare` downloads
the used sources into `data/raw/` (git-ignored) at build time. The trained weights ship,
plus two small derived test files (see "Derived data that is committed" below).
Whether trained weights legally count as a derivative of their training data is unsettled.
We act as if they might, so every attribution below also appears in `MODEL_CARD.md`.

## Used

| Source | What it gives us | Licence | Ship weights? | Attribution |
|---|---|---|---|---|
| **UJI Pen Characters v2** (UCI #177) | 60 real writers × 2 sessions, online strokes (tablet stylus), incl. a–z and `. , ' ! ?`. Main real source | CC BY 4.0 (UCI page: "This dataset is licensed under a Creative Commons Attribution 4.0 International (CC BY 4.0) license.") | **Yes** | Prat, F., Castro, M., Llorens, D., Marzal, A., & Vilar, J. (2008). *UJI Pen Characters (Version 2)* [Dataset]. UCI Machine Learning Repository. https://doi.org/10.24432/C5FG8S. Changed: resampled, placed on guides, augmented |
| **Omniglot**, Latin alphabet (github.com/brendenlake/omniglot) | 20 drawers × 26 lowercase letters, drawn with a mouse, online strokes. No punctuation, no guides | MIT ("The MIT License (MIT) Copyright (c) 2015 Brenden Lake") | **Yes** | MIT notice; Lake, Salakhutdinov & Tenenbaum (2015), *Science* 350(6266) |
| **House hand** (`const G` in `design/homepage-prototype.html`) | One synthetic style seed, a–z `' , .` | Ours (MIT) | **Yes** | — |
| **Hershey fonts**: Roman Simplex (`rowmans`), Script Simplex (`scripts`), `.jhf` from github.com/kamalmostafa/hershey-fonts | Single-stroke vector glyphs, two styles | Hershey usage notice: "may be used by anyone for any purpose, commercial or otherwise", provided the acknowledgement is distributed and the data isn't redistributed in the NTIS format | **Yes** | "The Hershey Fonts were originally created by Dr. A. V. Hershey while working at the U. S. National Bureau of Standards. The format of the Font data in this distribution was originally created by James Hurt, Cognition, Inc." |
| **EMS single-line SVG fonts** (gitlab.com/oskay/svg-fonts): CasualHand, Tech, Delight, Pancakes, Neato, Bird, Felix, Allure, Pepita, Readability, Readability Italic, Nixish, Herculean | 13 single-line styles; print handwriting, semi-cursive, typographic | SIL OFL 1.1 (stated in each file: "License: SIL Open Font License") | **Yes** | Each font's name; Sheldon B. Michaels and Windell H. Oskay; upstream designers (Covered By Your Grace, Architects Daughter, Delius, Short Stack, Bad Script, Bilbo, Felipa, Allura, Pecita, Source Sans Pro, Nixie One, Poiret One); OFL 1.1 |
| **Relief SingleLine** (github.com/isdat-type/Relief-SingleLine) | Sans single-line style (open-path SVG) | SIL OFL 1.1 | **Yes** | "Copyright 2022 The Relief SingleLine Project Authors", OFL 1.1 |
| **Cutlings Singularis** (Ellen Wasbo) | Single-line handwriting style | SIL OFL (in the file's metadata) | **Yes** | Ellen Wasbo, OFL. The official download is a Dropbox zip; we fetch the unmodified SVG from a mirror (github.com/ewraj/CNC-Plotter) that keeps the licence metadata |

The OFL restricts redistributing the font software itself: you can't sell it alone, and
derivative fonts must stay OFL. We never redistribute font data. The fonts are rasterized
into training samples at build time, and only model weights ship. The OFL FAQ treats
output made with a font as unrestricted.

## Considered, passed the gate, not used

| Source | Licence | Why not used |
|---|---|---|
| KiCad **newstroke** (`tools/newstroke/font.kicad_sym`) | CC0 (README: "Released under CC0 licence") | A technical sans drafted from Hershey Simplex metrics; adds little over `rowmans`. Only the `.kicad_sym` source is CC0: `common/newstroke_font.cpp` is GPL-2.0-or-later, so never use that file |
| Other EMS fonts (Brush, Capitol, DecorousScript, Invite, League, Qwandry, Society, Swiss, LittlePrincess, Osmotron, MistyNight, BirdSwashCaps, DelightSwashCaps, NixishItalic) | OFL 1.1 | Decorative scripts, hatched outlines or display faces; not how people print on a phone |
| Hershey `futural`, `cursive`, `greeks` | Hershey notice | Near-duplicates of `rowmans`/`scripts`, or not Latin |
| TwinSans (Keith Packard) | OFL, derived from Hershey Sans | Adds little |
| Mistral SingleLine (isdaT) | OFL 1.1 | Revival of Roger Excoffon's 1953 Mistral; provenance risk not worth taking |
| Quick, Draw! | CC BY 4.0 | Doodles of 345 objects, no letters |

## Rejected by the gate

| Source | Licence / terms | Verdict |
|---|---|---|
| **IAM-OnDB** and derivatives (incl. deepwriting) | Research-only; deepwriting is also CC BY-NC-SA 4.0 | **No**, excluded by the brief |
| **EMNIST** / NIST Special Database 19 | NIST Standard Reference Data copyright ("Copyright protection on this compilation of data has been secured by the Secretary of the U.S. Department of Commerce"); no licence on the SD19 or EMNIST pages | **No (unclear)**. Also offline bitmaps only, so no strokes or scalar features |
| **UNIPEN** | Zenodo says CC BY 4.0, but the terms inside the data say "IT IS NOT ALLOWED TO DISTRIBUTE THIS DATA FOR COMMERCIAL PURPOSES" | **No (contradictory)**. Written confirmation from the International Unipen Foundation could change this |
| **BRUSH** (Brown, Kotani et al. 2020) | "may only be used for non-commercial research purposes" | **No**. MIT lets anyone reuse the weights commercially. A pity: it has per-character segmentation of written words |
| **IRONOFF** | No public licence or download found | **No (unclear)** |
| **IBM_UB_1** | No licence on the Buffalo CUBS page | **No (unclear)** |
| Google **MathWriting** | CC BY-NC-SA 4.0 | **No** |
| **CASIA-OLHWDB** | Signed agreement, no commercial use; Chinese | **No** |
| LibreCAD `.lff` fonts | Mixed; many GPL-2.0-or-later | **No** |
| 1CamBam Stick fonts | No licence anywhere | **No (unclear)** |
| EMS **Elfin** | The file notes Google lists the upstream as Apache-2.0, contradicting its OFL claim | **No (contradictory)** |
| EMS **SpaceRocks** | Claims OFL over Atari's Asteroids design; capitals only | **No** |

## Derived data that is committed

- `packages/pipeline/test/fixtures/parity.json`: stroke groups for the parity tests.
- `tools/bench/words.js`: words for the bench page.

Both hold synthetic words built from the held-out **UJI** (CC BY 4.0, attributed above) and
**Omniglot** (MIT) writers only, never from the OFL fonts. Redistributing font-derived
outlines outside the OFL is exactly what the OFL restricts.

## Real writers (phase 2)

Sessions recorded with `tools/collect/index.html` go in `data/real/` (git-ignored). The
consent wording and whether volunteers' handwriting may be published need the owner's
decision (docs/letter-model.md §8). Until then, no real sessions are committed and the
weights are trained on the sources above only.
