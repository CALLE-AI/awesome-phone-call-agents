/* Click every in-page link the way a reader does, and report where the page comes to rest.
 *
 * Not a gate; run by hand after touching the scroll. The scroll-walk gate checks that an
 * anchor's target is reachable below the bar; this checks the tween that takes it there,
 * which is a different thing and the thing that reads as the page dragging when it is
 * wrong. Lenis only runs at 60rem and up and never under reduced motion, so the run is at
 * 1440 with motion on.
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
const BAR = 76;
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
await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: "networkidle0" });
await page.evaluate(() => document.fonts.ready).catch(() => {});
await new Promise((r) => setTimeout(r, 600));

const lenis = await page.evaluate(() => Boolean(window.Lenis));
const links = await page.$$eval("a[href^='#']", (els) => els
  .map((el) => ({ href: el.getAttribute("href"),
                  cls: (el.className || "").toString().trim().split(/\s+/).join(".") }))
  .filter((l) => l.href.length > 1));
const seen = new Set();
const rows = [];
for (const { href, cls } of links) {
  if (seen.has(href)) continue;
  seen.add(href);
  await page.evaluate(() => window.scrollTo(0, 4200));
  await new Promise((r) => setTimeout(r, 450));
  const before = await page.evaluate(() => window.scrollY);
  const clicked = await page.evaluate((h) => {
    const a = document.querySelector(`a[href="${h}"]`);
    if (!a) return false;
    // No scrollIntoView first. A native scroll while Lenis is running leaves Lenis's own
    // idea of the position stale, and the tween that follows starts from the wrong number:
    // measured, it landed two hundred pixels off and looked like a bug in the handler.
    a.click();
    return true;
  }, href);
  if (!clicked) continue;
  // Sample until the scroll stops moving, so what is recorded is where it came to rest.
  /* A fixed wait, not a settle detector.
   *
   * The detector this replaced watched for three equal samples and reported the tween as
   * finished the first time it plateaued. Headless Chrome schedules `requestAnimationFrame`
   * irregularly under software rasterisation, and a 0.38s tween there goes 3811, 2945,
   * 2945, 2945, 1066, 713 ... 713, 0: two plateaus longer than the quiet window, and the
   * probe read the second one as where the page came to rest, 713px from where it did.
   * Three anchors were reported as landing wrong on a page where all thirteen land right.
   *
   * The tween is 380ms and bounded, so a second and a half is the whole of it with room
   * for a stalled frame, and a fixed wait cannot mistake a stall for an arrival. */
  let y = 0;
  const ms = 1500;
  await new Promise((r) => setTimeout(r, ms));
  y = await page.evaluate(() => Math.round(window.scrollY));
  const top = await page.evaluate((h) => {
    const el = document.getElementById(h.slice(1));
    if (!el) return null;
    return Math.round(el.getBoundingClientRect().top);
  }, href);
  rows.push({ href, cls, before, rest: y, top, ms });
}
console.log(`Lenis present: ${lenis}`);
console.log(`${"link".padEnd(16)} ${"class".padEnd(20)} ${"rests at".padStart(9)} ${"target top".padStart(11)}  settled`);
for (const r of rows) {
  const note = r.href === "#act-00"
    ? (r.rest === 0 ? "  top of page" : `  NOT AT TOP (${r.rest})`)
    : (r.top !== null && r.top >= 0 && r.top <= BAR + 8 ? "  under the bar" : (r.top !== null && r.top > BAR + 8 ? "  clear of the bar" : "  above the fold"));
  console.log(`${r.href.padEnd(16)} ${r.cls.slice(0, 20).padEnd(20)} ${String(r.rest).padStart(9)} ${String(r.top).padStart(11)}  ${String(r.ms).padStart(4)}ms${note}`);
}
await browser.close();
server.close();
