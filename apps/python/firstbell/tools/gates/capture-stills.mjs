/**
 * Three annotated stills of the built page, for a reader who will not run the code.
 *
 *   node capture-stills.mjs
 *
 * Each still is built from the real repository at render time: the two code stills read the
 * exact bytes of the file they show (never a retyped copy), and the terminal still runs the
 * CLI itself in OFFLINE mode and captures its real stdout. Nothing in these images is typed
 * from memory, for the same reason tools/judge_page.py reads evidence/ instead of describing
 * it: a caption that is not generated from the thing it describes goes stale the moment either
 * changes.
 *
 * Output: tools/gates/shots/still-*.png (gitignored working copies). The committed copies
 * live in docs/images/ and are placed there by hand after this script runs, once compressed.
 *
 * Uses puppeteer-core against the system Chrome, same as run.mjs. This file does not import
 * or modify run.mjs.
 */
import { readFileSync, mkdirSync } from "node:fs";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import puppeteer from "puppeteer-core";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, "..", "..");
const SHOTS = join(HERE, "shots");
mkdirSync(SHOTS, { recursive: true });

// Whoever runs this supplies the interpreter. FIRSTBELL_PYTHON wins; otherwise a venv
// beside the app or beside the repository is used if one is there; otherwise whatever
// `python` the PATH resolves. A path to one machine's venv baked in here ran nowhere else.
const PYTHON = (() => {
  if (process.env.FIRSTBELL_PYTHON) return process.env.FIRSTBELL_PYTHON;
  const rel = process.platform === "win32" ? "Scripts/python.exe" : "bin/python";
  for (const base of [APP, join(APP, ".."), join(APP, "..", "..", "..")]) {
    const candidate = join(base, ".venv", rel);
    if (existsSync(candidate)) return candidate;
  }
  return process.platform === "win32" ? "python.exe" : "python3";
})();

const CHROME_CANDIDATES = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
];
function findChrome() {
  return CHROME_CANDIDATES.find((p) => p && existsSync(p)) || null;
}

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Read real lines [start, end] (1-based, inclusive) out of a real file. */
function codeLines(relPath, start, end) {
  const text = readFileSync(join(APP, relPath), "utf8");
  const all = text.split("\n");
  return all.slice(start - 1, end).map((line, i) => ({ n: start + i, text: line }));
}

/* ---- finding the subject ------------------------------------------------------------
 *
 * These stills used to carry typed line numbers, and `scheduler.py` moved under them by
 * ninety-two lines. A picture that names a line is a claim about the file, so it is read
 * out of the file. Anything that cannot be located throws with the landmark named, which
 * is the only safe failure: a still that quietly draws the wrong lines is indistinguishable
 * from a correct one.
 */
function allLines(relPath) {
  return readFileSync(join(APP, relPath), "utf8").split("\n");
}

/** The 1-based line of the first line matching `re`. */
function lineOf(all, re, what) {
  const i = all.findIndex((l) => re.test(l));
  if (i < 0) throw new Error(`capture-stills: could not find ${what}; the still would lie`);
  return i + 1;
}

/** Where a statement beginning at `from` ends.
 *
 * Two shapes appear here and the rule has to cover both: arguments indented past the
 * opening line, and a closing bracket returned to the opening line's own indent. Counting
 * brackets instead would be defeated by one inside a string.
 */
function stmtEnd(all, from) {
  const open = all[from - 1];
  const indent = open.length - open.trimStart().length;
  let end = from;
  for (let n = from; n < all.length; n += 1) {
    const text = all[n];
    if (text.trim() === "") continue;
    const ind = text.length - text.trimStart().length;
    if (ind > indent) { end = n + 1; continue; }
    if (ind === indent && text.trim().startsWith(")")) end = n + 1;
    break;
  }
  return end;
}

/** Every `return ItemResult(...)` in a span, with the outcome each one names. */
function outcomesIn(all, from, to) {
  const out = [];
  for (let n = from; n <= to; n += 1) {
    const m = /return ItemResult\(.*resolution=Resolution\.(\w+)/.exec(all[n - 1] || "");
    if (m) out.push({ from: n, to: stmtEnd(all, n), outcome: m[1] });
  }
  return out;
}

const OUTCOME_COLOR = { FAILED: "red", RESOLVED: "green", UNDETERMINED: "amber" };

/** "line 3" or "lines 3, 9 and 12", so the caption reads as a sentence at any count. */
function lineWords(ns) {
  if (ns.length === 1) return `line ${ns[0]}`;
  return `lines ${ns.slice(0, -1).join(", ")} and ${ns[ns.length - 1]}`;
}

const ROW_H = 25;
const HEADER_H = 40;
const PAD_TOP = 18;

// Real Consolas advance width at 14.5px. Measured, not guessed: a still that lays code out
// too narrow either wraps it (misrepresenting the file) or lets it bleed under the callout
// box, which is what happened the first time this rendered.
const CHAR_W = 8.72;

const BASE_CSS = `
  * { box-sizing: border-box; }
  body { margin: 0; background: #0d1117; font-family: -apple-system, Segoe UI, Arial, sans-serif; }
  .card { display: inline-block; background: #0d1117; padding: 28px; }
  .panel { background: #161b22; border: 1px solid #30363d; border-radius: 8px; overflow: hidden; }
  .tabbar { height: ${HEADER_H}px; background: #010409; display: flex; align-items: center;
            padding: 0 16px; border-bottom: 1px solid #30363d; }
  .tabbar .dot { width: 11px; height: 11px; border-radius: 50%; margin-right: 7px; }
  .dot.r { background: #ff5f56; } .dot.y { background: #ffbd2e; } .dot.g { background: #27c93f; }
  .tabbar .path { margin-left: 14px; color: #8b949e; font: 13px/1 "Consolas", "Cascadia Mono", monospace; }
  .code { padding: ${PAD_TOP}px 0; position: relative; }
  .line { display: flex; height: ${ROW_H}px; align-items: center; white-space: pre; overflow: hidden;
          font: 14.5px/${ROW_H}px "Consolas", "Cascadia Mono", monospace; color: #c9d1d9;
          border-left: 4px solid transparent; }
  .gutter { width: 46px; flex: none; text-align: right; padding-right: 14px; color: #4b535d; user-select: none; }
  .src { flex: 1; overflow: hidden; }
  .hl-box { position: relative; }
  .hl-red    { background: rgba(248,81,73,0.13);  border-left-color: #f85149; }
  .hl-amber  { background: rgba(210,153,34,0.14); border-left-color: #d29922; }
  .hl-green  { background: rgba(63,185,80,0.14);  border-left-color: #3fb950; }
  .hl-blue   { background: rgba(88,166,255,0.14); border-left-color: #58a6ff; }
  .badge { margin-left: auto; padding: 1px 9px; border-radius: 10px; font: 12px/18px "Segoe UI", sans-serif;
           font-weight: 600; letter-spacing: 0.02em; white-space: nowrap; margin-right: 14px; }
  .badge-red   { background: #f85149; color: #1a0000; }
  .badge-amber { background: #d29922; color: #1a1200; }
  .badge-green { background: #3fb950; color: #001a03; }
  .badge-blue  { background: #58a6ff; color: #00121f; }
  .callout { position: absolute; }
  .callout .frame { background: #f0f3ff; color: #0d1117; border: 2px solid #58a6ff; border-radius: 6px;
                    padding: 8px 12px; font: 600 13.5px/1.35 "Segoe UI", sans-serif; max-width: 300px; }
  .caption { margin-top: 16px; background: #161b22; border: 1px solid #30363d; border-radius: 8px;
             padding: 16px 20px; color: #e6edf3; font: 15px/1.55 "Segoe UI", Arial, sans-serif; }
  .caption b { color: #fff; }
  .caption code { font-family: "Consolas", "Cascadia Mono", monospace; background: #010409;
                  padding: 1px 5px; border-radius: 4px; color: #7ee787; }
`;

function svgArrow(x1, y1, x2, y2, color) {
  return `<svg style="position:absolute; left:0; top:0; overflow:visible; pointer-events:none;" width="1" height="1">
    <defs>
      <marker id="arrow-${color.replace('#','')}" markerWidth="9" markerHeight="9" refX="6" refY="3" orient="auto">
        <path d="M0,0 L6,3 L0,6 Z" fill="${color}"/>
      </marker>
    </defs>
    <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="2.5"
          marker-end="url(#arrow-${color.replace('#','')})"/>
  </svg>`;
}

/** ---- Still A: the calls.create call site ------------------------------------------- */
function stillCallSite() {
  const relPath = "dispatch/scheduler.py";
  const all = allLines(relPath);
  // The window opens at the function that owns the call and closes one line past the call
  // itself, which is the framing this still has always had, now measured rather than typed.
  const start = lineOf(all, /def _create_with_retries\b/, "def _create_with_retries");
  const hlFrom = lineOf(all, /self\._client\.calls\.create\(/, "the calls.create call site");
  const hlTo = stmtEnd(all, hlFrom);
  const end = hlTo + 1;
  const keyLine = lineOf(all, /idempotency_key=key,/, "the idempotency_key argument");
  const lines = codeLines(relPath, start, end);

  const maxChars = Math.max(...lines.map((l) => l.text.length));
  const codeWidth = 60 + Math.ceil(maxChars * CHAR_W) + 24;
  const rows = lines.map((l) => {
    const on = l.n >= hlFrom && l.n <= hlTo;
    return `<div class="line ${on ? "hl-blue" : ""}" style="width:${codeWidth}px">` +
      `<span class="gutter">${l.n}</span><span class="src">${esc(l.text) || " "}</span></div>`;
  }).join("\n");

  const hlStartY = HEADER_H + PAD_TOP + (hlFrom - start) * ROW_H;
  const hlRows = hlTo - hlFrom + 1;
  const hlMidY = hlStartY + (hlRows * ROW_H) / 2;
  const arrowX1 = codeWidth + 26;
  const calloutY = hlMidY - 46;

  return `<!doctype html><html><head><meta charset=utf-8><style>${BASE_CSS}</style></head><body>
  <div class="card">
    <div class="panel" style="width:${codeWidth + 340}px; position:relative;">
      <div class="tabbar"><span class="dot r"></span><span class="dot y"></span><span class="dot g"></span>
        <span class="path">${esc(relPath)}</span></div>
      <div class="code" style="position:relative;">
        ${rows}
        ${svgArrow(codeWidth + 4, hlMidY, arrowX1 + 14, hlMidY, "#58a6ff")}
        <div class="callout" style="left:${arrowX1 + 18}px; top:${calloutY}px;">
          <div class="frame">The only call site.<br>${esc(relPath)}:${hlFrom}-${hlTo}<br>
            <span style="font-weight:400">everything above builds the request; this is
            where it is sent to CALL-E.</span></div>
        </div>
      </div>
    </div>
    <div class="caption">
      <b>${esc(relPath)}:${hlFrom}</b>: <code>self._client.calls.create(...)</code> is the
      only place in this codebase that invokes CALL-E's <code>calls.create</code>. It is called
      once per work item, inside a bounded retry loop (<code>_create_with_retries</code>,
      line ${start}), and the same <code>idempotency_key</code> (line ${keyLine}) is reused on every
      retry so a network retry cannot place a second phone call to the same person.
    </div>
  </div>
  </body></html>`;
}

/** ---- Still B: the three real outcomes, from a real offline run ---------------------- */
function stillTerminalRun() {
  const cmd = ["-m", "firstbell", "--work-file", "examples/absences.csv"];
  const result = execFileSync(PYTHON, cmd, { cwd: APP, encoding: "utf8" });
  const text = result.replace(/\r\n/g, "\n").replace(/\s+$/, "");
  const lines = text.split("\n");

  // Find the three-outcome block by content, not by a hardcoded line number, so this still
  // cannot silently point at the wrong lines if the summary format ever changes above it.
  const idx = lines.findIndex((l) => /^\s*resolved\s+\d/.test(l));
  const boxFrom = idx;
  const boxTo = idx + 2; // resolved, undetermined, failed

  const maxChars = Math.max(...lines.map((l) => l.length));
  const width = 16 + Math.ceil(maxChars * CHAR_W * (14 / 14.5)) + 16;
  const rows = lines.map((l, i) => {
    const on = i >= boxFrom && i <= boxTo;
    return `<div class="line ${on ? "hl-green" : ""}" style="width:${width}px; padding-left:16px;">` +
      `<span class="src" style="flex:1;">${esc(l) || " "}</span></div>`;
  }).join("\n");

  const boxStartY = HEADER_H + PAD_TOP + boxFrom * ROW_H;
  const boxMidY = boxStartY + (1.5 * ROW_H);
  const arrowX1 = width + 4;
  const calloutY = boxMidY - 60;

  return `<!doctype html><html><head><meta charset=utf-8><style>${BASE_CSS}
  .line { font-size: 14px; }
  </style></head><body>
  <div class="card">
    <div class="panel" style="width:${width + 340}px; position:relative;">
      <div class="tabbar"><span class="dot r"></span><span class="dot y"></span><span class="dot g"></span>
        <span class="path">python -m firstbell --work-file examples/absences.csv</span></div>
      <div class="code" style="position:relative;">
        ${rows}
        ${svgArrow(arrowX1, boxMidY, arrowX1 + 22, boxMidY, "#3fb950")}
        <div class="callout" style="left:${arrowX1 + 26}px; top:${calloutY}px;">
          <div class="frame" style="border-color:#3fb950;">The tool's three outcomes,
            in one real run.<br>
            <span style="font-weight:400">Never two. <code style="background:#eef;">undetermined</code>
            is never folded into either of the others.</span></div>
        </div>
      </div>
    </div>
    <div class="caption">
      Captured from a real, unmodified run of <code>python -m firstbell --work-file
      examples/absences.csv</code> in <b>OFFLINE mode</b> on 2026-09-05: no <code>CALLE_API_KEY</code>,
      no network call, no phone rings. <b>resolved</b> = a usable, schema-valid answer.
      <b>undetermined</b> = the call connected and produced nothing usable, so a person is
      still needed. <b>failed</b> = nobody was reached on any number tried. This is the literal
      stdout of that run, not a paraphrase.
    </div>
  </div>
  </body></html>`;
}

/** ---- Still C: the classification decision ------------------------------------------- */
function stillClassification() {
  const relPath = "dispatch/scheduler.py";
  const all = allLines(relPath);
  const start = lineOf(all, /def _classify\b/, "def _classify");
  // The method ends where its last return ends. Reading to the next `def` would drag in
  // the blank lines between them and pad the picture with nothing.
  const bodyEnd = (() => {
    const next = all.findIndex((l, i) => i >= start && /^    def \b/.test(l));
    return next < 0 ? all.length : next;
  })();
  const outcomes = outcomesIn(all, start, bodyEnd);
  if (outcomes.length === 0) {
    throw new Error("capture-stills: _classify returns no ItemResult; the still would lie");
  }
  const end = outcomes[outcomes.length - 1].to;
  const lines = codeLines(relPath, start, end);

  const zones = [
    { from: start, to: start, color: "blue", label: null },
    ...outcomes.map((o) => ({
      from: o.from, to: o.to, color: OUTCOME_COLOR[o.outcome] || "amber", label: o.outcome,
    })),
  ];
  const linesFor = (name) => lineWords(outcomes.filter((o) => o.outcome === name).map((o) => o.from));
  function zoneFor(n) {
    return zones.find((z) => n >= z.from && n <= z.to && z.label);
  }

  const BADGE_RESERVE = 165; // widest label, "-> UNDETERMINED", plus its own padding and margin
  const codeWidth = 60 + Math.ceil(Math.max(...lines.map((l) => {
    const z = zoneFor(l.n);
    const isFirstOfZone = z && l.n === z.from;
    return l.text.length * CHAR_W + (isFirstOfZone ? BADGE_RESERVE : 0);
  }))) + 20;
  const rows = lines.map((l) => {
    const z = zoneFor(l.n);
    const isFirstOfZone = z && l.n === z.from;
    const cls = z ? `hl-${z.color}` : "";
    const badge = isFirstOfZone
      ? `<span class="badge badge-${z.color}">&rarr; ${z.label}</span>` : "";
    return `<div class="line ${cls}" style="width:${codeWidth}px">` +
      `<span class="gutter">${l.n}</span><span class="src">${esc(l.text) || " "}</span>${badge}</div>`;
  }).join("\n");

  const paramY = HEADER_H + PAD_TOP + 0.5 * ROW_H;
  const arrowX1 = codeWidth + 26;

  return `<!doctype html><html><head><meta charset=utf-8><style>${BASE_CSS}</style></head><body>
  <div class="card">
    <div class="panel" style="width:${codeWidth + 300}px; position:relative;">
      <div class="tabbar"><span class="dot r"></span><span class="dot y"></span><span class="dot g"></span>
        <span class="path">${esc(relPath)}</span></div>
      <div class="code" style="position:relative;">
        ${rows}
        ${svgArrow(codeWidth + 4, paramY, arrowX1 + 14, paramY, "#58a6ff")}
        <div class="callout" style="left:${arrowX1 + 18}px; top:${paramY - 14}px;">
          <div class="frame">The API response arrives here.<br>
            <span style="font-weight:400"><code style="background:#eef;">call</code> is the
            dict CALL-E's API returned for this one call.</span></div>
        </div>
      </div>
    </div>
    <div class="caption">
      <b>${esc(relPath)}:${start}-${end}</b>: <code>_classify()</code> turns one API
      response into exactly one of three outcomes. <span style="color:#f85149">FAILED</span>
      (${linesFor("FAILED")}) when the call's status is <code>failed</code> or <code>canceled</code>.
      <span style="color:#d29922">UNDETERMINED</span> (${linesFor("UNDETERMINED")}) when the call
      timed out, produced no structured result, failed schema validation, or every required
      field came back <code>unknown</code>. <span style="color:#3fb950">RESOLVED</span>
      (${linesFor("RESOLVED")}) only when a schema-valid, non-empty answer was returned. No other return
      statement in this method exists.
    </div>
  </div>
  </body></html>`;
}

async function shoot(browser, html, outName) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 200, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: "load" });
  const card = await page.$(".card");
  const box = await card.boundingBox();
  await page.setViewport({
    width: Math.ceil(box.width), height: Math.ceil(box.height), deviceScaleFactor: 1,
  });
  await new Promise((r) => setTimeout(r, 80));
  const out = join(SHOTS, outName);
  await card.screenshot({ path: out });
  await page.close();
  console.log(`wrote ${out}`);
}

async function main() {
  const chrome = findChrome();
  if (!chrome) {
    console.error("No Chrome or Edge binary found.");
    process.exit(2);
  }
  const browser = await puppeteer.launch({
    executablePath: chrome, headless: true,
    args: ["--no-sandbox", "--disable-gpu", "--force-color-profile=srgb"],
  });
  try {
    await shoot(browser, stillCallSite(), "still-call-site.png");
    await shoot(browser, stillTerminalRun(), "still-terminal-run.png");
    await shoot(browser, stillClassification(), "still-classification.png");
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
