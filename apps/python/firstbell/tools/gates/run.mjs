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

/**
 * Measure long tasks several times and gate on the worst run.
 *
 * This gate used to take one sample. The task it was catching, GSAP and ScrollTrigger
 * parsing, appeared in six runs out of eight and was absent in the other two, so the gate
 * passed or failed on which of those it happened to draw, and it did both within an hour
 * on identical code. It runs the same number of times as the CLS gate now and reports
 * every sample, for the same reason.
 *
 * It also separates load from scroll. The observer takes buffered entries, so it always
 * saw tasks from before the scroll began, while the message claimed everything it found
 * happened during the scroll after load. Which phase a task came from is the first thing
 * you need to know to fix it.
 */
async function gateLongTasks(browser, url) {
  const samples = [];
  let worstTasks = [];
  for (let run = 0; run < CLS_RUNS; run += 1) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    const supported = await page.evaluate(() => true).catch(() => false);
    if (!supported) {
      await page.close();
      record("long tasks", "COULD-NOT-MEASURE", "the page could not be evaluated");
      return;
    }
    let ok = true;
    await page.evaluateOnNewDocument(() => {
      window.__long = [];
      try {
        new PerformanceObserver((list) => {
          for (const e of list.getEntries()) {
            window.__long.push({ d: Math.round(e.duration), at: Math.round(e.startTime) });
          }
        }).observe({ type: "longtask", buffered: true });
        window.__longOk = true;
      } catch {
        window.__longOk = false;
      }
    });
    await page.goto(url, { waitUntil: "networkidle0" });
    const loadEnd = await page.evaluate(() => {
      const nav = performance.getEntriesByType("navigation")[0];
      return Math.round(nav ? nav.loadEventEnd : 0);
    });
    ok = await page.evaluate(() => window.__longOk === true);
    if (!ok) {
      await page.close();
      record("long tasks", "COULD-NOT-MEASURE", "this browser does not expose longtask entries");
      return;
    }
    await fullScroll(page);
    const long = await page.evaluate(() => window.__long.filter((t) => t.d > 50));
    await page.close();
    const tagged = long.map((t) => ({ ...t, phase: t.at <= loadEnd ? "load" : "scroll" }));
    const worstHere = tagged.length ? Math.max(...tagged.map((t) => t.d)) : 0;
    if (worstHere >= Math.max(0, ...samples)) worstTasks = tagged;
    samples.push(worstHere);
  }
  const worst = Math.max(...samples);
  const blame = worstTasks.length
    ? ` Worst run: ${worstTasks.map((t) => `${t.d} ms at ${t.at} ms during ${t.phase}`).join("; ")}.`
    : "";
  record("long tasks", worst === 0 ? "PASS" : "FAIL",
    `longest task in each of ${CLS_RUNS} loads with a full scroll: `
    + `${samples.map((s) => `${s} ms`).join(", ")}, against a 50 ms ceiling.`
    + blame,
    { longTaskWorst: worst, longTaskSamples: samples, longTasks: worstTasks });
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

/**
 * Resolve once the page has stopped scrolling, or after a bounded number of frames.
 *
 * The bound matters: a page that never settles must not hang the gate, and returning
 * after it is a measurement worth taking rather than an error, because the caller's
 * fixed wait follows anyway.
 */
async function settleScroll(page) {
  await page.evaluate(() => new Promise((resolve) => {
    let last = -1;
    let still = 0;
    let frames = 0;
    const tick = () => {
      const y = Math.round(window.scrollY * 100) / 100;
      still = y === last ? still + 1 : 0;
      last = y;
      frames += 1;
      if (still >= 5 || frames > 180) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  })).catch(() => {});
}

/**
 * The rail names the act the reader is in, scrolling down and back up.
 *
 * Scrolling to the bottom and back to the top used to leave it marking act 2, because the
 * observer behind it only listened for acts arriving, and the sticky first act never
 * leaves the middle of the viewport, so it never arrives a second time.
 *
 * The expected answer here is computed from each act's document offset, measured once at
 * the top of the page where nothing is stuck, and compared against the viewport midpoint
 * in document coordinates. That is arithmetic the page does not do: the page hit-tests
 * what is painted. Two different routes to the same answer, which is the only way this
 * gate can disagree with the page.
 */
async function gateRail(browser, url) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(url, { waitUntil: "networkidle0" });

  const present = await page.evaluate(() => {
    const rail = document.querySelector(".rail");
    if (!rail) return false;
    return getComputedStyle(rail).display !== "none"
      && document.querySelectorAll(".rail a[href^='#']").length > 0;
  });
  if (!present) {
    await page.close();
    record("rail", "COULD-NOT-MEASURE",
      "no rail is rendered at 1440px, so there was nothing to check");
    return;
  }

  await page.evaluate(() => window.scrollTo(0, 0));
  await settleScroll(page);
  const map = await page.evaluate(() => {
    const links = [...document.querySelectorAll(".rail a[href^='#']")];
    return {
      height: window.innerHeight,
      docHeight: document.documentElement.scrollHeight,
      acts: links.map((a) => {
        const el = document.querySelector(a.getAttribute("href"));
        const r = el.getBoundingClientRect();
        return { id: el.id, top: Math.round(r.top + window.scrollY), height: Math.round(r.height) };
      }),
    };
  });

  const expected = (y) => {
    const mid = y + map.height / 2;
    let found = null;
    for (const a of map.acts) if (a.top <= mid && mid < a.top + a.height) found = a.id;
    return found;
  };

  // Down the page and back up. The way back is the half that was broken.
  const stops = [];
  const bottom = map.docHeight - map.height;
  for (let i = 0; i <= 8; i += 1) stops.push(Math.round((bottom * i) / 8));
  for (let i = 7; i >= 0; i -= 1) stops.push(Math.round((bottom * i) / 8));

  const wrong = [];
  let checked = 0;
  for (const y of stops) {
    await page.evaluate((to) => window.scrollTo(0, to), y);
    await settleScroll(page);
    await new Promise((r) => setTimeout(r, 120));
    const seen = await page.evaluate(() => {
      const cur = [...document.querySelectorAll(".rail a[href^='#']")]
        .find((a) => a.getAttribute("aria-current") === "true");
      return { marked: cur ? cur.getAttribute("href").slice(1) : null,
               y: Math.round(window.scrollY) };
    });
    const want = expected(seen.y);
    if (want === null) continue;   // a midpoint in no act at all is not this gate's business
    checked += 1;
    if (seen.marked !== want) wrong.push(`at ${seen.y}px it marks ${seen.marked || "nothing"}, expected ${want}`);
  }
  await page.close();

  if (checked < stops.length / 2) {
    record("rail", "COULD-NOT-MEASURE",
      `only ${checked} of ${stops.length} scroll positions landed inside an act`);
    return;
  }
  record("rail", wrong.length === 0 ? "PASS" : "FAIL",
    wrong.length === 0
      ? `the rail names the right act at all ${checked} scroll positions, down the page and back up`
      : `${wrong.length} of ${checked} positions name the wrong act: ${wrong.slice(0, 3).join("; ")}`,
    { checked, wrong });
}

/** Collected in the page: every text run, its painted colour and its painted ground. */
const CONTRAST_PROBE = () => {
  const cx = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  const seen = new Map();
  const paint = (css) => {
    if (seen.has(css)) return seen.get(css);
    let v = null;
    if (css && css !== "none" && css !== "transparent") {
      cx.clearRect(0, 0, 1, 1);
      cx.fillStyle = "rgba(0, 0, 0, 0)";
      cx.fillStyle = css;
      cx.fillRect(0, 0, 1, 1);
      const d = cx.getImageData(0, 0, 1, 1).data;
      v = [d[0], d[1], d[2], d[3] / 255];
    }
    seen.set(css, v);
    return v;
  };
  const lin = (c) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  const lum = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
  const over = (fg, bg) => [0, 1, 2].map((i) => fg[i] * fg[3] + bg[i] * (1 - fg[3]));

  // Everything behind this element at this point, nearest first, whether or not it is a
  // relative of it. elementsFromPoint answers about painting; parentElement answers about
  // markup, and for anything fixed or sticky those are different questions.
  const groundAt = (el, x, y) => {
    const stack = document.elementsFromPoint(x, y);
    const start = stack.indexOf(el);
    // If the element is not in the stack the point is not over it, and the stack is then
    // a list of what is in FRONT of it. Reading a ground out of that answers with the
    // colour of whatever is covering the element: light text on a dark band came back as
    // light on light, ratio exactly 1.00, for every one of them. Walk the ancestors
    // instead, and say so when even that finds nothing.
    const behind = start >= 0
      ? stack.slice(start + 1)
      : (() => { const up = []; for (let n = el.parentElement; n; n = n.parentElement) up.push(n); return up; })();
    let acc = null;
    for (const node of behind) {
      const c = paint(getComputedStyle(node).backgroundColor);
      if (!c || c[3] === 0) continue;
      acc = acc ? over(acc.concat(1), c).concat(1) : c;
      if (c[3] >= 1) return acc.slice(0, 3);
    }
    const root = paint(getComputedStyle(document.documentElement).backgroundColor);
    if (root && root[3] >= 1) return acc ? over(acc.concat(1), root) : root.slice(0, 3);
    return null;
  };

  const rows = [];
  for (const el of document.querySelectorAll("body *")) {
    const own = [...el.childNodes]
      .filter((n) => n.nodeType === 3 && n.textContent.trim())
      .map((n) => n.textContent.trim()).join(" ");
    if (!own) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility !== "visible" || cs.display === "none") continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const x = Math.round(r.x + r.width / 2);
    const y = Math.round(r.y + r.height / 2);
    if (x < 1 || y < 1 || x > innerWidth - 1 || y > innerHeight - 1) continue;

    // Inside a box that scrolls, a rect is where the element would be, not where it is
    // painted. The transcript is a 22rem list with its own scrollbar, so its lower rows
    // report positions on screen while nothing of them is drawn there. Measuring those
    // returns the ground twice and calls it a contrast failure. This gate cannot scroll an
    // inner box, so it says it could not measure them rather than that they are wrong.
    let clipped = false;
    for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
      const ncs = getComputedStyle(n);
      if (ncs.overflowY === "visible" && ncs.overflowX === "visible") continue;
      const nb = n.getBoundingClientRect();
      if (r.bottom <= nb.top + 1 || r.top >= nb.bottom - 1
          || r.right <= nb.left + 1 || r.left >= nb.right - 1) { clipped = true; break; }
    }
    if (clipped) continue;

    let alpha = 1;
    for (let n = el; n && n !== document.documentElement.parentNode; n = n.parentElement) {
      alpha *= Number(getComputedStyle(n).opacity);
    }
    const label = el.tagName.toLowerCase() + (typeof el.className === "string" && el.className.trim()
      ? "." + el.className.trim().split(/\s+/).join(".") : "");
    const key = `${label}|${own.slice(0, 30)}`;
    const fg = paint(cs.color);
    const bg = groundAt(el, x, y);
    if (!fg || !bg) { rows.push({ key, label, text: own.slice(0, 34), unmeasured: true }); continue; }

    // The element is painted at `alpha` of its own colour over whatever is behind it, so
    // that composite is the colour a reader sees and the one the ratio is about.
    const solid = over(fg, bg);
    const shown = [0, 1, 2].map((i) => solid[i] * alpha + bg[i] * (1 - alpha));
    const [hi, lo] = [lum(shown), lum(bg)].sort((a, b) => b - a);
    const px = parseFloat(cs.fontSize);
    const weight = Number(cs.fontWeight) || 400;
    rows.push({
      key, label, text: own.slice(0, 34), unmeasured: false,
      ratio: (hi + 0.05) / (lo + 0.05),
      need: (px >= 24 || (px >= 18.66 && weight >= 700)) ? 3 : 4.5,
      px: Math.round(px * 10) / 10, weight, alpha: Math.round(alpha * 100) / 100,
      colour: cs.color,
    });
  }
  return rows;
};

/**
 * Every run of text must clear its WCAG AA ratio in at least one resting state.
 *
 * Best of two passes, at the top of the page and after a full scroll, because several
 * things here are legitimately mid-fade at some scroll positions and judging those would
 * report the curtain closing as a defect. Anything that fails in both states fails in
 * every state a reader can stop at, which is the property worth gating.
 */
async function gateContrast(browser, url) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(url, { waitUntil: "networkidle0" });
  await page.evaluate(() => document.fonts.ready).catch(() => {});
  await new Promise((r) => setTimeout(r, 400));

  const best = new Map();
  const absorb = (rows) => {
    for (const row of rows) {
      const had = best.get(row.key);
      if (row.unmeasured) { if (!had) best.set(row.key, row); continue; }
      if (!had || had.unmeasured || row.ratio > had.ratio) best.set(row.key, row);
    }
  };

  // Only elements whose centre is on screen can be hit-tested for a ground, so the page
  // is walked a viewport at a time. Two passes reached 47 runs of nearly six hundred, and
  // a gate that judges a twelfth of the page is not measuring the page.
  const height = await page.evaluate(() => window.innerHeight);
  const total = await page.evaluate(() => document.documentElement.scrollHeight);
  absorb(await page.evaluate(CONTRAST_PROBE));
  // Half a viewport at a time. A full step leaves elements that are only ever centred
  // between two stops unsampled, and an element sampled once, part way through its own
  // fade, is judged on that one reading.
  for (let y = 0; y < total; y += Math.round(height / 2)) {
    await page.evaluate((to) => window.scrollTo(0, to), y);
    await settleScroll(page);
    // Longer than the 240ms reveal transition, or the gate reads an element part way
    // into its own fade and calls that a contrast failure.
    await new Promise((r) => setTimeout(r, 600));
    absorb(await page.evaluate(CONTRAST_PROBE));
  }
  await page.close();

  const rows = [...best.values()];
  const unmeasured = rows.filter((r) => r.unmeasured);
  const measured = rows.filter((r) => !r.unmeasured);
  if (measured.length < 50) {
    record("contrast", "COULD-NOT-MEASURE",
      `only ${measured.length} text runs resolved to a colour and a ground`);
    return;
  }
  const fails = measured.filter((r) => r.ratio < r.need).sort((a, b) => a.ratio - b.ratio);
  const worst = Math.min(...measured.map((r) => r.ratio));
  record("contrast", fails.length === 0 ? "PASS" : "FAIL",
    fails.length === 0
      ? `all ${measured.length} text runs clear WCAG AA; the closest is ${worst.toFixed(2)}, `
        + `and ${unmeasured.length} could not be resolved to a colour and a ground`
      : `${fails.length} of ${measured.length} text runs are below WCAG AA: `
        + fails.slice(0, 4).map((f) => `${f.label} ${f.ratio.toFixed(2)} needs ${f.need} `
          + `(${f.px}px, painted at ${f.alpha} of ${f.colour}) "${f.text}"`).join("; "),
    { measured: measured.length, unmeasured: unmeasured.length,
      worst: Number(worst.toFixed(2)),
      fails: fails.slice(0, 12).map((f) => ({ label: f.label, ratio: Number(f.ratio.toFixed(2)),
        need: f.need, px: f.px, alpha: f.alpha, text: f.text })) });
}

async function shoot(browser, url) {
  await mkdir(SHOTS, { recursive: true });
  const viewports = [
    { label: "desktop", width: 1440, height: 900 },
    { label: "mobile", width: 390, height: 844 },
  ];
  let written = 0;
  const wrong = [];
  for (const vp of viewports) {
    const page = await browser.newPage();
    await page.setViewport({ width: vp.width, height: vp.height });
    await page.goto(url, { waitUntil: "networkidle0" });
    await fullScroll(page);

    // Measure every act's document offset from the top of the page, which is the one
    // scroll position where nothing is stuck. A sticky element reports its *painted*
    // offset, so asking act 0 where it lives while it is pinned to the top of act 8
    // answers 8260 rather than 0.
    await page.evaluate(() => window.scrollTo(0, 0));
    await settleScroll(page);
    const offsets = await page.evaluate((ids) => {
      const out = {};
      for (const id of ids) {
        const el = document.getElementById(id);
        if (el) out[id] = Math.round(el.getBoundingClientRect().top + window.scrollY);
      }
      return out;
    }, ACTS);

    for (const id of ACTS) {
      const el = await page.$(`#${id}`);
      if (!el || offsets[id] === undefined) continue;
      // Scroll to where the act lives rather than asking the browser to bring it into
      // view. scrollIntoView does nothing to an element that is already on screen, and a
      // pinned hero is always on screen.
      await page.evaluate((y) => window.scrollTo(0, y), offsets[id]);
      // Then wait for the scroll to stop rather than for a fixed 250ms. Lenis eases, so a
      // fixed wait captures at whatever fraction of a pixel it had reached, and two
      // builds with byte-identical layout produced screenshots that differed on every
      // glyph edge. Settling first makes the shot a function of the final position only.
      await settleScroll(page);
      await new Promise((r) => setTimeout(r, 300));

      // What is actually painted in the middle of this act? If the answer is a different
      // act, the file about to be written would carry a name that is not true.
      const showing = await page.evaluate((sel) => {
        const el = document.getElementById(sel);
        const r = el.getBoundingClientRect();
        const cx = Math.min(window.innerWidth - 2, Math.max(2, r.x + r.width / 2));
        const cy = Math.min(window.innerHeight - 2, Math.max(2, r.y + r.height / 2));
        const hit = document.elementFromPoint(cx, cy);
        const owner = hit && hit.closest("section[id^='act-']");
        return owner ? owner.id : "(nothing)";
      }, id);
      if (showing !== id) {
        wrong.push(`${vp.label}-${id} shows ${showing}`);
        continue;
      }

      await el.screenshot({ path: join(SHOTS, `${vp.label}-${id}.png`) }).catch(() => {});
      written += 1;
    }
    await page.close();
  }
  const all = ACTS.length * 2;
  record("screenshots", written === all ? "PASS" : "COULD-NOT-MEASURE",
    written === all
      ? `${written} of ${all} act screenshots written to tools/gates/shots/, each verified `
        + "to be showing the act it is named after"
      : `${written} of ${all} act screenshots written; ${wrong.length} skipped because the `
        + `named act was not what is painted there: ${wrong.join(", ")}`,
    { written, wrong });
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
    await gateLongTasks(browser, url);
    await gateReducedMotion(browser, url);
    await gateNoJs(browser, url);
    await gateCdnLoss(browser, url);
    await gateRail(browser, url);
    await gateContrast(browser, url);
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
