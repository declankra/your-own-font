// End-to-end check of tools/collect/index.html, opened from file:// as a writer would.
// Records the 18 words by replaying held-out synthetic handwriting through real pointer
// events on the pad, fixes one letter boundary with the mouse (removes the proposed cut,
// cuts again, drags the cut), saves, and validates the downloaded file.
//
//   tsx scripts/e2e-collect.ts <replay_all.json> <out-session.json>
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { chromium } from "playwright-core";
import { validateSession } from "../src/letter-model/validate.ts";

const [replayPath, outPath] = process.argv.slice(2);
const replay = JSON.parse(readFileSync(replayPath, "utf8"));
const page_ = pathToFileURL(fileURLToPath(new URL("../../../tools/collect/index.html", import.meta.url))).href;

const browser = await chromium.launch();
const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1024, height: 768 } });
const page = await ctx.newPage();
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(page_);
const lib = await page.textContent("#libstatus");
await page.check("#agree");
await page.click("#start");

// plain source string: tsx would otherwise inject helpers the page doesn't have
const DRAW = `(w) => {
  const pad = document.getElementById("pad");
  const r = pad.getBoundingClientRect();
  const xh = Math.max(44, Math.min(72, r.height * 0.24));
  const base = Math.round(r.height * 0.64);
  const k = xh / w.guides.xHeight;
  const x0 = Math.min(...w.strokes.flat().map((p) => p[0]));
  function fire(type, p) {
    pad.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, pointerType: "mouse", isPrimary: true,
      buttons: type === "pointerup" ? 0 : 1, clientX: r.left + 30 + (p[0] - x0) * k, clientY: r.top + base + (p[1] - w.guides.baseline) * k, pressure: 0.5 }));
  }
  for (const s of w.strokes) {
    fire("pointerdown", s[0]);
    for (const p of s.slice(1)) fire("pointermove", p);
    fire("pointerup", s[s.length - 1]);
  }
}`;
const draw = (w: unknown) => page.evaluate(`(${DRAW})(${JSON.stringify(w)})`);

const words = (await page.evaluate("window.__collect.WORDS")) as string[];
let fixed = "";
for (let i = 0; i < words.length; i++) {
  const w = replay.find((x: { text: string }) => x.text === words[i]);
  await draw(w);
  await page.click("#finish");
  // on the first word with a proposed cut: remove it, cut again with the mouse, drag the cut
  if (!fixed) {
    const circle = `(() => { const c = document.querySelector("#rsvg circle"); if (!c) return null;
      const b = c.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`;
    const state = "JSON.stringify(window.__collect.review.per.map((p) => [p.cuts, p.letters]))";
    const cut = (await page.evaluate(circle)) as { x: number; y: number } | null;
    if (cut) {
      const before = await page.evaluate(state);
      await page.mouse.click(cut.x, cut.y); // tap the cut: removes it
      const removed = await page.evaluate("window.__collect.review.per.reduce((a, p) => a + p.cuts.length, 0)");
      await page.click("#cut");
      await page.mouse.click(cut.x, cut.y); // cut again where it was
      await page.click("#cut");
      const c2 = (await page.evaluate(circle)) as { x: number; y: number };
      await page.mouse.move(c2.x, c2.y);
      await page.mouse.down();
      await page.mouse.move(c2.x + 8, c2.y - 2, { steps: 4 });
      await page.mouse.up();
      const after = await page.evaluate(state);
      fixed = `"${words[i]}": proposal ${before}; cut removed (cuts left ${removed}); re-cut and dragged: ${after}`;
    }
  }
  await page.click("#accept");
}
const [download] = await Promise.all([page.waitForEvent("download"), page.click("#save")]);
const file = await download.path();
const session = JSON.parse(readFileSync(file!, "utf8"));
writeFileSync(outPath, JSON.stringify(session));
const saved = await page.textContent("#saved");
await browser.close();

const schema = JSON.parse(readFileSync(new URL("../../letter-model/fixture.schema.json", import.meta.url), "utf8"));
const check = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
const schemaOk = check(session);
const structural = validateSession(session);
console.log(`lib: ${lib}`);
console.log(`fix: ${fixed}`);
console.log(`saved: ${saved} -> ${download.suggestedFilename()}`);
console.log(`schema: ${schemaOk ? "valid" : JSON.stringify(check.errors)}; structure: ${structural.length ? structural.join("; ") : "valid"}`);
console.log(`page errors: ${errors.length ? errors.join(" | ") : "none"}`);
process.exit(schemaOk && !structural.length && !errors.length ? 0 : 1);
