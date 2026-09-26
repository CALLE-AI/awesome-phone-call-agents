/* Every disclosure on the page, by act, open, measured against the column it sits in.
 *
 * Not a gate; the gates already cover the two things that can be measured globally --
 * contrast opens every fold before it measures, and the scroll walk opens every fold and
 * checks no two pieces of text overlap at every stop. What this adds is the per-disclosure
 * view: which act owns it, what its label says, how much air its content has inside the
 * card, and whether any of it reaches outside the box it is drawn in.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import puppeteer from "puppeteer-core";
import { listenSafely } from "./safe-port.mjs";
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png",
  ".mp3": "audio/mpeg", ".woff2": "font/woff2", ".ico": "image/x-icon", ".txt": "text/plain" };
const ROOT = resolve(process.argv[2] || "out");
const WIDTH = Number(process.argv[3] || 1440);
const CHROME = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"].find((p) => p && existsSync(p));
const server = createServer(async (req, res) => {
  const rel = decodeURIComponent(req.url.split("?")[0]);
  try {
    const body = await readFile(join(ROOT, rel === "/" ? "index.html" : rel));
    res.writeHead(200, { "content-type": MIME[extname(rel).toLowerCase()] || "application/octet-stream" }).end(body);
  } catch { res.writeHead(404).end("no"); }
});
const { port } = await listenSafely(server);
const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage();
await page.setViewport({ width: WIDTH, height: 1000 });
await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: "networkidle0" });
await page.evaluate(() => document.fonts.ready).catch(() => {});
await new Promise((r) => setTimeout(r, 600));

const rows = await page.evaluate(() => {
  const out = [];
  const folds = [...document.querySelectorAll("details")];
  for (const el of folds) {
    const summary = el.querySelector("summary");
    if (summary && !el.open) summary.click();
  }
  for (const el of folds) {
    const act = el.closest("section.act");
    const summary = el.querySelector("summary");
    const cs = getComputedStyle(el);
    const box = el.getBoundingClientRect();
    const column = (el.closest(".inner") || el.parentElement).getBoundingClientRect();
    // How far any descendant reaches outside this card's own padding box.
    const pad = { l: parseFloat(cs.paddingLeft), r: parseFloat(cs.paddingRight) };
    let overLeft = 0; let overRight = 0;
    /* Skip anything inside a box that clips, and anything out of flow.
     *
     * The mutation table is 573px wide in a 350px column on a phone and is meant to be:
     * it sits in a `.scrollbox` that scrolls sideways and is named as doing so. Measuring
     * its rect against the card reports 247px of spill for a table that is clipped and
     * reachable, which is a reading of the wrong box. */
    const clips = (node) => {
      for (let n = node.parentElement; n && n !== el; n = n.parentElement) {
        const s = getComputedStyle(n);
        if (s.overflowX !== "visible" || s.overflowY !== "visible") return true;
      }
      return false;
    };
    for (const kid of el.querySelectorAll("*")) {
      const k = kid.getBoundingClientRect();
      if (!k.width || !k.height) continue;
      const ks = getComputedStyle(kid);
      if (ks.position === "absolute" || ks.position === "fixed") continue;
      if (clips(kid)) continue;
      overLeft = Math.max(overLeft, (box.left + pad.l) - k.left);
      overRight = Math.max(overRight, k.right - (box.right - pad.r));
    }
    out.push({
      act: act ? act.id : (el.closest("footer") ? "footer" : "outside an act"),
      kind: el.className || "(no class)",
      label: (summary ? summary.textContent : "").trim().slice(0, 58),
      open: el.open,
      pad: `${cs.paddingTop} ${cs.paddingRight} ${cs.paddingBottom} ${cs.paddingLeft}`,
      radius: cs.borderTopLeftRadius,
      shadow: cs.boxShadow === "none" ? "none" : "yes",
      width: Math.round(box.width),
      column: Math.round(column.width),
      pastLeft: Math.round(overLeft),
      pastRight: Math.round(overRight),
    });
  }
  return out;
});

const byAct = new Map();
for (const r of rows) {
  if (!byAct.has(r.act)) byAct.set(r.act, []);
  byAct.get(r.act).push(r);
}
console.log(`${rows.length} disclosure(s) at ${WIDTH}px, all opened\n`);
for (const [act, list] of [...byAct.entries()].sort()) {
  console.log(`${act}  (${list.length})`);
  for (const r of list) {
    const spill = r.pastLeft > 1 || r.pastRight > 1
      ? `  SPILLS ${r.pastLeft}px left / ${r.pastRight}px right` : "";
    console.log(`    ${r.open ? "open " : "SHUT "} ${r.kind.padEnd(15)} pad ${r.pad.padEnd(32)} r${r.radius.padEnd(5)} shadow ${String(r.shadow).padEnd(4)} ${String(r.width).padStart(5)}px in ${String(r.column).padStart(5)}px  "${r.label}"${spill}`);
  }
}
const spilled = rows.filter((r) => r.pastLeft > 1 || r.pastRight > 1);
const shut = rows.filter((r) => !r.open);
console.log(`\n${shut.length} refused to open, ${spilled.length} spill past their own padding box`);
await browser.close();
server.close();
