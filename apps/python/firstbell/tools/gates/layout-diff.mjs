/**
 * Find every element whose box changes when the webfonts arrive.
 *
 *   node layout-diff.mjs
 *
 * The hero was not the only place a `ch` measure let the font decide the layout, it was
 * just the biggest. Fixing these one at a time, guided by whatever the layout-shift
 * observer happened to blame on a given run, is slow and leaves the rest in place.
 *
 * This renders the page twice, once with Typekit blocked and once allowed, walks the DOM
 * in document order (identical in both states, since no script adds nodes) and reports
 * every element whose width or height differs. Height differences are the ones that cost
 * layout shift; width differences on their own are usually harmless, so they are listed
 * separately rather than mixed in.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import puppeteer from "puppeteer-core";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "out");
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
    const gz = gzipSync(await readFile(file));
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

async function snapshot(blockFonts) {
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
  await page.evaluate(() => document.fonts.ready);
  const out = await page.evaluate(() => {
    const describe = (el) => {
      const id = el.id ? `#${el.id}` : "";
      const cls = typeof el.className === "string" && el.className.trim()
        ? `.${el.className.trim().split(/\s+/).slice(0, 3).join(".")}` : "";
      return `${el.tagName.toLowerCase()}${id}${cls}`;
    };
    return [...document.querySelectorAll("body *")].map((el) => {
      const b = el.getBoundingClientRect();
      return {
        sel: describe(el),
        w: Math.round(b.width),
        h: Math.round(b.height),
        mw: getComputedStyle(el).maxWidth,
      };
    });
  });
  await page.close();
  return out;
}

const fallback = await snapshot(true);
const real = await snapshot(false);
await browser.close();
server.close();

if (fallback.length !== real.length) {
  console.error(`Node counts differ (${fallback.length} vs ${real.length}); `
    + "something scripts the DOM, so document order is not a stable key.");
  process.exit(2);
}

const heightDiffs = [];
const widthOnly = [];
for (let i = 0; i < fallback.length; i += 1) {
  const a = fallback[i];
  const b = real[i];
  const dh = a.h - b.h;
  const dw = a.w - b.w;
  if (dh !== 0) heightDiffs.push({ sel: a.sel, dh, fb: a.h, real: b.h, mw: a.mw });
  else if (dw !== 0) widthOnly.push({ sel: a.sel, dw, mw: a.mw });
}

// A parent's height difference is usually just its child's, reported again. Keep the
// deepest offenders by showing the smallest boxes first: those are the real causes.
heightDiffs.sort((x, y) => Math.abs(y.dh) - Math.abs(x.dh) || x.fb - y.fb);

console.log(`${fallback.length} elements compared.\n`);
console.log(`Height changes when the font arrives: ${heightDiffs.length}`);
for (const d of heightDiffs.slice(0, 25)) {
  console.log(`  ${String(d.dh > 0 ? `+${d.dh}` : d.dh).padStart(6)}px  `
    + `${d.sel.slice(0, 58).padEnd(58)} ${d.fb}->${d.real}  max-width: ${d.mw}`);
}
if (heightDiffs.length > 25) console.log(`  ... and ${heightDiffs.length - 25} more`);

console.log(`\nWidth-only changes (usually harmless): ${widthOnly.length}`);
const chSuspects = widthOnly.filter((d) => /ch$/.test(d.mw));
if (chSuspects.length) {
  console.log("  of which these have a ch-based max-width, so the font sets the measure:");
  for (const d of chSuspects.slice(0, 12)) {
    console.log(`    ${d.sel.slice(0, 52).padEnd(52)} ${d.dw > 0 ? "+" : ""}${d.dw}px  ${d.mw}`);
  }
}

console.log(heightDiffs.length === 0
  ? "\nNo element changes height. A font swap cannot move this layout."
  : `\n${heightDiffs.length} element(s) still let the font decide their height.`);
