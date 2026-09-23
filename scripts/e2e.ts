// The whole flow in a real browser, driven by real mouse input:
// Hero → pick an ink → write all 15 words in the house hand (some letters touching, i-dots and
// t-crossbars added at the end of the word) → the 15th word starts Making by itself (a beat,
// then each letter lifts out of its word to its slot) → Done → download the .otf, parse it,
// check a–z. Runs at phone and desktop widths, with reduced motion on and off, and fails on any
// console error. The desktop run also comes back to the finished page through the logo.
//
//   npm run e2e -- [baseUrl] [--only desktop|phone] [--fail]
//
// Screenshots and the downloaded fonts go to .e2e/.
import { mkdirSync, readFileSync } from "node:fs";
import { parse } from "opentype.js";
import { chromium, type Page } from "playwright-core";
import { HOUSE, synthWord } from "../packages/pipeline/src/house-hand.ts";
import { POOL } from "../src/lib/sentences.ts";

const args = process.argv.slice(2);
const base = args.find((a) => a.startsWith("http")) ?? "http://localhost:3137";
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
const out = new URL("../.e2e/", import.meta.url).pathname;
mkdirSync(out, { recursive: true });

interface Run {
  name: string;
  viewport: { width: number; height: number };
  reduced: boolean;
  pair: number;
  fail?: boolean;
}

const runs: Run[] = [
  { name: "desktop", viewport: { width: 1280, height: 860 }, reduced: false, pair: 1 },
  { name: "phone", viewport: { width: 375, height: 812 }, reduced: false, pair: 2 },
  { name: "desktop-reduced", viewport: { width: 1280, height: 860 }, reduced: true, pair: 3 },
  { name: "phone-reduced", viewport: { width: 375, height: 812 }, reduced: true, pair: 4 },
];
if (args.includes("--fail")) runs.push({ name: "error", viewport: { width: 1280, height: 860 }, reduced: false, pair: 1, fail: true });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function writeWord(page: Page, word: string, k: number) {
  const pad = (await page.locator(".pad").first().boundingBox())!;
  const xh = Math.max(44, Math.min(72, pad.height * 0.24));
  const baseY = Math.round(pad.height * 0.64);
  // some words spaced, some touching, some with the dots and crossbars added last
  const touching = k % 3 === 1;
  const late = k % 2 === 0;
  const w = synthWord(word, { gap: touching ? -3 : 6, lateMarks: late, jitter: 0.5, seed: 100 + k });
  const scale = Math.min(xh / 50, (pad.width - 40) / w.width);
  const X = (x: number) => pad.x + 16 + x * scale;
  const Y = (y: number) => pad.y + baseY + (y - 100) * scale;
  for (const s of w.strokes) {
    await page.mouse.move(X(s[0][0]), Y(s[0][1]));
    await page.mouse.down();
    for (let i = 1; i < s.length; i += 2) await page.mouse.move(X(s[i][0]), Y(s[i][1]));
    await page.mouse.move(X(s[s.length - 1][0]), Y(s[s.length - 1][1]));
    await page.mouse.up();
    await sleep(30);
  }
}

async function count(page: Page): Promise<number> {
  const t = (await page.locator(".count").textContent()) ?? "0";
  return Number(t.split("/")[0].trim());
}

async function run(r: Run) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: r.viewport,
    deviceScaleFactor: 2,
    reducedMotion: r.reduced ? "reduce" : "no-preference",
    acceptDownloads: true,
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" && !(r.fail && /font build failed/.test(m.text()))) errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(String(e)));
  const shot = (n: string) => page.screenshot({ path: `${out}${r.name}-${n}.png`, fullPage: false });
  const report: Record<string, unknown> = { run: r.name };

  await page.goto(`${base}/?pair=${r.pair}${r.fail ? "&fail=build" : ""}`, { waitUntil: "networkidle" });
  await sleep(2300);
  await shot("1-hero");
  const heading = await page.locator("h1").getAttribute("aria-label");
  if (heading !== "Draw two sentences. Get a font for your own handwriting.") throw new Error(`headline: ${heading}`);
  const drawn = await page.locator(".hw path").evaluateAll((ps) => ps.every((p) => !!p.getAttribute("d")));
  report.heroWordDrawn = drawn;

  await page.getByRole("button", { name: "Start writing in Ballpoint" }).click();
  await page.locator(".pad").waitFor();
  await sleep(900);
  const words = POOL[r.pair - 1].join(" ").split(/\s+/);
  const doneBtn = page.getByRole("button", { name: "Done", exact: true });
  if (await doneBtn.count()) throw new Error("there is a Done button");
  let nudges = 0;
  for (let k = 0; k < words.length; k++) {
    const before = await count(page);
    const prompt = (await page.locator(".prompt").getAttribute("aria-label"))!.replace("Word to write: ", "");
    await writeWord(page, prompt, k);
    // auto-completes 650 ms after pen-up when the last letter is filled; otherwise Next word
    const t0 = Date.now();
    while ((await count(page)) === before && Date.now() - t0 < 2500) await sleep(100);
    if ((await count(page)) === before) {
      await page.getByRole("button", { name: "Next word" }).click();
      await sleep(600);
      if ((await count(page)) === before && (await page.locator(".nudge").count())) {
        nudges++;
        await page.getByRole("button", { name: "Next word" }).click(); // second press keeps it
        await sleep(600);
      }
    }
    if ((await count(page)) !== before + 1) throw new Error(`word ${k} "${prompt}" did not complete`);
    if (k === 6) await shot("2-writing");
    if (k === words.length - 1) {
      await page.evaluate("window.__name ??= (f) => f"); // tsx names inner functions with a helper
      await page.evaluate(watchHandOff);
      break;
    }
    await sleep(350);
  }
  report.nudges = nudges;
  // the written words sit at the sentence's x-height
  report.sentenceWords = await page.locator(".w.written svg").count();

  // no tap: the 15th word starts a beat with both sentences whole, then the page folds
  await sleep(900);
  if (await page.locator(".leaving").count()) throw new Error("the page folded before the beat was over");
  await shot("2b-beat");
  await page.locator(".wbar.leaving").waitFor({ timeout: 5000 });
  await page.getByText("Making your font").waitFor({ timeout: 5000 });
  // (?fail=build throws before the first letter can lift: the error comes at once)
  if (r.reduced || r.fail) await sleep(r.fail ? 800 : 2600);
  else await page.waitForFunction(() => document.querySelectorAll(".flyer").length >= 3, null, { timeout: 8000 });
  await shot("3a-lift");
  await sleep(r.reduced ? 1000 : 1400);
  await shot("3-making");
  if (r.fail) {
    await page.getByText("That didn’t work").waitFor({ timeout: 20000 });
    await page.getByText("Your writing is still here.").waitFor();
    await shot("3b-error");
    await page.getByRole("button", { name: "Try again" }).click();
  }
  await page.getByText("Here’s your font.").waitFor({ timeout: 30000 });
  const hand = (await page.evaluate(() => (window as unknown as { __handoff: HandOff }).__handoff)) as HandOff;
  // timed in the page: from the fold (where the Done tap used to be) to "Here’s your font."
  report.makingMs = Math.round(hand.tDone - hand.tFold);
  report.fromLastWordMs = Math.round(hand.tDone - hand.t15);
  report.beatMs = Math.round(hand.tFold - hand.t15);
  report.handOff = { frames: hand.frames, maxShiftPx: +hand.maxShift.toFixed(2), minOpacity: hand.minOpacity, framesWithout: hand.missing };
  if (hand.maxShift > 0.5 || hand.missing || hand.minOpacity < 1) throw new Error(`the sentences moved at the hand-off: ${JSON.stringify(report.handOff)}`);
  report.flights = hand.flights.length;
  report.liftOffsetPx = +Math.max(0, ...hand.flights).toFixed(2);
  if (!r.reduced && !r.fail && hand.flights.length !== 26) throw new Error(`${hand.flights.length} flights, not 26`);
  if (report.liftOffsetPx as number > 2) throw new Error(`a letter lifted ${report.liftOffsetPx}px away from its ink`);
  await page.getByRole("button", { name: "Download your font" }).waitFor();
  await page.waitForFunction(() => getComputedStyle(document.querySelector(".actions")!).opacity === "1", null, { timeout: 20000 });
  await sleep(400);
  await shot("4-done");
  await page.screenshot({ path: `${out}${r.name}-4-done-full.png`, fullPage: true });

  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download your font" }).click()]);
  const file = `${out}${r.name}-${download.suggestedFilename()}`;
  await download.saveAs(file);
  report.fileName = download.suggestedFilename();
  const buf = readFileSync(file);
  const font = parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const missing = [..."abcdefghijklmnopqrstuvwxyz"].filter((c) => !font.hasChar(c) || font.charToGlyph(c).path.commands.length < 3);
  if (missing.length) throw new Error(`font lacks ${missing.join("")}`);
  report.glyphs = font.glyphs.length;
  report.family = font.getEnglishName("fontFamily");
  report.psName = font.getEnglishName("postScriptName");
  report.calt = (font.tables.gsub?.features ?? []).map((f: { tag: string }) => f.tag);
  const bb = (c: string) => font.charToGlyph(c).getBoundingBox();
  report.iDotted = bb("i").y2 > 620;
  report.tCrossed = bb("t").x2 - bb("t").x1 > 200;
  report.bytes = buf.length;
  // no glyph strays from its ink: x-height letters stay inside their band (catches smoothing spikes)
  const bad = [..."acemnorsuvwxz"].filter((c) => bb(c).y2 > 640 || bb(c).y1 < -140);
  if (bad.length) throw new Error(`glyphs out of band: ${bad.join("")}`);

  // share: the link, never the font
  await page.getByRole("button", { name: "Share this page with a friend" }).click();
  await sleep(500);
  report.toast = await page.locator(".toast").textContent();
  report.clipboard = await page.evaluate(() => navigator.clipboard.readText().catch(() => null));

  // keyboard: the actions are reachable
  report.focusable = await page.evaluate(() => {
    const b = [...document.querySelectorAll<HTMLButtonElement>(".actions .obj")];
    return b.every((x) => x.tabIndex >= 0);
  });

  // rewrite a letter from the sheet
  await page.getByRole("button", { name: "Rewrite o", exact: true }).click();
  await page.locator(".bsheet .pad").waitFor();
  await sleep(700);
  const sheetPad = (await page.locator(".bsheet .pad").boundingBox())!;
  const xh = Math.max(44, Math.min(72, sheetPad.height * 0.24));
  const by = Math.round(sheetPad.height * 0.64);
  const o = synthWord("o", { jitter: 0.8, seed: 5 });
  const sc = xh / 50;
  for (const s of o.strokes) {
    await page.mouse.move(sheetPad.x + 40 + s[0][0] * sc, sheetPad.y + by + (s[0][1] - 100) * sc);
    await page.mouse.down();
    for (const p of s) await page.mouse.move(sheetPad.x + 40 + p[0] * sc, sheetPad.y + by + (p[1] - 100) * sc);
    await page.mouse.up();
  }
  await page.getByRole("button", { name: "Save" }).click();
  await sleep(1500);
  report.rewriteClosed = (await page.locator(".bsheet").count()) === 0;
  await shot("5-rewritten");

  // back to the finished page through the logo: nothing starts until the person chooses
  if (r.name === "desktop") {
    await page.getByRole("button", { name: /home/i }).first().click();
    await page.getByRole("button", { name: "Start writing in Ballpoint" }).click();
    await page.getByRole("button", { name: "Make my font" }).waitFor();
    await sleep(2500);
    if ((await page.locator(".leaving").count()) || (await count(page)) !== words.length) throw new Error("coming back to a finished page started Making");
    await shot("6-back");
    await page.getByRole("button", { name: "Make my font" }).click();
    await page.getByText("Making your font").waitFor();
    report.backSkip = await page.getByRole("button", { name: "Skip" }).isVisible();
    await page.getByText("Here’s your font.").waitFor({ timeout: 30000 });
    report.back = "ok";
  }

  report.consoleErrors = errors;
  await browser.close();
  return report;
}

interface HandOff {
  frames: number;
  maxShift: number;
  minOpacity: number;
  missing: number;
  /** per flight: how far (px) the flyer's ink centre starts from the ink that left the word */
  flights: number[];
  /** in-page clock (ms): the 15th word is in the sentence, the page starts to fold, Done */
  t15: number;
  tFold: number;
  tDone: number;
}

/**
 * In the page, from the 15th word until the first letter lifts: every frame, where the
 * sentences are and how opaque; then, for each flyer, whether it starts on its own letter.
 */
function watchHandOff() {
  const w = window as unknown as { __handoff: HandOff };
  const h: HandOff = { frames: 0, maxShift: 0, minOpacity: 1, missing: 0, flights: [], t15: performance.now(), tFold: 0, tDone: 0 };
  w.__handoff = h;
  const first = document.querySelector(".sentences")!.getBoundingClientRect();
  const opacity = (el: Element | null) => {
    let o = 1;
    for (; el; el = el.parentElement) o *= Number(getComputedStyle(el).opacity);
    return o;
  };
  const frame = () => {
    if (document.querySelector(".flyer, .slot.lifted")) return;
    const el = document.querySelector(".sentences");
    h.frames++;
    if (!el) h.missing++;
    else {
      const r = el.getBoundingClientRect();
      h.maxShift = Math.max(h.maxShift, Math.abs(r.top - first.top), Math.abs(r.left - first.left), Math.abs(r.width - first.width));
      h.minOpacity = Math.min(h.minOpacity, +opacity(el).toFixed(3));
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  // a flyer and the ink that left its word appear in the same commit
  const fresh: Element[] = [];
  const centre = (r: DOMRect) => [r.left + r.width / 2, r.top + r.height / 2];
  new MutationObserver((ms) => {
    const now = performance.now();
    if (!h.tFold && document.querySelector(".wbar.leaving")) h.tFold = now;
    if (!h.tDone && document.querySelector("h2")?.textContent === "Here’s your font.") h.tDone = now;
    const flyers: Element[] = [];
    for (const m of ms) {
      if (m.type === "attributes" && (m.target as Element).classList.contains("gone")) fresh.push(m.target as Element);
      for (const n of m.addedNodes) {
        if (!(n instanceof Element)) continue;
        if (n.classList.contains("flyer")) flyers.push(n);
        if (n.matches("path.gone")) fresh.push(n);
      }
    }
    for (const f of flyers) {
      const ink = fresh.splice(0).map((p) => p.getBoundingClientRect());
      if (!ink.length) {
        h.flights.push(Infinity);
        continue;
      }
      const u = { l: Math.min(...ink.map((r) => r.left)), t: Math.min(...ink.map((r) => r.top)), r: Math.max(...ink.map((r) => r.right)), b: Math.max(...ink.map((r) => r.bottom)) };
      const [ax, ay] = [(u.l + u.r) / 2, (u.t + u.b) / 2];
      const [bx, by] = centre(f.getBoundingClientRect());
      h.flights.push(Math.hypot(ax - bx, ay - by));
    }
  }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["class"] });
}

async function main() {
  let failed = false;
  for (const r of runs) {
    if (only && !r.name.startsWith(only)) continue;
    try {
      const rep = await run(r);
      console.log(JSON.stringify(rep));
      if ((rep.consoleErrors as string[]).length) failed = true;
    } catch (e) {
      failed = true;
      console.error(`✗ ${r.name}:`, e);
    }
  }
  void HOUSE;
  process.exit(failed ? 1 : 0);
}
main();
