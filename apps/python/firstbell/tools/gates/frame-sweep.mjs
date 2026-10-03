/* Does any pose the drag allows put ink on the edge of the board's own canvas?
 *
 * Not a gate; run by hand while tuning the framing. Sweeps yaw right round and pitch across
 * its clamp, photographs the canvas at each pose, and writes one PNG per pose for
 * `frame-sweep.py` to count edge pixels on. Pixels rather than bounding boxes: see the
 * comment on `pose` in morning.js for why the box answer is wrong here.
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
const SHOTS = resolve(process.argv[3] || "sweep");
const CASES = JSON.parse(process.argv[4]);
const YAWS = Number(process.argv[5] || 16);
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

let poses = 0;
for (const [label, path_, stage, width] of CASES) {
  const key = stage === "[data-mrn-stage]" ? "__morning" : "__cutoff";
  const page = await browser.newPage();
  await page.setViewport({ width, height: 900, deviceScaleFactor: 1 });
  await page.goto(`http://127.0.0.1:${port}${path_}`, { waitUntil: "load" });
  const range = await page.evaluate(async (k) => {
    for (let i = 0; i < 120 && !window[k]; i += 1) await new Promise((r) => setTimeout(r, 100));
    return window[k] ? window[k].pitchRange : null;
  }, key);
  if (!range) { console.log(`${label}: no board`); await page.close(); continue; }
  const el = await page.$(`${stage} canvas`);
  const [lo, hi] = range;
  const pitches = [lo, lo * 0.5, 0, hi * 0.5, hi];
  for (let i = 0; i < YAWS; i += 1) {
    const turn = (i * 2 * Math.PI) / YAWS;
    for (const pitch of pitches) {
      await page.evaluate((k, t, p) => { window[k].pose(t, p); }, key, turn, pitch);
      await new Promise((r) => setTimeout(r, 90));
      await el.screenshot({ path: join(SHOTS,
        `${label.replace(/[^a-z0-9]+/gi, "-")}__y${i}__p${pitch.toFixed(2)}.png`) });
      poses += 1;
    }
  }
  console.log(`${label}: ${YAWS * pitches.length} poses`);
  await page.close();
}
await browser.close();
server.close();
console.log(`${poses} poses written to ${SHOTS}`);
