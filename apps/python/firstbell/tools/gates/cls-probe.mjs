/* Every layout shift on one load, with what moved and by how far. The gate names the worst
 * mover; this names all of them with their before and after rects, which is what tells you
 * whether a shift is a thing resizing or a thing being pushed by something above it. */
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
const PATH = process.argv[3] || "/index.html";
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
await page.setViewport({ width: 1440, height: 900 });
await page.evaluateOnNewDocument(() => {
  window.__shifts = [];
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) {
      if (e.hadRecentInput) continue;
      window.__shifts.push({
        value: e.value, at: Math.round(e.startTime),
        sources: (e.sources || []).map((s) => ({
          node: s.node ? (s.node.tagName || "") + (s.node.className ? "." + String(s.node.className).split(" ").join(".") : "") : "?",
          from: s.previousRect && { x: Math.round(s.previousRect.x), y: Math.round(s.previousRect.y), w: Math.round(s.previousRect.width), h: Math.round(s.previousRect.height) },
          to: s.currentRect && { x: Math.round(s.currentRect.x), y: Math.round(s.currentRect.y), w: Math.round(s.currentRect.width), h: Math.round(s.currentRect.height) },
        })),
      });
    }
  }).observe({ type: "layout-shift", buffered: true });
});
await page.goto(`http://127.0.0.1:${port}${PATH}`, { waitUntil: "networkidle0" });
await page.evaluate(async () => {
  const wait = () => new Promise((r) => requestAnimationFrame(() => r()));
  for (let y = 0; y < document.body.scrollHeight; y += 200) { window.scrollTo(0, y); await wait(); await wait(); }
  window.scrollTo(0, document.body.scrollHeight); await wait();
});
const shifts = await page.evaluate(() => window.__shifts);
let total = 0;
for (const s of shifts) {
  total += s.value;
  console.log(`${s.value.toFixed(5)} at ${s.at}ms`);
  for (const src of s.sources) console.log(`    ${src.node}  ${JSON.stringify(src.from)} -> ${JSON.stringify(src.to)}`);
}
console.log(`total ${total.toFixed(5)}`);
await browser.close();
server.close();
