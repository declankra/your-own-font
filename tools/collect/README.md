# Handwriting collection tool

`index.html` together with `lib.js` (the letter model and segmenter, built by
`npm run build:tools` in `packages/pipeline`).

A writer writes 18 words: both sentences of the first pair, plus `it's`, `wow!` and `why?`. The
tool uses the product's pen, guides and one-word-at-a-time flow, and records raw pointer
events. After each word it shows the letters the model proposes, and the writer fixes any
that are wrong:

- tap a letter, then tap its strokes;
- turn on **Cut** and tap a stroke to split it;
- drag a cut to move it; tap it to remove it.

At the end, **Save** downloads one JSON file. Nothing is uploaded.

**Before you hand it out,** approve or change the consent line on the first screen
(docs/letter-model.md §8). The current text is: "Your handwriting will be used to train an
open-source model and may be published with it."

## Getting it to writers

- **Laptop or desktop:** send the folder, or just the two files. Double-clicking `index.html`
  works in Chrome, Safari, Firefox and Edge.
- **Phone or tablet** (most writers should use their finger or a stylus): a phone can't open a
  local HTML file together with its script, so the page has to be served.
  - *Same Wi-Fi:* run `python3 -m http.server 8000` in the repo root, then open
    `http://<your-laptop's-IP>:8000/tools/collect/` on the phone.
  - *Anywhere:* put the two files on any static host (GitHub Pages, a Vercel static
    deployment). The page makes no network requests except loading the Figtree web font.

On iPhone, **Save** puts the file in Files → Downloads. Writers can AirDrop or email it to you.

## When files come back

Put each file in `packages/letter-model/data/real/` (git-ignored). Then check them:

```bash
cd packages/pipeline && npm run validate -- ../letter-model/data/real/*.json
```

Each word also records the model's `proposal`, so we can measure how often writers change it,
and whether labels lean toward what the model suggested.
