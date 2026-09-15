/* Photograph named elements of the built page, at a given width, for looking at.
 *
 * Not a gate; a way to see what the build actually draws without deploying it. Takes a
 * JSON list of [name, path, selector, width] and writes one PNG each.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, mkdirSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import puppeteer from "puppeteer-core";
import { listenSafely } from "./safe-port.mjs";
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png",
  ".mp3": "audio/mpeg", ".woff2": "font/woff2", ".ico": "image/x-icon", ".txt": "text/plain" };
const ROOT = resolve(process.argv[2] || "out");
const SHOTS = resolve(process.argv[3] || "shots");
const CASES = JSON.parse(process.argv[4]);
const MODE = new Set((process.argv[5] || "").split(","));
const OPEN = MODE.has("open");
const CHROME = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"].find((p) => p && existsSync(p));
mkdirSync(SHOTS, { recursive: true });
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
for (const [name, path_, sel, width] of CASES) {
  const page = await browser.newPage();
  await page.setViewport({ width, height: 1000, deviceScaleFactor: 1 });
  if (MODE.has("reduced")) await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  await page.goto(`http://127.0.0.1:${port}${path_}`, { waitUntil: "networkidle0" });
  await page.evaluate(() => document.fonts.ready).catch(() => {});
  if (OPEN) {
    await page.$$eval("details:not([open])", (els) => els.forEach((el) => {
      const s = el.querySelector("summary"); if (s) s.click();
    }));
  }
  await new Promise((r) => setTimeout(r, 900));
  const el = await page.$(sel);
  if (!el) { console.log(`missing ${sel} on ${path_}`); await page.close(); continue; }
  await el.evaluate((n) => n.scrollIntoView({ block: "center", behavior: "instant" }));
  await new Promise((r) => setTimeout(r, 500));
  const file = join(SHOTS, `${name}.png`);
  await el.screenshot({ path: file });
  const box = await el.boundingBox();
  console.log(`${name}  ${Math.round(box.width)}x${Math.round(box.height)}  ${file}`);
  await page.close();
}
await browser.close();
server.close();
