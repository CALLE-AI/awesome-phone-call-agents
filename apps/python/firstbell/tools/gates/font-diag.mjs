/**
 * Measure the hero headline in both font states, and sweep candidate measures.
 *
 *   node font-diag.mjs
 *
 * Why. The page's layout shift comes from one thing: `max-width` on the hero h1 was set
 * in `ch`, and `ch` is the advance width of a zero in whatever face is currently
 * rendering. The fallback's zero is wider, so the measure came out 833.68px in the
 * fallback against 760.32px in the real face, the headline wrapped to three lines instead
 * of two, and the block changed height by exactly one line box.
 *
 * A measure expressed in `em` of the headline's own font-size scales with the type the way
 * `ch` did, without depending on any glyph's width. This sweeps candidates to find the
 * narrowest one where both states wrap to the same number of lines, because a wrap that
 * cannot change is a height that cannot change.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import puppeteer from "puppeteer-core";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "out");
const CANDIDATES = ["16ch", "7.04em", "7.4em", "7.8em", "8.2em", "8.6em", "9em", "9.4em"];
const CHROME = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
].find((p) => existsSync(p));

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
};

const server = createServer(async (req, res) => {
  const file = join(OUT, req.url === "/" ? "index.html"
    : decodeURIComponent(req.url.split("?")[0]));
  try {
    const body = await readFile(file);
    const gz = gzipSync(body);
    res.writeHead(200, {
      "content-type": MIME[extname(file)] || "application/octet-stream",
      "content-encoding": "gzip",
      "content-length": gz.length,
      "cache-control": "no-store",
    }).end(gz);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}/index.html`;
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true, args: ["--no-sandbox"],
});

async function measure(blockFonts, maxWidth) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  if (blockFonts) {
    await page.setRequestInterception(true);
    page.on("request", (r) => {
      if (/typekit/.test(r.url())) r.abort().catch(() => {});
      else r.continue().catch(() => {});
    });
  }
  await page.goto(url, { waitUntil: "networkidle0" });
  if (maxWidth) {
    await page.addStyleTag({ content: `#act-00 h1{max-width:${maxWidth} !important}` });
  }
  await page.evaluate(() => document.fonts.ready);
  const out = await page.evaluate(() => {
    const h1 = document.querySelector("#act-00 h1");
    const inner = document.querySelector("#act-00 .inner");
    const lh = parseFloat(getComputedStyle(h1).lineHeight);
    const box = h1.getBoundingClientRect();
    return {
      lines: Math.round(box.height / lh),
      h1: Math.round(box.height),
      width: Math.round(box.width),
      inner: Math.round(inner.getBoundingClientRect().height),
    };
  });
  await page.close();
  return out;
}

console.log("Current rule, for the record:");
for (const blocked of [true, false]) {
  const m = await measure(blocked, null);
  console.log(`  ${blocked ? "fallback" : "real font"}: ${m.lines} lines, `
    + `h1 ${m.h1}px, measure ${m.width}px, inner ${m.inner}px`);
}

console.log("\nSweep. A candidate only works if both states agree on lines AND height:");
const winners = [];
for (const candidate of CANDIDATES) {
  const fb = await measure(true, candidate);
  const real = await measure(false, candidate);
  const same = fb.lines === real.lines && fb.h1 === real.h1;
  if (same) winners.push({ candidate, lines: fb.lines, h1: fb.h1 });
  console.log(`  ${candidate.padEnd(8)} fallback ${fb.lines}L/${fb.h1}px   `
    + `real ${real.lines}L/${real.h1}px   ${same ? "MATCH" : "differs by "
      + Math.abs(fb.h1 - real.h1) + "px"}`);
}

console.log(winners.length
  ? `\nNarrowest measure where the wrap cannot change: ${winners[0].candidate} `
    + `(${winners[0].lines} lines, ${winners[0].h1}px)`
  : "\nNo candidate made both states agree. The height must be reserved instead.");

await browser.close();
server.close();
