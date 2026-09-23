# Decisions

Product and architecture decisions for the handwriting-font app, settled in a grilling
session on 2026-09-21/22. Each entry records what we chose, what we rejected, and why.
Change a decision here before changing the code that depends on it.

## What this is

A free, open-source (MIT) web toy. You draw two sentences on screen, it turns your
handwriting into a real font, and you download the `.otf`. No account, no storage, no
payments. It exists to be delightful and to show product taste and design craft — the
bar is "feels like Benji Taylor built it": friendly, intentional, simple, elegant.

## Decided

### Scope

| Decision | Chosen | Rejected | Why |
|---|---|---|---|
| Business model | Free toy, no payments, ever in v1 | Paid tiers; print-and-mail postcards via Lob/PostGrid | It's a craft piece, not a business. Mail was the only use case with real margins but needs payments and a print API. |
| Accounts | None | Login + Prisma | Nothing to persist. Prisma was in the original stack ask; it has no job without a database, so it's out. |
| Storage | None. Nothing leaves the browser except the optional iOS profile-signing call | Vercel Blob for fonts and letters | No letters, no shared links, so no blobs. Also removes the abuse/retention/moderation problem entirely. |
| "Where do I use the font?" | The download is the product. No built-in use case | Group cards, one-to-one 3D letters with envelope + share sheet, transparent PNG stickers, iMessage app | Every use case we found was either thin (letters, stickers), out of scope (iMessage needs a native app), or a different product (group cards). The moment of seeing your handwriting write back to you is the thing people share. |
| Input | Drawing on screen only | Photo of paper handwriting | Photo needed segmentation, bitmap tracing (potrace, GPL-only ports), lined-paper removal, blur/shadow checks, and a recognition model to catch misalignments. Drawing gives vector outlines and stroke order for free and cuts the pipeline to ~5% of the work. |
| Handwriting style | Print (unconnected letters) | Cursive | Connected cursive can't be cut into glyphs and needs joining rules a font built this way can't have. |
| Letter validation and matching | No rejection, ever. A small **on-device letter model that we train ourselves** (a tiny CNN, about 135 KB of fp16 weights (about 125 KB gzipped), run by our own TypeScript in the pipeline worker; as built 2026-09-22, see `packages/letter-model/MODEL_CARD.md`) scores candidate groupings of strokes so the right strokes land in the right letter. It only chooses between groupings of ink the person already drew; it never rejects ink or blocks progress. Decided by the owner 2026-09-22; training spec in `docs/letter-model.md` | (a) jev (TypeSafe AI System One); (b) a vision LLM or hosted model per stroke or word; (c) MyScript iink; (d) Chrome's Handwriting Recognition API; (e) `$P` template matching as a tie-break (superseded by the model); (f) pure geometry only | The owner wanted better matching than geometry alone. jev can't see ink. Hosted vision models take about a second per call, send the drawing off the device, and add a server and a bill. Chrome's API only ships on ChromeOS, so it misses iPhone Safari. iink is paid and cloud-based. Because the word is known, the model only has to compare candidate splits ("is this an r, or the start of an n?"), which is far easier than open recognition, and it runs in milliseconds on the phone. |
| LLMs in the font pipeline | None | Vision LLM for glyph extraction; LLM for "is this an a?" | Nothing in the path is a language problem. A free toy with a per-use API bill is a liability. |
| Devices | Phone and tablet first; desktop allowed (trackpad, mouse, drawing tablet) | Desktop-first; phone-only | Finger/stylus is the natural pen. Desktop shows a "nicer on your phone" QR alongside a working canvas. No phone-to-desktop relay (needs storage). |
| Licence | MIT | GPL | GPL was only forced by potrace, which left with the photo path. |

### The writing prompt

| Decision | Chosen | Rejected | Why |
|---|---|---|---|
| How much to write | Two sentences | One pangram; three lines (a–z / A–Z / digits+punct); tiered "write one line, get a font, keep going" | Two sentences is the owner's call: long enough to cover the alphabet with repeats, short enough to finish in about a minute. |
| Coverage rule | Each pair, together, must cover a–z at least once, and the ten most frequent letters (e t a o i n s r h l) at least twice. Picked programmatically from a word list by set-cover search, then hand-edited to read like a friendly note, not a typing drill | Random pangrams; "the quick brown fox" | Repeats let the font ship two variants of common letters (via `calt`) so repeated letters don't look stamped. Rejected pangrams read as drills. |
| Rotation | A pool of ~10 sentence pairs; each visit shows one pair at random | One fixed pair | Repeat visitors and people sharing screenshots shouldn't all see the same words. |
| Capitals, digits, punctuation | v1 font is lowercase plus whatever punctuation the pair contains (`. , ' ! ?`). Uppercase glyphs are generated from lowercase, scaled to cap height, silently: the owner cut all captions from the Done screen and kept it to two actions. The optional "Add capitals" step is not in v1 (owner, 2026-09-22) | Requiring a third line; leaving uppercase as .notdef boxes | Two sentences can only yield two real capitals. Blank boxes in a font menu feel broken; scaled lowercase is a known compromise. |

### The drawing experience

| Decision | Chosen | Rejected | Why |
|---|---|---|---|
| Layout | One word at a time on every device (changed 2026-09-22; was "tablet/desktop: a whole sentence at once"). The current word sits large in the prompt above; you write it on a baseline + x-height guide; finished words fly into the two sentences in your own ink | One letter per box (feels like a form; stiff letters); the full sentence on a scrolling canvas | Whole words keep spacing and rhythm natural; the guides give baseline and x-height for free; each finished word is a small completion. |
| Letter fill | The expected letter in the prompt fills with ink in proportion to stroke progress as the pen moves. Zero latency, no model. Pen-up ends the letter | Fill only on confirmation | This is the delight moment and it must be instant. |
| Which letter the strokes belong to | While the pen moves: the gap rule (a new stroke starting right of the current letter's ink by more than a threshold scaled to x-height advances the letter) drives the instant fill. After every pen-up: the letter model plus geometry priors re-solve the whole word so far (dynamic programming over the known letters, `SPEC.md` §6), and the prompt fill settles to match. Launch bar: at least 98% of letters matched correctly on recorded sessions from real writers | Auto-advance on pause; an explicit "next letter" button; geometry only | Geometry gives zero-latency feedback; the model fixes what geometry gets wrong (touching letters, late dots, crossbars) without the person doing anything. |
| Mistakes | Tap the letter in the prompt to clear its ink and rewrite it. Undo removes the last stroke. Nothing blocks you | Wobble-and-fade rejection; forced retry | There is no judge, so there is nothing to reject. Trust the writer, make fixing cheap. |
| Pen | One felt-tip pen built on `perfect-freehand`; real pressure from a stylus, simulated pressure otherwise; 2–3 ink colours | Pen picker; brush styles | One good pen. Choice here is noise. |

### The pipeline (all in-browser, in a Web Worker)

| Step | Library | Notes |
|---|---|---|
| Strokes → outline polygons | `perfect-freehand` (MIT) | One polygon per stroke, pressure-aware |
| Merge a letter's strokes | `polygon-clipping` (MIT) | Union overlapping strokes so a `t` is one contour |
| Smooth | `fit-curve` (MIT) or ~100 lines of our own Bézier fitting | Small glyphs that look like pen, not polylines |
| Metrics | Own code | Baseline and x-height from the guides; per-glyph sidebearings from ink bounds plus a tuned constant; advance widths derived, not kerned |
| Variants | Own code + `opentype.js` GSUB | Letters written twice become `calt` alternates that rotate so repeats don't look identical |
| Build | `opentype.js` (MIT) | Writes a CFF `.otf`. It cannot write GPOS kerning; we don't need it for handwriting. Family name is always "My Hand"; nobody is asked for a name (owner, 2026-09-22). Unique PostScript name per build; metadata states the maker owns it outright |
| Proof | The pressed sheet (see Animation) shows every glyph; tap any to rewrite it | No separate approval grid |

Rejected: server-side fontTools/Pyodide (10 MB+, unnecessary once kerning was ruled out); `imagetracerjs`/potrace (no bitmaps to trace); `fontkit`/`harfbuzzjs` (read/shape only, don't build).

### Animation and finale

| Decision | Chosen | Rejected | Why |
|---|---|---|---|
| Build animation | A printing-press/type-foundry sequence driven by the real pipeline stages, with the person's own letters as the actors: lifted off the page, cast into type, set in a row, inked, pressed. Minimum ~7 s so it lands; skippable on a second run; reduced-motion variant | Fixed showpiece decoupled from processing | It's the craft showcase. Real stages keep it honest and mean it never lies about progress. |
| Finale | The pressed sheet is a note written back to you in your own font, and it *writes itself* by replaying your real stroke order for each glyph | Faked write-on via skeleton mask (only needed for photo input) | Drawn input gives true stroke order, so the replay is genuine. |
| 3D | 2.5D: CSS 3D transforms, Motion springs, layered soft shadows, paper texture. Text stays real DOM text in the font | Three.js/WebGL | Crisp text, light, accessible, and closer to the restrained physicality of the reference work. WebGL only if one specific moment demands it. |

### Download and install

| Device | What happens |
|---|---|
| Desktop | One button downloads the `.otf`; a line says "double-click to install". Works in Figma, Keynote, Pages, Word, Photoshop |
| iPhone/iPad | Download saves to Files; the screen says "AirDrop it to your Mac and double-click". Below it, an "Install on this iPhone" walkthrough serves a signed `.mobileconfig` (font payload `com.apple.font`); the font is signed in flight by a Next.js route and not stored. The flow is ~6 taps through Settings and shows a verification label; we walk through every tap. Installed fonts appear in Pages, Keynote, Numbers, Goodnotes, Notability, Word, Procreate |
| Android | The file only; most apps import fonts directly |

Rejected: a "send to my computer" link (needs storage); Canva/Instagram as destinations (Canva needs Pro to upload fonts; Instagram has no custom fonts).

### Stack

Next.js (App Router) on Vercel, TypeScript, Motion for springs, a Web Worker for the
pipeline, `perfect-freehand` + `polygon-clipping` + `fit-curve` + `opentype.js`. The
font pipeline is its own package with a fixture set of recorded stroke sessions so glyph
quality is measurable, not vibes. Server code is exactly one route: iOS profile signing.

Rejected: Prisma (no database), Vercel Blob (no storage), a jev proxy route (no jev),
onnxruntime-web (the letter model is small enough to run with about 200 lines of our own TypeScript; ort-web's WASM runtime is several MB), OpenCV.js (no images).

### Visual identity and the page (approved 2026-09-22)

| Decision | Chosen | Why |
|---|---|---|
| Identity | Paper, three inks (Ballpoint `#2446F5`, Graphite `#1F1E1C`, Tomato `#FF5B3A`), Highlighter only for the word you're on, rule-blue guides. Figtree + DM Mono. Handwriting is only ever drawn, never a script font. Light only | The brand stays quiet so the person's hand is the loudest thing on screen. Reference: `design/identity.html` |
| Logo | A ruled tile with a handwritten letter in the current ink, next to the wordmark "your own font" | The mark is a letter someone wrote |
| Motion | Three Motion springs: nib {520, 32, 1}, paper {140, 14, 1}, press {260, 30, 3} | Things have weight; nothing eases in from nowhere |
| The press | A toy screw press: tomato body, graphite screw, two ballpoint knobs | Desk toy, not museum piece |
| Page | One page, four states: Hero → Writing → Making → Done. Picking an ink is the start button. Done has exactly two actions, shown as objects (a font file, a paper plane), not buttons | Owner's flow. Full detail in `SPEC.md`; prototype in `design/homepage-prototype.html` |
| Sharing | Share sends the homepage link (Web Share, copy-link fallback). Never the font | Lets a friend make their own without adding storage |
| Analytics | None (owner, 2026-09-22) | Nothing about a session leaves the device |

## Agent calls while building the app (2026-09-22)

Decided by the agent while building; not yet ruled on by the owner, and each is easy to
reverse. None of them contradicts a decision above.

| Area | Call | Why |
|---|---|---|
| Stack | Next.js 16.3 (App Router, Turbopack), React 19, Motion 13. The app uses `packages/pipeline` as a `file:` dependency (`transpilePackages`); the package keeps its own lockfile and tests | The package stays standalone, as built, and its tests keep running on their own |
| Worker | The whole pipeline (model, segmenter, font build) runs in one Web Worker started when an ink is picked. opentype.js and the model code are only in the worker's chunk | SPEC §9: nothing heavy before an ink is picked |
| Model file | `public/letter-model.bin`, copied from `packages/letter-model/` by `predev`/`prebuild` (gitignored), fetched by the worker from the page's own origin | One source of truth for the weights; no second server route |
| Privacy | A Content-Security-Policy limits the page to its own origin (`connect-src`, `form-action`, fonts). next/font self-hosts Figtree and DM Mono | "Nothing leaves the device" is enforced, not just intended |
| Sentence pool | 9 new pairs hand-written against the rule; every pair is exactly 15 words and has a comma | A constant `n / 15`; the comma feeds the apostrophe |
| Apostrophe | If the pair has no `'`, the font's `'` (and `’`) is the writer's own comma, raised to the ascender | The note says "it's"; the glyph is still their ink, never a stand-in |
| Logo is home | Past Hero, the logo is a button back to Hero. The writing stays in memory, so picking an ink returns to it with every word kept; a build in progress is dropped and runs again on Done | Lets people get back without a reload, and nothing they wrote is lost |
| Variants | At most two forms per letter: the model's best-scored sample is the default, the next is the `calt` alternate, unless it scores more than 3 nats (about 20×) below | SPEC §6.4 made concrete |
| `calt` rule | A letter takes its alternate whenever the glyph before it is a default lowercase letter (GSUB chaining context, format 3). The note on Done uses the same rule | Repeats never look stamped (`ll` → `l l.alt`); checked with HarfBuzz |
| Capitals | The default lowercase strokes (not outlines) are scaled so the centre line reaches 660 units (≈ 700 with the pen), clamped 0.7–1.6×, then drawn with the same pen | Stroke weight matches the lowercase |
| Metrics | 1000 units per em, x-height 500 (Figtree's ratio), side bearing = half the writer's median gap between letters (22–110 units), space 300, ascender ≥ 900, descender ≤ −300, fsType 0 (installable) | "Spaced by eye": their own spacing |
| Smoothing | fit-curve at ±3 units, split at corners over 55°; a fitted curve that strays more than 4 units outside its points is refitted in halves, else kept as straight segments | Found a real spike on `m` (the retraced stem) in the built font; now covered by a test |
| Union | If polygon-clipping throws, that stroke's outline stays a separate contour | CFF fills overlaps with the non-zero rule, so the glyph looks the same |
| Nothing fits (§6.3) | Nudge "Leave a little space before the h"; a second **Next word** keeps the word as written | Never blocks progress |
| Next word | The next word opens the moment a word completes, while its ink is still flying | A fast writer lost strokes in the prototype's 260 ms gap |
| Written words | Sized in CSS `ex`, so their x-height is Figtree's actual x-height | SPEC §5.1 "at matching x-height" without a measured constant |
| Done sheet | The printed alphabet is real text set in the built font (loaded with `FontFace`); the outline is the fallback. The logo's "a" becomes the person's own | Proves the font works; identity: "the site starts using it" |
| Rewrite a letter | The rewritten letter replaces every sample of it (no alternate) | Simple and predictable |
| Reduced motion | System setting or `?motion=reduce`; Making's fades are paced to the same 7 s | Testable without changing system settings |
| Retry | After an error, **Try again** runs without the 7 s floor and shows **Skip** | "Skippable on a second run" |
| Test hooks | `?pair=N` picks a pair; `?fail=build` makes the worker throw at the press | Lets the e2e reach every state |
| iOS | Detected by user agent (iPadOS by touch points). The profile is a form POST, so Safari shows its own profile prompt; `beforeunload` is suppressed for that one post. Unsigned until `SIGN_CERT`/`SIGN_KEY`/`SIGN_CHAIN` exist; signing is implemented and verified with a test certificate | SPEC §8.2 |
| Small phones | At ≤ 400 px the wordmark hides in the Writing bar only (inks, count and Done need the room) | The logo tile stays; every other state shows the wordmark |
| House hand | `!` and `?` were added in the house style, only for synthetic writing in tests | Some pairs use them |
| Licence file | `LICENSE` (MIT) added at the root | DECISIONS: MIT |
| Link previews | `app/opengraph-image.tsx` renders the hero (logo, headline, "handwriting" in the house hand) as a 1200×630 card; `icon.tsx` and `apple-icon.tsx` render the logo tile. All three are prerendered at build. Figtree Bold ships as a static TTF in `src/og/` (OFL) because next/og can't read the variable woff2. `og:image` always points at the production host | A shared link showed a bare title and Safari's compass in iMessage. Preview deployments sit behind Vercel's login, so unfurlers couldn't fetch an image from them |

## Open

- **Name and domain.** "your own font" is a working name.
- **GitHub repo URL** for the "open source" link.
- **The sentence pool.** The coverage rule is decided and the first pair is the owner's.
  The agent wrote nine more (`src/lib/sentences.ts`, all checked by the rule); they await
  the owner's read for tone.
- **Letter model training.** Decided (on-device model, see above); the training work is
  handed off. Spec: `docs/letter-model.md`. Real-writer data collection needs the owner to
  recruit writers.

## Research the decisions rest on (2026-09-21)

- `opentype.js` 2.0 writes GSUB (incl. `calt`) but not GPOS/kern.
- Every browser potrace port is GPL-2.0; `imagetracerjs` is permissive but stale and rough.
- iOS installs fonts from a `.mobileconfig` (`com.apple.font`, one font per payload, keyed by
  PostScript name); unsigned profiles show a red "Not Signed" label; server-side S/MIME
  signing with a public TLS cert yields "Verified"; Stolen Device Protection can block installs.
- jev (TypeSafe AI System One, Sep 2026) is a text-only decision API, ~300 ms–1 s per call;
  cannot accept images or strokes.
- Web Share API: URLs and files on iOS Safari and Android Chrome; not on desktop Firefox.
  Used for the homepage link only, with a copy-link fallback.
- Closest competitors: HandFonted (free, no signup, photo of separate characters, server-side),
  Lipi.ai and Mixfont (generative, need accounts), Calligraphr (template + registration).
  None takes a known drawn sentence, runs client-side, or installs to iOS.
