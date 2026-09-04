/**
 * Browser gates for the evidence page.
 *
 *   npm install          # once, ~44 MB, downloads no browser
 *   npm run gates        # or: node run.mjs
 *
 * Why this file exists. The page's numbers were measured once by a script that was never
 * saved, so "8 of 8 checks passing" could not be re-run by anyone, including the person
 * who wrote it. A measurement nobody can repeat is an assertion. This is the repeatable
 * version, and it is committed so a reviewer can run it too.
 *
 * It drives the Chrome already installed on the machine through puppeteer-core, so there
 * is no bundled browser to download and the report records which binary was used.
 *
 * Every gate returns one of THREE results, never two:
 *
 *   PASS               the threshold was met
 *   FAIL               the threshold was measured and missed
 *   COULD-NOT-MEASURE  the measurement itself did not happen
 *
 * The third one matters. Folding "could not measure" into "pass" is how a gate quietly
 * stops protecting anything, and folding it into "fail" makes people delete the gate.
 * COULD-NOT-MEASURE is reported separately and is not counted as a pass.
 */
import { createServer } from "node:http";
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { existsSync } from "node:fs";
import { extname, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, "..", "..");
const OUT = join(APP, "out");
const SHOTS = join(HERE, "shots");
const REPORT = join(HERE, "gate-report.json");

const ACTS = ["act-00", "act-01", "act-02", "act-03", "act-04",
              "act-05", "act-06", "act-07", "act-08"];
// Both are third-party render-time dependencies. jsDelivr carries the motion libraries;
// Typekit carries the webfonts, and a font swap was the entire cause of this page's layout
// shift once already. A loss gate that only covered one of them would have missed it.
const CDN_HOSTS = ["cdn.jsdelivr.net", "use.typekit.net", "p.typekit.net"];
const WEIGHT_CEILING_KB = 120;

const CHROME_CANDIDATES = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
];

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
  ".mp3": "audio/mpeg",
  ".svg": "image/svg+xml",
};

const results = [];

function record(name, status, detail, measured = {}) {
  results.push({ name, status, detail, ...measured });
  const tag = { PASS: "PASS", FAIL: "FAIL", "COULD-NOT-MEASURE": "CNM " }[status];
  console.log(`${tag}  ${name}\n      ${detail}`);
}

/**
 * Serve `out/` with gzip, because compression decides the performance target.
 *
 * Measuring an uncompressed directory reports a page weight and a paint time that no
 * real host would ever produce, which flatters or damns the page for no reason.
 * `no-store` is set so a second run cannot be served a stale first run.
 */
function serve(root) {
  const server = createServer(async (req, res) => {
    const rel = decodeURIComponent(req.url.split("?")[0]);
    const file = join(root, rel === "/" ? "index.html" : rel);
    if (!file.startsWith(root)) {
      res.writeHead(403).end();
      return;
    }
    try {
      const body = await readFile(file);
      const type = MIME[extname(file).toLowerCase()] || "application/octet-stream";
      const compressible = /text|javascript|json|svg/.test(type);
      const payload = compressible ? gzipSync(body) : body;
      const headers = {
        "content-type": type,
        "content-length": payload.length,
        "cache-control": "no-store",
      };
      if (compressible) headers["content-encoding"] = "gzip";
      res.writeHead(200, headers).end(payload);
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

function findChrome() {
  return CHROME_CANDIDATES.find((p) => p && existsSync(p)) || null;
}

/** Scroll the whole page in 200px steps, so a shift anywhere on it is caught. */
async function fullScroll(page) {
  await page.evaluate(async () => {
    const step = 200;
    const wait = () => new Promise((r) => requestAnimationFrame(() => r()));
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await wait();
      await wait();
    }
    window.scrollTo(0, document.body.scrollHeight);
    await wait();
  });
}

/** Which acts are actually visible to a reader, by rendered box rather than by CSS. */
async function visibleActs(page) {
  return page.evaluate((acts) => acts.filter((id) => {
    const el = document.getElementById(id);
    if (!el) return false;
    const box = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return box.height > 0 && box.width > 0
      && style.visibility !== "hidden" && style.display !== "none";
  }), ACTS);
}

async function gateWeight() {
  // The CSS is inlined into index.html by the generator, so it is counted there rather
  // than as its own file. An earlier version of this gate looked for page.css in out/,
  // did not find it, and reported COULD-NOT-MEASURE, which was the gate being wrong
  // about the build rather than the build being wrong.
  const counted = ["index.html", "app.js", "player.js"];
  let total = 0;
  const parts = {};
  for (const name of counted) {
    const path = join(OUT, name);
    try {
      const raw = await readFile(path);
      const gz = gzipSync(raw).length;
      parts[name] = Math.round(gz / 102.4) / 10;
      total += gz;
    } catch {
      record("weight", "COULD-NOT-MEASURE",
        `${name} is not in out/. Run tools/judge_page.py first.`);
      return;
    }
  }
  const kb = Math.round(total / 102.4) / 10;
  record("weight", kb <= WEIGHT_CEILING_KB ? "PASS" : "FAIL",
    `${kb} KB gzipped over ${WEIGHT_CEILING_KB} KB ceiling, excluding Lenis and audio. `
    + Object.entries(parts).map(([k, v]) => `${k} ${v}`).join(", "),
    { kb, parts });
}

const CLS_RUNS = 5;

/**
 * Measure CLS several times and gate on the worst run.
 *
 * Layout shift on this page is not deterministic: repeated runs of the identical build
 * came back 0.00133 and 0.00007. Reporting one sample means the gate passes or fails on
 * luck, so it reports every sample and judges the maximum. If the spread is wide the
 * detail says so, because a wide spread is itself a finding.
 */
async function gateCls(browser, url) {
  const samples = [];
  let worstShifts = [];
  for (let run = 0; run < CLS_RUNS; run += 1) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    const one = await measureCls(page, url);
    await page.close();
    if (one === null) {
      record("cls", "COULD-NOT-MEASURE", "the observer returned no usable number");
      return;
    }
    samples.push(one.cls);
    if (one.cls >= Math.max(...samples)) worstShifts = one.shifts;
  }
  const worst = Math.max(...samples);
  const best = Math.min(...samples);
  const movers = [...worstShifts].sort((a, b) => b.value - a.value).slice(0, 3);
  const blame = movers.length
    ? ` Worst movers: ${movers.map((s) => `${s.node} ${s.from}->${s.to}px (${s.value})`).join("; ")}`
    : " No source node was attributed.";
  record("cls", worst < 0.001 ? "PASS" : "FAIL",
    `worst of ${CLS_RUNS} scripted full scrolls is ${worst.toFixed(5)}, ceiling 0.001. `
    + `Samples: ${samples.map((s) => s.toFixed(5)).join(", ")}.`
    + (best > 0 && worst / best > 3 ? ` Spread is ${Math.round(worst / best)}x, so a single `
      + "sample of this metric would be meaningless." : "")
    + blame,
    { clsWorst: Number(worst.toFixed(5)), clsSamples: samples.map((s) => Number(s.toFixed(5))),
      shifts: movers });
}

async function measureCls(page, url) {
  await page.goto(url, { waitUntil: "networkidle0" });
  // Record which node moved, not just how much. A bare CLS number tells you a gate
  // failed; the node tells you what to fix, and without it the next step is guessing.
  await page.evaluate(() => {
    window.__cls = 0;
    window.__shifts = [];
    const describe = (node) => {
      if (!node || node.nodeType !== 1) return "(not an element)";
      const id = node.id ? `#${node.id}` : "";
      const cls = node.className && typeof node.className === "string"
        ? `.${node.className.trim().split(/\s+/).join(".")}` : "";
      return `${node.tagName.toLowerCase()}${id}${cls}`.slice(0, 90);
    };
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.hadRecentInput) continue;
        window.__cls += entry.value;
        for (const s of entry.sources || []) {
          window.__shifts.push({
            value: Number(entry.value.toFixed(5)),
            node: describe(s.node),
            from: s.previousRect ? Math.round(s.previousRect.top) : null,
            to: s.currentRect ? Math.round(s.currentRect.top) : null,
          });
        }
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
  await fullScroll(page);
  const cls = await page.evaluate(() => window.__cls);
  const shifts = await page.evaluate(() => window.__shifts);
  if (typeof cls !== "number" || Number.isNaN(cls)) return null;
  return { cls, shifts };
}

async function gateLongTasks(page, url) {
  await page.goto(url, { waitUntil: "networkidle0" });
  const supported = await page.evaluate(() => {
    window.__long = [];
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) window.__long.push(Math.round(e.duration));
      }).observe({ type: "longtask", buffered: true });
      return true;
    } catch {
      return false;
    }
  });
  if (!supported) {
    record("long tasks", "COULD-NOT-MEASURE", "this browser does not expose longtask entries");
    return;
  }
  await fullScroll(page);
  const long = await page.evaluate(() => window.__long.filter((d) => d > 50));
  record("long tasks", long.length === 0 ? "PASS" : "FAIL",
    long.length === 0
      ? "no task over 50 ms during a full scroll after load"
      : `${long.length} task(s) over 50 ms: ${long.join(", ")} ms`,
    { longTasks: long });
}

async function gateReducedMotion(browser, url) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.emulateMediaFeatures([
    { name: "prefers-reduced-motion", value: "reduce" },
  ]);
  await page.goto(url, { waitUntil: "networkidle0" });
  await fullScroll(page);
  const visible = await visibleActs(page);
  const heroTransform = await page.evaluate(() => {
    const el = document.querySelector("#act-00 .inner");
    if (!el) return "missing";
    return getComputedStyle(el).transform;
  });
  await page.close();

  if (heroTransform === "missing") {
    record("reduced motion", "COULD-NOT-MEASURE", "#act-00 .inner was not found");
    return;
  }
  const still = heroTransform === "none" || heroTransform === "matrix(1, 0, 0, 1, 0, 0)";
  const allActs = visible.length === ACTS.length;
  record("reduced motion", still && allActs ? "PASS" : "FAIL",
    `${visible.length} of ${ACTS.length} acts render; hero transform is ${heroTransform}`,
    { visible: visible.length, heroTransform });
}

async function gateNoJs(browser, url) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.setJavaScriptEnabled(false);
  await page.goto(url, { waitUntil: "domcontentloaded" });
  const found = await page.evaluate(() => null).catch(() => null);
  // With JS off, evaluate is unavailable, so measure through the DOM snapshot instead.
  const html = await page.content();
  await page.close();
  const missing = ACTS.filter((id) => !html.includes(`id="${id}"`) && !html.includes(`id=${id}`));
  const text = html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, " ");
  const words = text.split(/\s+/).filter(Boolean).length;
  record("no javascript", missing.length === 0 && words > 800 ? "PASS" : "FAIL",
    missing.length === 0
      ? `all ${ACTS.length} acts present in the served HTML, ${words} words of readable text`
      : `missing acts: ${missing.join(", ")}`,
    { words, missingActs: missing, evaluated: found });
}

async function gateCdnLoss(browser, url) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.setRequestInterception(true);
  const blocked = [];
  page.on("request", (req) => {
    if (CDN_HOSTS.some((h) => req.url().includes(h))) {
      blocked.push(req.url());
      req.abort().catch(() => {});
    } else {
      req.continue().catch(() => {});
    }
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 120)));
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await new Promise((r) => setTimeout(r, 1200));
  await fullScroll(page).catch(() => {});
  const visible = await visibleActs(page);
  await page.close();

  if (blocked.length === 0) {
    record("cdn loss", "COULD-NOT-MEASURE",
      `nothing was requested from ${CDN_HOSTS.join(" or ")}, so the failure path was `
      + "never exercised");
    return;
  }
  const ok = visible.length === ACTS.length;
  record("cdn loss", ok ? "PASS" : "FAIL",
    `${blocked.length} third-party request(s) aborted across ${CDN_HOSTS.length} hosts; `
    + `${visible.length} of ${ACTS.length} acts still render`
    + (errors.length ? `; ${errors.length} page error(s): ${errors[0]}` : "; no page errors"),
    { blocked: blocked.length, visible: visible.length, errors });
}

async function shoot(browser, url) {
  await mkdir(SHOTS, { recursive: true });
  const viewports = [
    { label: "desktop", width: 1440, height: 900 },
    { label: "mobile", width: 390, height: 844 },
  ];
  let written = 0;
  for (const vp of viewports) {
    const page = await browser.newPage();
    await page.setViewport({ width: vp.width, height: vp.height });
    await page.goto(url, { waitUntil: "networkidle0" });
    await fullScroll(page);
    for (const id of ACTS) {
      const el = await page.$(`#${id}`);
      if (!el) continue;
      await el.scrollIntoView().catch(() => {});
      await new Promise((r) => setTimeout(r, 250));
      await el.screenshot({ path: join(SHOTS, `${vp.label}-${id}.png`) }).catch(() => {});
      written += 1;
    }
    await page.close();
  }
  record("screenshots", written === ACTS.length * 2 ? "PASS" : "COULD-NOT-MEASURE",
    `${written} of ${ACTS.length * 2} act screenshots written to tools/gates/shots/`,
    { written });
}

async function main() {
  if (!existsSync(OUT)) {
    console.error(`No built page at ${OUT}.\nRun: python tools/judge_page.py`);
    process.exit(2);
  }
  const chrome = findChrome();
  if (!chrome) {
    console.error("No Chrome or Edge binary found. Gates cannot run.");
    process.exit(2);
  }
  const { server, port } = await serve(OUT);
  const url = `http://127.0.0.1:${port}/index.html`;
  console.log(`serving ${OUT} with gzip on ${url}`);
  console.log(`browser: ${chrome}\n`);

  const browser = await puppeteer.launch({
    executablePath: chrome,
    headless: true,
    args: ["--no-sandbox", "--disable-gpu", "--force-color-profile=srgb"],
  });

  try {
    await gateWeight();
    await gateCls(browser, url);
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    await gateLongTasks(page, url);
    await page.close();
    await gateReducedMotion(browser, url);
    await gateNoJs(browser, url);
    await gateCdnLoss(browser, url);
    await shoot(browser, url);
  } finally {
    await browser.close();
    server.close();
  }

  const pass = results.filter((r) => r.status === "PASS").length;
  const fail = results.filter((r) => r.status === "FAIL").length;
  const cnm = results.filter((r) => r.status === "COULD-NOT-MEASURE").length;

  await writeFile(REPORT, `${JSON.stringify({
    generated: new Date().toISOString(),
    browser: chrome,
    served: "gzip, no-store, from out/",
    totals: { pass, fail, could_not_measure: cnm, of: results.length },
    gates: results,
  }, null, 2)}\n`, "utf8");

  console.log(`\n${pass} passed, ${fail} failed, ${cnm} could not be measured, `
    + `of ${results.length} gates.`);
  console.log(`report: ${REPORT}`);
  // A gate that could not be measured is not a gate that passed, so it fails the run.
  process.exit(fail + cnm === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
