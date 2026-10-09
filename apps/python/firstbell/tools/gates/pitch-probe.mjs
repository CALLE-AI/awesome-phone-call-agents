/* Does a real up-and-down drag tilt the board, and does any pixel it draws reach the edge
 * of its own canvas?
 *
 * Not a gate; run by hand. The drag is dispatched through Chrome's own input pipeline
 * rather than by calling into the module, so what is measured is the gesture a reader
 * makes. The clipping question is answered on pixels rather than on the framed bounding
 * box: that box is a cuboid whose top corners sit in empty air above the far corners of a
 * flat grid, so it reads as overflowing at rest on a board that is comfortably inside its
 * frame. Ink is the thing that can be clipped, so ink is what is counted.
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

const SHOTS = resolve(process.argv[4] || ".");

for (const [label, path_, stage, width] of JSON.parse(process.argv[3])) {
  const page = await browser.newPage();
  await page.setViewport({ width, height: 900, deviceScaleFactor: 1 });
  await page.goto(`http://127.0.0.1:${port}${path_}`, { waitUntil: "load" });
  const key = stage === "[data-mrn-stage]" ? "__morning" : "__cutoff";
  const ready = await page.evaluate(async (k) => {
    for (let i = 0; i < 120 && !window[k]; i += 1) await new Promise((r) => setTimeout(r, 100));
    return Boolean(window[k]);
  }, key);
  if (!ready) { console.log(`${label}: no board`); await page.close(); continue; }

  const el = await page.$(stage);
  // Into view first. `page.mouse` works in viewport coordinates and `boundingBox`
  // reports document ones, so a board below the fold was being dragged at a point
  // somewhere else on the page: its yaw drifted by the idle spin alone and its pitch
  // never moved, which reads exactly like a feature that was never wired.
  await el.evaluate((n) => n.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await new Promise((r) => setTimeout(r, 400));
  const box = await el.boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const read = () => page.evaluate((k) => ({ pitch: window[k].pitch(), turn: window[k].turn(),
                                             range: window[k].pitchRange }), key);

  const lines = [];
  for (const [name, dx, dy] of [["rest", 0, 0], ["drag up", 0, -400], ["drag down", 0, 800],
                                ["drag right", 700, 0]]) {
    if (dx || dy) {
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      for (let s = 1; s <= 10; s += 1) await page.mouse.move(cx + (dx * s) / 10, cy + (dy * s) / 10);
      await page.mouse.up();
    }
    await new Promise((r) => setTimeout(r, 350));
    const state = await read();
    const file = join(SHOTS, `${label.replace(/[^a-z0-9]+/gi, '-')}-${name.replace(/ /g, '-')}.png`);
    await (await page.$(`${stage} canvas`)).screenshot({ path: file });
    lines.push(`    ${name.padEnd(11)} pitch ${String(state.pitch).padStart(7)}  turn ${String(state.turn).padStart(8)}  ${file}`);
  }
  const st = await read();
  console.log(`${label}  clamp [${st.range}]`);
  console.log(lines.join("\n"));
  await page.close();
}
await browser.close();
server.close();
