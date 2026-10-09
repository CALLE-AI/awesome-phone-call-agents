/* One row per device: overflow, hero fit, board size, smallest body type, tap targets.

 * Not a gate; run by hand. The overflow gate walks six widths from 390 to 1600 and asks
 * one question. This walks eleven real devices from a 320px iPhone SE to a 2560px desktop
 * and asks four, two of which the suite had no instrument for: whether a control is big
 * enough for a thumb, and how much of the screen the first act takes.
 *
 * Two of its checks are written against a false positive each. A cell inside a box the
 * reader can scroll sideways is not overflow, and a link inside a sentence is exempt from
 * WCAG 2.5.8, so both are excluded rather than counted. And the target check is a hit test
 * rather than a rect: a pseudo-element can carry a 24px target without moving any text, and
 * a rect cannot see that.
 *
 *   node tools/gates/device-sweep.mjs out index.html,the-morning.html
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import puppeteer from "puppeteer-core";
import { listenSafely } from "./safe-port.mjs";
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".svg": "image/svg+xml", ".png": "image/png", ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".woff2": "font/woff2", ".ico": "image/x-icon", ".txt": "text/plain" };
const ROOT = resolve(process.argv[2] || "out");
const PATHS = (process.argv[3] || "index.html").split(",").map((p) => "/" + p.replace(/^\//, ""));
const CHROME = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe"].find((p) => p && existsSync(p));
const DEVICES = [
  ["iPhone SE", 320, 568, 2, true], ["Galaxy S", 360, 640, 3, true], ["iPhone 14", 390, 844, 3, true],
  ["iPhone Max", 430, 932, 3, true], ["iPad mini", 768, 1024, 2, true], ["iPad Pro", 1024, 1366, 2, true],
  ["iPad land", 1180, 820, 2, true], ["laptop", 1280, 800, 1, false], ["laptop hidpi", 1440, 900, 2, false],
  ["desktop", 1920, 1080, 1, false], ["wide", 2560, 1440, 1, false],
];
const server = createServer(async (req, res) => {
  const rel = decodeURIComponent(req.url.split("?")[0]);
  try { const body = await readFile(join(ROOT, rel === "/" ? "index.html" : rel));
    res.writeHead(200, { "content-type": MIME[extname(rel).toLowerCase()] || "application/octet-stream" }).end(body);
  } catch { res.writeHead(404).end("no"); }
});
const { port } = await listenSafely(server);
const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
for (const path_ of PATHS) {
  console.log(`\n== ${path_}`);
  console.log("device        vp          overflow  hero/vp  board      minType  smallTaps  widest");
  for (const [name, w, h, dpr, touch] of DEVICES) {
    const page = await browser.newPage();
    await page.setViewport({ width: w, height: h, deviceScaleFactor: dpr, isMobile: touch, hasTouch: touch });
    await page.goto(`http://127.0.0.1:${port}${path_}`, { waitUntil: "networkidle0" });
    await new Promise((r) => setTimeout(r, 500));
    const row = await page.evaluate(async () => {
      const scrolled = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const cw = document.documentElement.clientWidth;
      // A cell inside a box the reader can scroll sideways is not overflow: the box said so
      // by clipping. Only ink that reaches past the edge with nothing holding it counts.
      const clipped = (el) => {
        for (let n = el.parentElement; n; n = n.parentElement) {
          const cs = getComputedStyle(n);
          if (cs.overflowX !== "visible" || cs.overflowY !== "visible") return true;
        }
        return false;
      };
      let widest = null, over = 0; const smallsOver = [];
      for (const el of document.querySelectorAll("body *")) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || getComputedStyle(el).position === "fixed" || clipped(el)) continue;
        const right = r.right + window.scrollX;
        if (right > cw + 1) { over += 1; if (over < 99) smallsOver.push(el.tagName + "." + (typeof el.className === "string" ? el.className.trim().split(/\s+/)[0] : "") + " " + Math.round(right)); if (!widest || right > widest.right) widest = { right: Math.round(right), tag: el.tagName + "." + (typeof el.className === "string" ? el.className.trim().split(/\s+/)[0] : "") }; }
      }
      const hero = document.querySelector("#act-00");
      const stage = document.querySelector(".mrn-stage");
      let min = 99, minTag = "";
      for (const el of document.querySelectorAll("p, li, td, th, dd, dt, summary, figcaption")) {
        if (!el.textContent.trim() || el.getBoundingClientRect().width === 0) continue;
        const fs = parseFloat(getComputedStyle(el).fontSize);
        if (fs < min) { min = fs; minTag = el.tagName + "." + (typeof el.className === "string" ? el.className.trim().split(/\s+/)[0] : ""); }
      }
      // WCAG 2.5.8 exempts a target inside a sentence, which is most of the links on this
      // page. What is left is the controls a thumb has to find.
      const inline = (el) => {
        const p = el.parentElement;
        if (!p) return false;
        if (!/^(P|LI|TD|DD|DT|SPAN|EM|STRONG|FIGCAPTION|SUMMARY|DIV)$/.test(p.tagName)) return false;
        return (p.textContent || "").trim().length > (el.textContent || "").trim().length + 8;
      };
      const cands = [];
      for (const el of document.querySelectorAll("a, button, summary, input, [tabindex]")) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0 || inline(el)) continue;
        if (r.height >= 24 && r.width >= 24) continue;
        const cls = typeof el.className === "string" ? el.className.trim().split(/\s+/)[0] : "";
        const pcls = el.parentElement && typeof el.parentElement.className === "string"
          ? el.parentElement.className.trim().split(/\s+/)[0] : "";
        cands.push([el, `${el.tagName}.${cls}[${el.parentElement && el.parentElement.tagName}.${pcls}] `
          + `"${(el.textContent || "").trim().slice(0, 22)}" ${Math.round(r.width)}x${Math.round(r.height)}`]);
      }
      // What matters is where a thumb lands, not where the ink is: a pseudo-element can
      // carry the target without moving the text. So this is a real hit test at the corners
      // of a 24 by 24 box centred on the control, with the control scrolled into view,
      // because elementFromPoint takes viewport coordinates and returns null below the fold.
      const missed = [];
      for (const [el, label] of cands) {
        el.scrollIntoView({ block: "center" });
        await scrolled();
        const b = el.getBoundingClientRect();
        const cx = b.left + b.width / 2, cy = b.top + b.height / 2;
        const ok = [[-11, -11], [11, -11], [-11, 11], [11, 11]].every(([dx, dy]) => {
          const at = document.elementFromPoint(cx + dx, cy + dy);
          return at && (at === el || el.contains(at) || at.contains(el));
        });
        if (!ok) missed.push(label);
      }
      const small = missed.length;
      window.scrollTo(0, 0);
      return { cw, over, widest, hero: hero ? Math.round(hero.getBoundingClientRect().height) : 0,
        stage: stage ? `${Math.round(stage.getBoundingClientRect().width)}x${Math.round(stage.getBoundingClientRect().height)}` : "-",
        over_list: [...new Set(smallsOver)].slice(0, 10), min: min.toFixed(1), minTag, small, smalls: [...new Set(missed)].slice(0, 14) };
    });
    console.log(`${name.padEnd(13)} ${String(w + "x" + h).padEnd(11)} ${String(row.over).padEnd(9)} `
      + `${(row.hero + "/" + h).padEnd(9)} ${row.stage.padEnd(10)} ${(row.min + " " + row.minTag).slice(0, 22).padEnd(23)}`
      + `${String(row.small).padEnd(6)}`);
    for (const o of row.over_list) console.log("      over  " + o);
    for (const t of row.smalls) console.log("      tap   " + t);
    await page.close();
  }
}
await browser.close(); server.close();
