/* Which paragraphs on the page are running prose, and what justifying them would cost.
 *
 * Not a gate; the instrument behind the decision about `text-align`. Groups every `<p>` by
 * class, and reports how many lines it sets to, how wide its box is, whether it carries a
 * `<code>` token (which cannot be hyphenated and must not be broken, so it is the thing
 * that opens holes in a justified line), and the widest inter-word gap on any line as a
 * multiple of that paragraph's own narrowest gap.
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
await page.$$eval("details:not([open])", (els) => els.forEach((el) => {
  const s = el.querySelector("summary"); if (s) s.click();
}));
await new Promise((r) => setTimeout(r, 800));

const rows = await page.evaluate(() => {
  /* Word rectangles, by walking the text nodes with a Range. Grouped into lines by the
   * top of each rect, because a line box is the unit a justified gap belongs to. */
  const gaps = (p) => {
    const walk = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    const rects = [];
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      const text = n.nodeValue;
      let i = 0;
      while (i < text.length) {
        while (i < text.length && /\s/.test(text[i])) i += 1;
        const start = i;
        while (i < text.length && !/\s/.test(text[i])) i += 1;
        if (i > start) {
          const r = document.createRange();
          r.setStart(n, start); r.setEnd(n, i);
          for (const box of r.getClientRects()) if (box.width) rects.push(box);
        }
      }
    }
    const lines = new Map();
    for (const r of rects) {
      const key = Math.round(r.top);
      if (!lines.has(key)) lines.set(key, []);
      lines.get(key).push(r);
    }
    const all = [];
    for (const list of lines.values()) {
      list.sort((a, b) => a.left - b.left);
      for (let i = 1; i < list.length; i += 1) {
        const g = list[i].left - list[i - 1].right;
        if (g > 0.5) all.push(g);
      }
    }
    if (!all.length) return null;
    const min = Math.min(...all);
    return { lineCount: lines.size, widest: Math.max(...all), ratio: Math.max(...all) / min };
  };

  const byClass = new Map();
  for (const p of document.querySelectorAll("p")) {
    const box = p.getBoundingClientRect();
    if (!box.width || !box.height) continue;
    const g = gaps(p);
    if (!g) continue;
    const key = p.className.trim() || "(no class)";
    if (!byClass.has(key)) byClass.set(key, []);
    byClass.get(key).push({
      lines: g.lineCount, width: Math.round(box.width),
      code: p.querySelector("code, .mono") !== null,
      widest: g.widest, ratio: g.ratio,
      align: getComputedStyle(p).textAlign,
      text: p.textContent.replace(/\s+/g, " ").trim().slice(0, 70),
    });
  }
  const out = [];
  for (const [cls, list] of byClass) {
    out.push({
      cls,
      n: list.length,
      lines: Math.max(...list.map((x) => x.lines)),
      width: Math.max(...list.map((x) => x.width)),
      code: list.filter((x) => x.code).length,
      worstText: list.slice().sort((a, b) => b.ratio - a.ratio)[0].text,
      worstAlign: list.slice().sort((a, b) => b.ratio - a.ratio)[0].align,
      widest: Math.max(...list.map((x) => x.widest)),
      ratio: Math.max(...list.map((x) => x.ratio)),
      align: [...new Set(list.map((x) => x.align))].join("/"),
    });
  }
  return out.sort((a, b) => b.ratio - a.ratio);
});

console.log(`at ${WIDTH}px, every paragraph, folds open`);
console.log(`${"class".padEnd(20)} ${"n".padStart(3)} ${"maxlines".padStart(8)} ${"width".padStart(6)} ${"code".padStart(5)} ${"widest".padStart(7)} ${"ratio".padStart(6)}  align`);
for (const r of rows) {
  console.log(`${r.cls.slice(0, 20).padEnd(20)} ${String(r.n).padStart(3)} ${String(r.lines).padStart(8)} `
    + `${String(r.width).padStart(6)} ${String(r.code).padStart(5)} ${r.widest.toFixed(1).padStart(7)} ${r.ratio.toFixed(1).padStart(6)}  ${r.worstAlign}`);
  if (r.worstAlign === "justify" && r.ratio > 2.6) console.log(`      worst: "${r.worstText}"`);
}
const worst = await page.evaluate(() => {
  const out = [];
  for (const p of document.querySelectorAll("p")) {
    if (getComputedStyle(p).textAlign !== "justify") continue;
    out.push(p.textContent.replace(/\s+/g, " ").trim().slice(0, 74));
  }
  return out.length;
});
console.log(`
${worst} paragraph(s) are justified`);
const prose = rows.filter((r) => r.lines >= 3);
console.log(`\n${prose.length} class(es) set 3 lines or more (running prose); ${rows.length - prose.length} are one or two lines`);
console.log(`prose classes: ${prose.map((r) => r.cls).join(", ")}`);
await browser.close();
server.close();
