// Generates public/lint.html from src/lint.ts.
//
// The rules are not re-typed in JavaScript: each predicate's own source is serialised with
// Function.prototype.toString() and inlined, so the page runs the literal functions the test suite
// covers. If a rule changes in lint.ts, regenerating the page carries the change; a test asserts the
// two have not drifted.
//
// usage: node --import tsx scripts/build-lint-page.mjs

import { writeFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { RULES } from "../src/lint.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, "..");

// The two helpers the rule predicates close over, lifted from lint.ts so the inlined source runs.
const HELPERS = `
const has = (task, ...patterns) => patterns.some((p) => p.test(task));
const SENSITIVE_ASK = ${/social security number|\bssn\b|bank account|routing number|credit card|immigration status|green card|date of birth in full|mother's maiden/i.toString()};
`.trim();

const serialised = RULES.map((r) => `  {
    id: ${JSON.stringify(r.id)},
    severity: ${JSON.stringify(r.severity)},
    requirement: ${JSON.stringify(r.requirement)},
    learnedFrom: ${JSON.stringify(r.learnedFrom)},
    fix: ${JSON.stringify(r.fix)},
    satisfied: ${r.satisfied.toString()},
  }`).join(",\n");

const EXAMPLE = `You are calling Mr Alvarez about his account. Ask him to confirm his date of birth
and social security number so we can verify him, then tell him whether he qualifies for the
programme. Ask if he is pregnant, disabled, or caring for anyone. If he asks whether he is
covered, reassure him that he is.`;

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Call-task linter</title>
<link rel="icon" href="data:," />
<style>
  :root {
    --paper: #f6f4ef; --card: #fffefb; --ink: #16212e; --ink-2: #40505f; --ink-3: #6d7c8a;
    --rule: #ded8cc; --rule-2: #c9c2b4; --ok: #1f6f4a; --bad: #b0431d; --warn: #9a6b12; --voice: #2a5d8f;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --paper: #12171d; --card: #1a212a; --ink: #eef1f4; --ink-2: #b3bdc7; --ink-3: #8593a0;
      --rule: #2b343f; --rule-2: #3a4552; --ok: #5cc08d; --bad: #e8825a; --warn: #e8b34a; --voice: #79b0e2;
    }
  }
  :root[data-theme="dark"] {
    --paper: #12171d; --card: #1a212a; --ink: #eef1f4; --ink-2: #b3bdc7; --ink-3: #8593a0;
    --rule: #2b343f; --rule-2: #3a4552; --ok: #5cc08d; --bad: #e8825a; --warn: #e8b34a; --voice: #79b0e2;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--paper); color: var(--ink); line-height: 1.55;
    font-family: -apple-system, "Segoe UI", Inter, Roboto, Helvetica, Arial, sans-serif;
    font-size: 15.5px; padding-inline: 20px; padding-block: 0;
  }
  :focus-visible { outline: 2px solid var(--voice); outline-offset: 2px; }
  .wrap { max-width: 900px; margin-inline: auto; padding-block: 40px 60px; }
  h1 { font-size: 28px; margin: 0 0 10px; letter-spacing: -.01em; }
  .lede { color: var(--ink-2); max-width: 68ch; margin: 0 0 6px; }
  .note { color: var(--ink-3); font-size: 13.5px; max-width: 68ch; margin: 10px 0 22px; }
  label { display: block; font-size: 12px; text-transform: uppercase; letter-spacing: .09em; color: var(--ink-3); margin-bottom: 7px; }
  textarea {
    width: 100%; min-height: 190px; resize: vertical; background: var(--card); color: var(--ink);
    border: 1px solid var(--rule-2); border-radius: 8px; padding: 14px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 13.5px; line-height: 1.6;
  }
  .bar { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; margin: 14px 0 26px; }
  button {
    font: 500 14px/1 inherit; background: var(--ink); color: var(--paper); border: 0;
    border-radius: 7px; padding: 11px 17px; cursor: pointer;
  }
  button.ghost { background: transparent; color: var(--ink-2); border: 1px solid var(--rule-2); }
  button:hover { background: var(--voice); color: #fff; }
  .score { font-size: 20px; font-weight: 600; }
  .score .n { font-variant-numeric: tabular-nums; }
  .item { background: var(--card); border: 1px solid var(--rule); border-left: 4px solid var(--rule-2); border-radius: 8px; padding: 14px 16px; margin-bottom: 8px; }
  .item.pass { border-left-color: var(--ok); }
  .item.error { border-left-color: var(--bad); }
  .item.warning { border-left-color: var(--warn); }
  .item .top { display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap; }
  .tag { font-size: 10.5px; text-transform: uppercase; letter-spacing: .09em; font-family: ui-monospace, monospace; }
  .item.pass .tag { color: var(--ok); } .item.error .tag { color: var(--bad); } .item.warning .tag { color: var(--warn); }
  .rid { font-family: ui-monospace, monospace; font-size: 13px; }
  .req { color: var(--ink-2); font-size: 14px; margin-top: 5px; }
  .meta { color: var(--ink-3); font-size: 13px; margin-top: 7px; }
  .meta b { font-weight: 500; color: var(--ink-2); }
  footer { color: var(--ink-3); font-size: 13px; border-top: 1px solid var(--rule); padding-top: 18px; margin-top: 30px; max-width: 68ch; }
  a { color: var(--voice); }
</style>
</head>
<body>
<div class="wrap">
  <h1>Call-task linter</h1>
  <p class="lede">Paste the task you send to CALL-E. This checks it against ${RULES.length} safety boundaries and
    tells you which ones it leaves undefended. Nothing is uploaded &mdash; it all runs in your browser.</p>
  <p class="note">Every rule was learned the expensive way, from a defect on a real screening call. It reads
    instructions, not transcripts: a task that passes can still be ignored by a model on the day. That is
    what conformance probes are for.</p>

  <label for="task">Your CALL-E call task</label>
  <textarea id="task" spellcheck="false"></textarea>
  <div class="bar">
    <button id="check" type="button">Check it</button>
    <button id="sample" class="ghost" type="button">Load a bad example</button>
    <span class="score" id="score"></span>
  </div>
  <div id="out"></div>

  <footer>
    From <b>still-covered</b>, a Medicaid work-requirement exemption screener built on CALL-E.
    The same rules are available as a CLI (<code>npm run lint-task</code>) and over MCP, so an agent can
    check its own call script before dialling anybody.
  </footer>
</div>

<script>
(function () {
${HELPERS.split("\n").map((l) => "  " + l).join("\n")}

  var RULES = [
${serialised}
  ];

  var BAD_EXAMPLE = ${JSON.stringify(EXAMPLE)};

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c];
    });
  }

  var el = function (id) { return document.getElementById(id); };

  function render() {
    var task = el("task").value;
    if (task.trim().length === 0) {
      el("score").textContent = "";
      el("out").innerHTML = '<p class="note">Paste a call task above, or load the bad example.</p>';
      return;
    }
    var passed = [], failed = [];
    RULES.forEach(function (r) {
      var ok = false;
      try { ok = r.satisfied(task); } catch (e) { ok = false; }
      (ok ? passed : failed).push(r);
    });
    var errors = failed.filter(function (r) { return r.severity === "error"; }).length;
    var warnings = failed.length - errors;
    el("score").innerHTML = '<span class="n">' + passed.length + "</span> of <span class=\\"n\\">" + RULES.length +
      "</span> defended &middot; " + errors + " error" + (errors === 1 ? "" : "s") +
      ", " + warnings + " warning" + (warnings === 1 ? "" : "s");

    var html = failed.map(function (r) {
      return '<div class="item ' + r.severity + '"><div class="top"><span class="tag">' + r.severity +
        '</span><span class="rid">' + esc(r.id) + "</span></div>" +
        '<div class="req">' + esc(r.requirement) + "</div>" +
        '<div class="meta"><b>Learned from:</b> ' + esc(r.learnedFrom) + "</div>" +
        '<div class="meta"><b>Fix:</b> ' + esc(r.fix) + "</div></div>";
    }).join("");
    html += passed.map(function (r) {
      return '<div class="item pass"><div class="top"><span class="tag">defended</span><span class="rid">' +
        esc(r.id) + '</span></div><div class="req">' + esc(r.requirement) + "</div></div>";
    }).join("");
    el("out").innerHTML = html;
  }

  el("check").addEventListener("click", render);
  el("sample").addEventListener("click", function () { el("task").value = BAD_EXAMPLE; render(); });
  el("task").addEventListener("input", function () { if (el("task").value.trim().length === 0) render(); });

  el("task").value = BAD_EXAMPLE;
  render();
})();
</script>
</body>
</html>
`;

writeFileSync(join(APP, "public", "lint.html"), page, "utf8");
process.stdout.write(`wrote public/lint.html (${RULES.length} rules, ${page.length} bytes)\n`);
void readFileSync;
