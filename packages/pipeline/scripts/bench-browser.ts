// Run tools/bench/index.html headless and save the results.
//
//   tsx scripts/bench-browser.ts <out.json> [--throttle 4]
//
// Chromium runs twice: unthrottled and with DevTools CPU throttling (default 4x, the stand-in
// for an iPhone 12 / Pixel 6 class phone). WebKit (Safari's engine) runs unthrottled; it has
// no CPU throttling. Uses the Playwright browsers already installed on this machine.
import { writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium, webkit, type Browser } from "playwright-core";

const out = process.argv[2];
const ti = process.argv.indexOf("--throttle");
const throttle = ti > 0 ? Number(process.argv[ti + 1]) : 4;
const page = pathToFileURL(fileURLToPath(new URL("../../../tools/bench/index.html", import.meta.url))).href + "?auto=1";

async function run(b: Browser, rate: number) {
  const p = await b.newPage();
  if (rate > 1) {
    const cdp = await p.context().newCDPSession(p);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate });
  }
  await p.goto(page);
  await p.waitForFunction(() => (window as unknown as { benchResult?: unknown }).benchResult, null, { timeout: 600_000 });
  const r = await p.evaluate(() => (window as unknown as { benchResult: unknown }).benchResult);
  await p.close();
  return r;
}
const results: Record<string, unknown> = {};
const c = await chromium.launch();
results.chromium = await run(c, 1);
results[`chromium_${throttle}x`] = await run(c, throttle);
await c.close();
try {
  const w = await webkit.launch();
  results.webkit = await run(w, 1);
  await w.close();
} catch (e) {
  results.webkit = { error: String(e).slice(0, 200) };
}
writeFileSync(out, JSON.stringify(results, null, 1));
for (const [k, v] of Object.entries(results)) {
  const r = v as Record<string, { p50: number; p95: number }>;
  if (!r.perCandidateMs) {
    console.log(k, v);
    continue;
  }
  console.log(
    `${k.padEnd(12)} per candidate p50 ${r.perCandidateMs.p50.toFixed(3)} p95 ${r.perCandidateMs.p95.toFixed(3)} ms | ` +
      `pen-up re-solve p50 ${r.penUpResolveMs.p50.toFixed(2)} p95 ${r.penUpResolveMs.p95.toFixed(2)} ms | ` +
      `cold re-solve p50 ${r.coldResolveMs.p50.toFixed(2)} p95 ${r.coldResolveMs.p95.toFixed(2)} ms`,
  );
}
