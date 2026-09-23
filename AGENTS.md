# your-own-font

Draw two sentences, get a font of your own handwriting, download it. Free, no account,
no storage, everything in the browser. Open source (MIT).

Read `DECISIONS.md` before changing anything: it records what we chose, what we rejected,
and why. If a change contradicts a decision there, update the decision first.

`SPEC.md` is the build spec for the one page (Hero → Writing → Making → Done).
`design/identity.html` is the visual identity and `design/homepage-prototype.html` the
clickable prototype; open them in a browser. Where the spec and prototype disagree, the spec wins.
`docs/letter-model.md` specs the on-device letter model we train for stroke-to-letter matching.

Built 2026-09-22: the one-page app (`app/`, `src/`), the pipeline worker
(`packages/pipeline`) and the one server route (`app/api/profile`, iOS profiles). Stack:
Next.js 16 (App Router), TypeScript, Motion, one Web Worker running `perfect-freehand` +
`polygon-clipping` + `fit-curve` + `opentype.js` and the letter model. Agent calls made
while building are in `DECISIONS.md` → *Agent calls while building the app*.

| Command | What |
|---|---|
| `npm run dev` | The app (copies the model weights to `public/` first) |
| `npm run typecheck` | App + pipeline |
| `npm test` / `npm run test:pipeline` | App unit tests / pipeline tests (parity, font build) |
| `npm run build` | `next build` |
| `npm run e2e -- <url> [--fail]` | The whole flow in headless Chromium with real mouse input, at phone and desktop widths, reduced motion on and off; downloads and parses the `.otf`. Output in `.e2e/` |
| `npm run sentences` | Check the sentence pool against the coverage rule |

`?motion=reduce`, `?pair=N` and `?fail=build` are test hooks (see `DECISIONS.md`).
`tools/collect` and `tools/bench` are standalone pages; leave them alone.
