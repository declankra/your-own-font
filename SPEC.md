# Spec: the homepage

The whole product is one page. It moves through four states: **Hero → Writing → Making →
Done**. There are no other routes except the iOS profile-signing endpoint (see
`DECISIONS.md` → Download and install).

- Reference prototype: `design/homepage-prototype.html` (published:
  https://claude.ai/artifact/P8FxrvswJAa16wH2n5R7T2). When this spec and the prototype
  disagree, this spec wins.
- Writing → Making transition: `design/done-transition.html`, variant A "lift off the page"
  (owner, 2026-09-22). B and C in that file are rejected alternatives.
- Visual identity: `design/identity.html` (published:
  https://claude.ai/artifact/583uPtx6UzwXcGEqeXPeXA). Tokens are summarised in §2.
- Product and architecture decisions: `DECISIONS.md`. Read it first.

Built 2026-09-22 (agent): every section below is implemented; boxes are checked where
verified, with notes. Agent calls made while building are listed in `DECISIONS.md` →
*Agent calls while building the app*.

Status: approved by the owner on 2026-09-22, including these edits: the hero copy change,
the logo mark, the open-source link, icon actions on Done, and removing the file-name line.
Items marked **(agent call)** were decided by the agent, have not been ruled on by the
owner, and are easy to reverse.

---

## 1. The experience in one paragraph

A white screen says "Draw two sentences. Get a font for your own handwriting." The word
*handwriting* writes itself. You pick one of three inks, and that is the start button. Two
sentences appear. You write them one word at a time on ruled guides. Each letter of the
prompt fills with ink as you draw it, and each finished word flies up into the sentence in
your handwriting. When the last word lands, the page rests for a beat so you see both
sentences whole in your own hand. Then the page clears around them and, from a to z, each of
your letters lifts out of its word and flies down to be cast into type. There is no Done
button: finishing the last word is the start. The letters are set in a row, inked and
pressed, and the alphabet comes out printed in your hand. A short note writes itself back
to you, stroke by stroke. There are two things left to do: **Download** the font, or
**Share** the page so someone else can make theirs.

---

## 2. Identity (summary)

| Token | Value | Use |
|---|---|---|
| Paper | `#FFFEFB` | Page ground. The product is a white sheet |
| Sheet | `#FFFFFF` | Raised paper (the Done sheet, the file icon) |
| Tissue | `#F5F3EE` | Soft buttons, hover wells |
| Graphite | `#1F1E1C` | Text; also an ink |
| Muted | `#6F6A63` | Secondary text |
| Faint | `#D3CEC6` | Unwritten prompt letters and words |
| Rule blue | `#C9D6F7` | Writing guides |
| Ballpoint | `#2446F5` | Default ink, brand colour |
| Tomato | `#FF5B3A` | Ink; the press and the roller |
| Highlighter | `#FFE14D` | The word you're on. Nothing else |

- **Type:** Figtree (UI, 400–800) and DM Mono (small technical captions only). Handwriting
  is never faked with a script font. Every handwritten mark is drawn with
  `perfect-freehand`.
- **Radii:** paper 4–6px, buttons are pills, the logo tile is 23%.
- **Motion:** Motion springs only. `nib` {stiffness 520, damping 32, mass 1} for
  taps, fills and buttons. `paper` {140, 14, 1} for sheets and flying words. `press`
  {260, 30, 3} for the press only.
- **Theme:** light only, deliberately. The product is a sheet of paper. **(agent call)**
- **`--ink`:** the chosen ink is a CSS custom property on `:root`. The logo mark, the
  prompt fill, the pen, the written words, the printed alphabet, the note and the download
  badge all follow it.

### Top bar (every state)

- **Left:** the logo is a 28px ruled tile (white, blue baseline and dashed x-height)
  with a handwritten **a** in the current ink, followed by the wordmark "your own font"
  in Figtree 760. There is no dot.
- **Right, Hero only:** `free · open source`, where "open source" links to the GitHub repo
  and opens in a new tab. The repo URL is TBD (see §10).
- **Right, Writing:** the ink picker, then the word count `7 / 15`. There is no Done button
  (owner, 2026-09-22). The bar folds away with the rest of the page when Making starts.
- **Right, Making and Done:** empty.

---

## 3. State machine

```
Hero --pick ink--> Writing --15th word written--> Making --build ready + min 7s--> Done
                     ^                                 |
                     |                            build error
                     +-------- "Try again" <---- Making (error)
Done --tap a letter--> Rewrite-letter sheet --save--> Done (glyph re-printed)
```

- Transitions between states: the outgoing content rises 14px and fades (300ms), then the
  incoming content rises from 20px on the `paper` spring. Scroll resets to the top.
- **Except Writing → Making,** which is one screen (variant A, owner 2026-09-22; mock:
  `design/done-transition.html`). There is no fade and no scroll reset between them:
  1. **Trigger.** The word completion that brings the count to 15 starts it, with no tap.
     That includes rewriting a reopened word and the second **Next word** that keeps a stuck
     word as written. Arriving at a page that is already 15/15 (back through the logo) does
     not start it; see §5.5. **(agent call)**
  2. **Beat.** 1.2 s from that completion: the word's flight lands and both sentences rest,
     whole, in the person's ink. From the start of the beat, written words can't be reopened;
     the logo still goes home. **(agent call)**
  3. **Fold.** The top-bar tools, the prompt row, the guides and the footnote fade and drop
     10px (280ms). The sentences stay exactly where they are.
  4. **Making mounts** on the same screen with the same sentences at the same place. The
     heading and the sheet rise in below them, and the written words fade to Faint (1.4s).
  5. **Lift** (the Cast step, §7): a to z, each letter lifts out of its word in full ink and
     flies to its slot.
  6. **After z,** what's left of the sentences folds away (height and opacity, `paper`) and
     the row slides up into Making's usual place. Making carries on as built.
- **No persistence.** Strokes live in memory. Reloading the page returns to Hero. Once the
  first stroke exists, `beforeunload` asks for confirmation. **(agent call)**
- **No analytics.** Nothing about the session leaves the device. (Owner, 2026-09-22.)
- The in-page prototype controls (the dark bar at the bottom) are not part of the product.

---

## 4. State 1: Hero

**Layout** (left-aligned, lots of white space, content vertically centred):

1. Headline, Figtree 740, `clamp(40px, 6.6vw, 88px)`, tracking −0.042em:
   "Draw two sentences." / "Get a font for your own" / *handwriting*
2. The word *handwriting* is drawn stroke by stroke in the house hand on faint guides.
   It starts 350ms after load and takes about 1.5s. It is in Ballpoint until the pointer
   hovers or focuses an ink drop, then it recolours to that ink (350ms colour
   transition).
3. "Pick an ink to start" (muted), then three ink drops (64px, slightly irregular blob
   radius, inner highlight) labelled Ballpoint, Graphite and Tomato. Hover and focus:
   scale 1.1, rotate −6°, `nib` spring. Press: scale 0.9.

**Behaviour**

- Tapping a drop sets `--ink` and goes to Writing. There is no other call to action.
- On desktop, a small "nicer on your phone" QR code may sit bottom-right. It must not
  compete with the drops. **(agent call; carried over from `DECISIONS.md`)**

**Removed by the owner:** the "About a minute · nothing you draw leaves this device" footer.

**Acceptance**

- [x] The headline reads exactly "Draw two sentences. Get a font for your own handwriting."
      *The h1 carries that exact text as its accessible name; “handwriting” is the drawn word.*
- [x] *handwriting* finishes drawing within 2s of first paint. With reduced motion it
      appears fully drawn. *Measured 1.87 s after first paint (headless Chromium, 390 and 1280 px).*
- [x] Hovering or focusing each drop recolours *handwriting*. Tapping enters Writing with
      that ink.
- [ ] "open source" is a real link to the repo.
      *It is a real link, but to a placeholder URL (`REPO_URL` in `src/lib/config.ts`) until
      the owner picks the repo (§10.1).*

---

## 5. State 2: Writing

### 5.1 Layout (all devices: one word at a time **(agent call; replaces the tablet/desktop "whole sentence" decision)**)

1. **Sentences** (`clamp(20px, 2.7vw, 32px)`, Figtree 600): both sentences in Faint.
   The current word is Graphite on a highlighter swipe. Written words are replaced in
   place by the person's own ink at matching x-height (1 unit = 0.01em; the handwriting's
   x-height matches Figtree's).
2. **Prompt row:** the current word large (`clamp(48px, 7.4vw, 84px)`, Figtree 760) in
   Faint. Each letter fills with ink from the bottom up as it is drawn. The active letter
   has a short ink underline. On the right are **Undo** (icon) and **Next word**.
3. **Writing area:** no card and no border. It is the page itself, with four guides that
   fade out at both edges: ascender (40% opacity), x-height (dashed), baseline, descender
   (40%). x-height = `clamp(44px, 24% of area height, 72px)`, baseline at 64% of the
   height. The pen cursor is a 9px dot in the current ink.
4. A muted hint under the lines: "Write “bring” on the lines".
5. A footnote: "Tap a letter above to redo it. Tap a finished word to rewrite it."
   It folds away with the rest of the page when Making starts.

### 5.2 The pen

One felt-tip pen on `perfect-freehand`: size = 0.16 × x-height, thinning 0.6, smoothing
0.5, streamline 0.45. Real pressure comes from a stylus (`pointerType === "pen"`); mouse
and touch use simulated pressure. Collect `getCoalescedEvents()` samples and ignore moves
under 0.6px. `touch-action: none` on the area.

### 5.3 Feedback while writing

- **Letter fill:** fill = ink length ÷ (expected length × x-height). Expected length is
  per letter (a table, tuned against fixtures; for example i 1.5, l 2.0, o 3.1, m 4.8,
  period 0.15). Every stroke counts at least 0.12 × x-height, so a dot registers. Fill
  animates the clip over 120ms, linear. It must feel like zero latency.
- **Advancing to the next letter:** see §6 (segmentation). When a letter completes, it
  pops (scale 1.12 → 1 on `nib`).
- **Word completion:** after pen-up, if the last letter's fill is ≥ 0.5, wait 650ms and
  then complete the word. **Next word** and Enter complete it immediately. A new stroke
  cancels the wait.
- **Word flight:** on completion, the word's ink is normalised to font units and placed
  into the sentence. It animates from its position on the writing area to its place in
  the sentence (a FLIP transform on the `paper` spring). Then the next unwritten word
  loads, at once, so a quick writer never loses a first stroke to the flight. **(agent call)**

### 5.4 Fixing things (nothing is ever rejected)

- **Undo** removes the last stroke of the current word.
- **Tapping a prompt letter** clears that letter's strokes and makes it active.
- **Tapping a written word** in the sentence reopens it. Its glyphs are removed from the
  font data until it is rewritten.
- **Ink** can be changed at any time from the top bar. It recolours everything, because
  the font is one colour.

### 5.5 Completion

There is no Done button and no all-done message in the normal flow (owner, 2026-09-22).
Writing the 15th word starts the beat and then Making (§3).

**Coming back to a finished page** (the logo, then an ink) **(agent call):** the prompt and
tools stay hidden and the area shows "That's both sentences." / "Tap a word to rewrite it."
with one **Make my font** button. The button goes straight to the fold (no beat). Rewriting
a word instead brings the count back to 15, which starts the beat as usual.

### 5.6 Sentences

- Coverage rule (from `DECISIONS.md`): each pair together covers a–z at least once and
  `e t a o i n s r h l` at least twice. All lowercase, with punctuation limited to
  `. , ' ! ?`.
- **First pair (checked against the rule):** "quick, bring the jazz and warm pie." /
  "six lovely foxes nap by the old wharf."
- Pool: about 10 pairs, one picked at random per visit. They are generated by a
  set-cover script (`scripts/sentences.ts`), which must also assert the coverage rule in
  CI, and then hand-edited so they read like a friendly note.
- *As built* **(agent call)**: 10 pairs in `src/lib/sentences.ts`, each exactly 15 words and
  each with a comma (the font's apostrophe is made from the writer's comma when the pair has
  no `'`). `npm run sentences` checks the pool; `-- --suggest 8` runs the set-cover search.
  `test/sentences.test.ts` asserts the rule in CI. `?pair=N` picks a pair (for tests).

### 5.7 Acceptance

- [x] Fill responds within one frame of pointer movement on a mid-range phone.
      *The fill is set in the pointermove handler itself (same task, about 0.1 ms per move,
      measured in Chromium). Not measured on a physical phone: none was reachable.*
- [x] A finished word appears in the sentence in the person's own ink, at the same
      x-height as the surrounding type. *Sized in `ex`, so it matches Figtree's own x-height.*
- [x] Undo, redo-letter and rewrite-word all work and never block progress.
      *Also when nothing fits (§6.3): a second “Next word” keeps the word as written.*
- [ ] Writing the 15th word starts Making with no tap, after a 1.2 s beat, on phone and
      desktop, in all three inks, with reduced motion on and off. There is no Done button.
- [ ] Coming back to a finished page does not start Making; it offers a word to rewrite and
      **Make my font**.
- [x] Rotating the device or resizing the window clears only the in-progress word.

---

## 6. Matching writing to the word (letter segmentation)

The hard problem is not recognising letters, because we already know which letters are
being written. It is deciding **which strokes belong to which letter**. A mistake here
puts half an `m` into the `n` glyph. The owner decided on 2026-09-22 to solve it with a
small **on-device letter model that we train ourselves**, on top of cheap geometry. The
model only compares groupings of ink the person already drew. It never rejects ink and
never blocks progress. Training spec: `docs/letter-model.md`.

### 6.1 While the pen moves: geometry (drives the instant fill)

A new stroke goes to the current letter unless it starts to the right of that letter's
ink by more than a gap: 0.30 × x-height while the letter is under-filled, and 0.05 ×
x-height once it looks complete. This is the prototype's rule. It exists only to make the
fill feel instant (zero model latency).

### 6.2 After every pen-up: the model re-solves the word so far

On every pen-up, in the pipeline worker:

1. **Candidates.** Every stroke is a unit. A stroke that runs across two letters may be cut
   at a "valley": a column of the word that the stroke crosses once, and that few other
   strokes cross, near the baseline or the x-height. Units are sorted left to right by the
   centre of their ink, and a letter takes a run of up to 4 consecutive units. After the
   dynamic programming step, a dot or crossbar may move to a neighbouring letter if that
   lowers the cost. This handles i-dots and t-crossbars written at the end of the word, or
   drifting over the next letter. **(agent call, 2026-09-22.** It replaces clustering
   strokes that overlap by ≥ 30%, which glued a long t-crossbar to the letter after it and
   left the solver no way to split them.)
2. **Scoring.** The letter model scores each candidate group against the letter it
   would be, and against a "not one letter" class (half a letter, or two letters merged).
   Cost = −log P(letter) + geometry priors (width against the writer's own scale, stroke
   count, horizontal gaps).
3. **Dynamic programming** assigns the clusters to the word's letters in order, with the
   minimum total cost. The last, possibly unfinished, letter is scored leniently.
4. **Settle.** If the result moves strokes between letters, the prompt letters re-fill to
   match on the `nib` spring (200ms). What the person sees filled is what goes into the
   font.

Budget: the whole re-solve takes < 8ms p95 per pen-up on a mid-range phone (iPhone 12
or Pixel 6 class), so it lands before the next stroke starts. Scores for stroke groups
already seen in this word are reused, so a pen-up scores only the new groups: about 4 on
average, 11 at p95 (`packages/letter-model/MODEL_CARD.md`).

### 6.3 When nothing fits

If no grouping gives a letter a reasonable score (for example, two letters fully fused),
don't guess. That letter stays grey in the prompt with a one-line nudge ("Leave a little
space before the h"), and the word does not complete until it's resolved. This is
feedback, not rejection: the ink is never erased by the system. **(agent call):** pressing
**Next word** a second time keeps the word as written, with the model's best grouping, so
nothing ever blocks progress (`DECISIONS.md`: "Nothing blocks you").

### 6.4 Safety nets

- The printed alphabet on Done is the proof sheet. Tap any letter to rewrite just that
  letter (§8.4).
- For repeated letters, a variant the model scores far below the writer's other sample is
  dropped from the `calt` rotation. The other sample is still used.

### 6.5 Measuring it

- **Recorded sessions:** raw pointer events plus the known words, hand-labelled with
  which strokes make each letter. They come from at least 20 real writers across finger,
  stylus and mouse, including messy writers and writers whose letters touch. The format
  and the collection tool are defined in `docs/letter-model.md`.
- **Metric:** the percentage of letters whose stroke set exactly matches the labelled
  truth, with writers held out from training.
- **Launch bar:** ≥ 98% with the model, and it must beat geometry alone on the same set.
  CI reports both numbers on every change.

---

## 7. State 3: Making (about 7 seconds, driven by the real pipeline)

Heading: "Making your font". Below it, a DM Mono step caption.

| Step | What you see | Caption | Pipeline work it waits on (Web Worker) |
|---|---|---|---|
| Cast | 26 slots a–z, as Faint letters, below your sentences. In order, each letter lifts out of its word in full ink (`nib`), flies to its slot (`paper`, transform and opacity only), and 200ms after it lands the card flips (`paper`) to a mirrored metal sort. A new letter lifts about every 125ms. The letter that flies is the exact sample the font uses for that glyph (the model's best, not the first written). After z the sentences fold away and the row slides up | `casting letters · 12/26` | Per-glyph outline (`perfect-freehand`), union (`polygon-clipping`), smoothing (`fit-curve`). One event per glyph |
| Set | The row closes up (gap 12 → 4px) | `setting the row` | Metrics: sidebearings and advances |
| Ink | A tomato roller sweeps left to right. The sorts' faces take the ink colour as it passes | `inking` | `calt` variants from repeated letters |
| Press | The press head (tomato, screw rod, blue knobs) drops onto the row on the `press` spring, with a 3px thunk shake. The sorts flip back to printed paper glyphs (with a slight roughened letterpress edge), and the head lifts away | `pressing` | `opentype.js` build to a CFF `.otf` Blob |

- **Lift timing (agent call):** the first letter lifts 200ms after Making mounts (it was
  500ms before the sentences stayed on screen), so the flights overlap the old pauses and
  Making takes no longer. The row is set only once the last letter has landed.
- **Honest progress:** a step's animation can't finish before its pipeline work is done.
  If the work is slow, the step holds (for example, the next letter waits to be cast).
  If the work is fast, the animation still takes at least 7s in total on the first run.
- **Reduced motion:** no flights, flips, roller or press. Each letter fades out of its word
  as it fades into its slot, then the sentences fade out and Making goes straight to Done.
  **(agent call):** the fades are paced so the first run still takes ≥ 7s. Reduced motion
  is the system setting, or `?motion=reduce`.
- **Second run** (after Try again) **(agent call):** no 7s floor, and a **Skip** button. Skip
  lands every letter in the air at once.
- **Try again** has no sentences to lift from (they folded away), so the letters lift in
  where they are, as before this change. An error before z folds the sentences away too.
  **(agent call)**
- **Error:** if the worker throws, the press stops, the heading changes to "That didn't
  work", and the caption reads "Your writing is still here." One button, **Try again**,
  re-runs the pipeline.

**Acceptance**

- [x] Each cast letter appears only after the worker reports that glyph.
- [ ] Each letter flies from the ink of the sample the font uses, out of its own word, and
      the sentences don't move or cross-fade at the hand-off.
- [ ] Letters move with transform and opacity only: `nib` for the lift, `paper` for the
      flight. Making takes no longer than it did with the Done button.
- [x] The total is ≥ 7s on the first run and never shows a finished state before the Blob
      exists. *9.6 s full motion, 7.4 s reduced motion (end to end, production build).*
- [x] The reduced-motion and error states are implemented and reachable in tests.
      *`test/making.test.ts`, and `npm run e2e -- --fail` drives the error state in a browser
      (`?fail=build` makes the worker throw at the press).*

---

## 8. State 4: Done

### 8.1 Layout

1. Heading "Here’s your font." There is no caption line: the file-name, glyph-count and
   stand-in line was removed by the owner.
2. **The sheet** (white, the sheet shadow fades in around the printed row): a–z printed
   in the person's glyphs, 13 columns on desktop, 9 on tablet, 7 on phone.
3. **The note,** inside the sheet on faint baselines. It writes itself by replaying each
   glyph's real stroke order: "hello, it's me. well, it's you. this is your own hand, and
   it's all yours now." Repeated letters rotate through their variants. Lines wrap to the
   sheet width. It is about 5s at a natural pen speed.
4. **Two actions,** centred under the sheet, springing in after the note finishes. They
   are objects, not buttons:
   - **Download:** a small paper file icon (72×90px, folded corner) showing the person's
     own **a** in their ink with `.otf` beneath it, and a round ink badge with a down
     arrow. Caption "Download".
   - **Share:** a folded white paper plane with a dotted ink trail. Caption "Share". On
     tap, the plane flies off and loops back.
   - Hover and focus lift and tilt the object (−5px, −3°). Press scales it to 0.92. Both
     have accessible names ("Download your font", "Share this page with a friend").

### 8.2 Download, by device (see `DECISIONS.md` for details)

- **Desktop:** save `My Hand.otf`. A toast says "Double-click it to install."
- **iPhone/iPad:** tapping the file opens a small bottom sheet with two options. "Install
  on this iPhone" leads to the signed `.mobileconfig` walkthrough. "Save the file" goes to
  Files, with "AirDrop it to your Mac and double-click."
  - **Signing:** v1 ships the profile unsigned, so iOS shows "Not Signed". Once the app is
    built and the domain is chosen, the owner gets a free Let's Encrypt certificate for
    that domain (`certbot certonly --manual --preferred-challenges dns`). Vercel's own
    certificate can't be used because Vercel never exposes its private key. The
    certificate, key and chain are stored as base64 Vercel env vars (`SIGN_CERT`,
    `SIGN_KEY`, `SIGN_CHAIN`), and the route signs each profile in memory (S/MIME,
    DER). Nothing is stored. The certificates last 90 days, so the owner renews them and
    updates the env vars on a schedule. The route must build unsigned when the env vars
    are missing and signed when they are present, with no code change.
- **Android:** save the file.

### 8.3 Share

- Calls `navigator.share({ title: "your own font", text: "Draw two sentences, get a font of
  your handwriting.", url: <homepage> })`. The link is the homepage, never the font.
  Nothing is uploaded.
- Where Web Share isn't available (most desktops), copy the homepage URL and show the
  toast "Link copied".

### 8.4 Rewrite a letter

Tapping a printed letter opens a small sheet over the page with the guides and that single
letter as the prompt. **Save** rebuilds the font in the worker (no press animation), then
the tile re-prints with a small `nib` thunk and the note re-renders instantly. **(agent
call):** the rewritten letter replaces every sample of that letter, so it has no alternate.

### 8.5 Acceptance

- [x] No file name, glyph count or stand-in caption appears anywhere on Done.
- [x] The note replays the real stroke order and uses both variants of repeated letters.
      *By the same rule as the font's `calt`, checked with HarfBuzz.*
- [x] Download and Share are icon objects with captions. Both are keyboard reachable with
      visible focus.
- [x] Share never sends font data. The desktop fallback copies the link.

---

## 9. Cross-cutting

- **Accessibility:** everything except drawing works from the keyboard, with a visible
  focus ring in Ballpoint. The writing area is labelled, and the prompt letters are
  buttons ("Redo q"). The note has a text alternative. Drawing inherently needs a
  pointer; we say so rather than pretending otherwise.
- **Reduced motion:** springs jump to their end values, flights become fades, and Making
  becomes a fade-in (§7).
- **Performance:** Hero is interactive in under 1.5s on a mid-range phone. The worker
  bundle (`opentype.js` and friends) is loaded when an ink is picked, not before. Letter
  fill runs at 60fps with 15 words of ink on screen.
- **Stack:** as in `DECISIONS.md`. Next.js App Router, one page component with a state
  machine (`hero | writing | making | done`), a Web Worker pipeline package with its
  fixtures, and Motion for springs.

---

## 10. Open questions

1. **GitHub repo URL** for the "open source" link.
2. **Product name and domain.** "your own font" is still the working name.
3. **Real-writer data** for the letter model: the owner recruits at least 20 writers to
   use the collection tool (`docs/letter-model.md`).
4. ~~**iOS signing certificate.**~~ Done 2026-09-22: signed by `font.dkbuilds.co` via
   `scripts/signing-cert.sh` (see DECISIONS.md → iOS). Renew every ~60 days.

Settled by the owner on 2026-09-22:
- **No font name.** Nobody is asked for a name. The family is always "My Hand", and each
  build gets a unique PostScript name so two builds can be installed side by side.
- **No analytics.**
- **Capitals:** v1 builds uppercase from scaled lowercase, silently. "Add capitals" is not
  in v1.

## 11. Out of scope for v1

Photo input, cursive, accounts, storage, a gallery of fonts, printing or mailing, kerning
(GPOS), an iMessage app, dark mode, and a phone-to-desktop relay.
