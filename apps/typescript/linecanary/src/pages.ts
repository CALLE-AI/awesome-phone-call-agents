/**
 * The web surfaces, rendered server-side as pure functions of dashboard
 * state. No client framework; the only client JS is a theme toggle and the
 * sessionStorage restore that keeps open panels open across the 30-second
 * auto-refresh. Design implemented from the operator's Claude Design specs
 * (Operator Dashboard v3, Public Status Page v2).
 *
 * Transcripts and structured results are untrusted text from phone calls:
 * every dynamic value goes through escapeHtml before it touches markup.
 */

import type { CheckOutcome } from "./assert.js";
import type { CheckState, DashboardState, LineState } from "./state.js";

/**
 * Full entity escape for the two contexts this module renders into: text
 * nodes and quoted attribute values. This is output ENCODING (no HTML is
 * ever allowed through), not sanitization of permitted markup — a
 * sanitizer library would be the wrong tool and a new dependency. Escaped
 * values must never be placed in unquoted attributes, URLs, script or
 * style contexts; nothing in this module does.
 */
export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function relativeTime(iso: string, nowMs: number): string {
  const seconds = Math.max(0, Math.round((nowMs - Date.parse(iso)) / 1000));
  if (seconds < 90) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

function humanizeStamps(text: string): string {
  return text.replaceAll(/(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}):\d{2}(?:\.\d+)?Z?/g, "$1 $2 UTC");
}

function offsetStamp(seconds: number | null): string {
  if (seconds === null) return "--:--";
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

const FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">`;

const SANS = `'Figtree',system-ui,-apple-system,sans-serif`;
const MONO = `'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,monospace`;

/* ---------------------------------------------------------------- dashboard */

const DASHBOARD_CSS = `
*{box-sizing:border-box;margin:0;padding:0}
html{background:var(--bg)}
body{min-height:100vh;font-family:${SANS};-webkit-font-smoothing:antialiased}
a{color:#8A6D00;text-decoration:none}
a:hover{color:#5C4900;text-decoration:underline}
a.quiet{color:inherit}
a.quiet:hover{color:inherit;text-decoration:underline}
summary::-webkit-details-marker{display:none}
summary{list-style:none}
.caret{display:inline-block;transition:transform .15s ease;font-size:10px;flex:none}
details[open] > summary .caret{transform:rotate(90deg)}
@keyframes breathe{0%,100%{box-shadow:0 0 0 0 rgba(245,197,24,.55)}50%{box-shadow:0 0 0 11px rgba(245,197,24,0)}}
@keyframes pulse-red{0%,100%{box-shadow:0 0 0 0 rgba(224,82,72,.4)}50%{box-shadow:0 0 0 9px rgba(224,82,72,0)}}
@media (prefers-reduced-motion: reduce){.dot-live{animation:none !important}}
:root{
  --bg:#F6F6F3;--card:#FFFFFF;--card2:#F7F7F4;--border:#E8E7E1;--border2:#DEDDD6;
  --text:#1D1C19;--muted:#6E6C63;--faint:#9C9A90;
  --ok:#15803D;--okBg:#E7F5EC;--okBd:#CBE8D5;
  --bad:#C0392B;--badBg:#FCECEA;--badBd:#F3D1CC;
  --warn:#8A6100;--warnBg:#FAF1D8;--warnBd:#EDDFB2;
  --canary:#F5C518;--canaryBg:#FDF4D0;--canaryBd:#F0DE9A;
  --sparkOk:#C6CCC2;--shadow:0 1px 2px rgba(20,20,15,.05);
}
:root[data-theme="dark"]{
  --bg:#101113;--card:#17181B;--card2:#101114;--border:#26272C;--border2:#32343A;
  --text:#ECEDEE;--muted:#9A9CA3;--faint:#6B6E76;
  --ok:#4ADE80;--okBg:rgba(74,222,128,.1);--okBd:rgba(74,222,128,.25);
  --bad:#F87171;--badBg:rgba(248,113,113,.1);--badBd:rgba(248,113,113,.28);
  --warn:#FBBF24;--warnBg:rgba(251,191,36,.09);--warnBd:rgba(251,191,36,.28);
  --canary:#F5C518;--canaryBg:rgba(245,197,24,.12);--canaryBd:rgba(245,197,24,.3);
  --sparkOk:#3B4149;--shadow:none;
}
body{background:var(--bg);color:var(--text);transition:background-color .25s ease}
.wrap{max-width:1020px;margin:0 auto;padding:0 28px 72px}
.masthead{display:flex;align-items:center;gap:12px;padding:20px 0 18px;flex-wrap:wrap}
.logo{width:26px;height:26px;border-radius:8px;background:#F5C518;display:flex;align-items:center;justify-content:center;flex:none}
.logo i{width:8px;height:8px;border-radius:50%;background:#1D1C19}
.wordmark{font-size:17px;font-weight:800;letter-spacing:-.02em}
.spacer{flex:1}
.masthead .hint{font-size:12.5px;color:var(--faint)}
.masthead .status-link{font-size:13px;font-weight:600}
.theme{display:flex;border:1px solid var(--border);border-radius:8px;overflow:hidden;margin-left:6px}
.theme button{font-family:${SANS};font-size:12px;font-weight:600;padding:6px 12px;border:none;cursor:pointer;background:transparent;color:var(--muted)}
.theme button[data-active]{background:#F5C518;color:#1D1C19}
.banner{display:flex;align-items:center;gap:16px;background:var(--card);border:1px solid var(--border);border-radius:14px;padding:22px 24px;box-shadow:var(--shadow);flex-wrap:wrap}
.dot-live{width:12px;height:12px;border-radius:50%;flex:none}
.banner h1{font-size:20px;font-weight:700;letter-spacing:-.01em}
.banner .sub{font-size:13.5px;color:var(--muted);margin-top:3px}
.banner .stats{font-size:13px;color:var(--muted);text-align:right;margin-left:auto}
.line{background:var(--card);border:1px solid var(--border);border-radius:14px;margin-top:16px;box-shadow:var(--shadow);overflow:hidden}
.line.unverified{border-style:dashed;border-color:var(--border2);box-shadow:none}
.line-head{display:flex;align-items:center;gap:12px;padding:16px 20px;flex-wrap:wrap}
.line-head h2,.line-summary h2{font-size:16px;font-weight:700;letter-spacing:-.01em}
.line-head .sub,.line-summary .sub{font-family:${MONO};font-size:11px;color:var(--faint);margin-top:3px}
.pill{font-size:11.5px;font-weight:600;border-radius:99px;padding:3px 10px;white-space:nowrap}
.pill.ok{color:var(--ok);background:var(--okBg);border:1px solid var(--okBd)}
.pill.bad{color:var(--bad);background:var(--badBg);border:1px solid var(--badBd)}
.pill.bad.strong,.pill.ok.strong{font-weight:700;padding:4px 11px}
.pill.warn{color:var(--warn);background:var(--warnBg);border:1px solid var(--warnBd);font-weight:700;padding:4px 11px}
.pill.ghost{color:var(--faint);border:1px solid var(--border);background:transparent}
.pill.outline-bad{color:var(--bad);border:1px solid var(--badBd);background:var(--card)}
.pill.outline-ok{color:var(--ok);border:1px solid var(--okBd);background:transparent}
.pill.outline-warn{color:var(--warn);border:1px solid var(--warnBd);background:var(--warnBg)}
.row{display:flex;align-items:center;gap:14px;padding:13px 20px;border-top:1px solid var(--border);flex-wrap:wrap}
.row .lead{width:10px;flex:none}
.row-main{flex:1;min-width:180px}
.row-main .name{font-size:14px;font-weight:600}
.row-main .meta{font-family:${MONO};font-size:10.5px;color:var(--faint);margin-top:2px}
.failing-summary .row-main .name{font-weight:700}
.spark{display:flex;align-items:flex-end;gap:1px;height:16px;flex:none}
.spark i{width:2px;border-radius:1px;display:inline-block}
.answer{text-align:right;min-width:104px;flex:none}
.answer .big{display:block;font-size:12.5px;font-weight:600}
.answer .big.warn-text{color:var(--warn)}
.answer .when{display:block;font-size:11px;color:var(--faint);margin-top:1px}
.status-pill{font-size:12px;font-weight:700;border-radius:99px;padding:4px 12px;flex:none}
.status-pill.ok{color:var(--ok);background:var(--okBg);border:1px solid var(--okBd)}
.status-pill.bad{color:var(--bad);background:var(--badBg);border:1px solid var(--badBd)}
.failing-summary{cursor:pointer;display:flex;align-items:center;gap:14px;padding:13px 20px;background:var(--badBg);flex-wrap:wrap;border-top:1px solid var(--border)}
.failing-body{padding:16px 20px 20px;display:flex;flex-direction:column;gap:14px;border-top:1px solid var(--border)}
.assert-chip{font-family:${MONO};font-size:12px;color:var(--bad);background:var(--card2);border:1px solid var(--border);border-radius:8px;padding:9px 12px;align-self:flex-start;max-width:100%;overflow-wrap:anywhere}
.heard{background:var(--card2);border:1px solid var(--border);border-radius:12px;padding:18px 20px;max-width:760px}
.heard-head{display:flex;align-items:baseline;gap:10px;margin-bottom:14px;flex-wrap:wrap}
.heard-head .t{font-size:13.5px;font-weight:700}
.heard-head .m{font-family:${MONO};font-size:10.5px;color:var(--faint)}
.convo{display:flex;flex-direction:column;gap:12px}
.turn{max-width:78%;display:flex;flex-direction:column;gap:4px}
.turn .who{font-family:${MONO};font-size:10px;color:var(--faint)}
.turn.canary{align-self:flex-end;align-items:flex-end}
.turn.line-side{align-self:flex-start}
.bubble{padding:9px 13px;font-size:13.5px;line-height:1.5;overflow-wrap:anywhere}
.turn.canary .bubble{background:var(--canaryBg);border:1px solid var(--canaryBd);border-radius:14px 14px 4px 14px}
.turn.line-side .bubble{background:var(--card);border:1px solid var(--border2);border-radius:14px 14px 14px 4px}
.dead-air{align-self:stretch;border:1px dashed var(--border2);border-radius:10px;padding:16px;display:flex;flex-direction:column;align-items:center;gap:5px}
.dead-air .dots{font-family:${MONO};font-size:12px;letter-spacing:.5em;color:var(--faint)}
.dead-air .label{font-size:12px;font-weight:700;color:var(--bad);letter-spacing:.04em}
.dead-air .expl{font-size:12px;color:var(--muted);text-align:center}
.not-recorded{font-size:12.5px;color:var(--faint);font-style:italic}
.prev-call{margin-top:14px;border-top:1px dashed var(--border2);padding-top:10px}
.prev-call > summary{cursor:pointer;display:flex;align-items:center;gap:7px;font-size:12px;font-weight:600;color:var(--muted)}
.prev-call .convo{margin-top:12px;opacity:.75}
.note-card{background:var(--card);border:1px solid var(--canaryBd);border-radius:12px;padding:16px 20px;max-width:760px;display:flex;flex-direction:column;gap:10px}
.note-head{display:flex;align-items:center;gap:9px;flex-wrap:wrap}
.note-head .sq{width:8px;height:8px;border-radius:2px;background:var(--canary);flex:none}
.note-head .t{font-size:13.5px;font-weight:700}
.note-head .ai{font-size:10.5px;font-weight:600;color:var(--warn);background:var(--warnBg);border:1px solid var(--warnBd);border-radius:99px;padding:2px 8px}
.note-head .when{font-size:11px;color:var(--faint)}
.note-body{font-size:13.5px;line-height:1.6;color:var(--text);white-space:pre-wrap;overflow-wrap:anywhere}
.unverified-body{border-top:1px solid var(--border);padding:16px 20px;display:flex;flex-direction:column;gap:12px}
.unverified-body .expl{font-size:13.5px;line-height:1.6;color:var(--muted);max-width:700px}
.code{font-family:${MONO};font-size:12px;color:var(--warn)}
.never-run{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.never-run .name{font-size:13.5px;font-weight:600;color:var(--muted)}
.never-run .meta{font-family:${MONO};font-size:10.5px;color:var(--faint)}
.line-summary{cursor:pointer;display:flex;align-items:center;gap:12px;padding:16px 20px;flex-wrap:wrap}
.log-head{margin-top:16px;background:var(--card);border:1px solid var(--border);border-radius:14px;box-shadow:var(--shadow);padding:18px 20px;display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.log-head h1{font-size:18px;font-weight:700;letter-spacing:-.01em}
.log-head .sub{font-family:${MONO};font-size:11px;color:var(--faint);margin-top:3px}
.call{background:var(--card);border:1px solid var(--border);border-radius:14px;margin-top:12px;box-shadow:var(--shadow);overflow:hidden}
.call > details > summary{cursor:pointer;display:flex;align-items:center;gap:14px;padding:13px 20px;flex-wrap:wrap}
.call.bad > details > summary{background:var(--badBg)}
.call .when-block{flex:1;min-width:200px}
.call .when-block .t{font-size:13.5px;font-weight:600}
.call .when-block .m{font-family:${MONO};font-size:10.5px;color:var(--faint);margin-top:2px}
.call-body{padding:16px 20px 20px;display:flex;flex-direction:column;gap:14px;border-top:1px solid var(--border)}
footer{display:flex;align-items:center;gap:9px;margin-top:36px}
footer .dot{width:8px;height:8px;border-radius:50%;background:var(--canary);flex:none}
footer span{font-size:12px;color:var(--faint)}
`;

const STATUS_LABEL: Record<string, string> = { pass: "Passing", fail: "Failing", error: "Call error" };

const THEME_BOOT = `<script>
if (localStorage.getItem("lc-theme") === "dark") document.documentElement.dataset.theme = "dark";
</script>`;

const OPERATOR_SCRIPTS = `<script>
(() => {
  // Theme toggle, persisted across visits.
  const root = document.documentElement;
  const light = document.getElementById("theme-light");
  const dark = document.getElementById("theme-dark");
  const paint = () => {
    const isDark = root.dataset.theme === "dark";
    dark.toggleAttribute("data-active", isDark);
    light.toggleAttribute("data-active", !isDark);
  };
  light.addEventListener("click", () => { delete root.dataset.theme; localStorage.setItem("lc-theme", "light"); paint(); });
  dark.addEventListener("click", () => { root.dataset.theme = "dark"; localStorage.setItem("lc-theme", "dark"); paint(); });
  paint();

  // Pages reload themselves; restore whatever the reader had open or closed
  // so the refresh is invisible. State lives in sessionStorage.
  const KEY = "linecanary-open";
  const overrides = new Map(JSON.parse(sessionStorage.getItem(KEY) ?? "[]"));
  for (const details of document.querySelectorAll("details[data-remember]")) {
    const key = details.dataset.remember;
    if (overrides.has(key)) details.open = overrides.get(key);
    details.addEventListener("toggle", () => {
      overrides.set(key, details.open);
      sessionStorage.setItem(KEY, JSON.stringify([...overrides]));
    });
  }
})();
</script>`;

function sparkline(check: CheckState): string {
  const recent = check.history.slice(-24);
  if (recent.length === 0) return "";
  const passValues = recent
    .filter((outcome) => outcome.status === "pass")
    .map((outcome) => outcome.timing.secondsToAnswer)
    .filter((value): value is number => value !== null);
  const median = passValues.length === 0 ? null : [...passValues].sort((a, b) => a - b)[Math.floor(passValues.length / 2)];
  const max = Math.max(...passValues, 1);
  const bars = recent
    .map((outcome) => {
      const title = `${humanizeStamps(outcome.at)} · ${outcome.status}${outcome.timing.secondsToAnswer === null ? "" : ` · ${outcome.timing.secondsToAnswer}s`}`;
      if (outcome.status !== "pass") {
        return `<i style="height:15px;background:var(--bad)" title="${escapeHtml(title)}"></i>`;
      }
      const value = outcome.timing.secondsToAnswer ?? 0;
      const slow = median !== null && value > 2 * median && value - median > 4;
      const height = Math.max(4, Math.round((value / max) * 10));
      return `<i style="height:${slow ? height + 4 : height}px;background:${slow ? "var(--warn)" : "var(--sparkOk)"}" title="${escapeHtml(title)}"></i>`;
    })
    .join("");
  return `<span class="spark" aria-label="answer time trend">${bars}</span>`;
}

function eventPill(check: CheckState): string {
  for (const regression of check.regressions) {
    if (regression.kind === "recovered") {
      return `<span class="pill outline-ok">Recovered · ${escapeHtml(humanizeStamps(regression.detail.replace("recovered at ", "")))}</span>`;
    }
    if (regression.kind === "timing_regressed") {
      return `<span class="pill outline-warn">Slower than usual</span>`;
    }
  }
  return "";
}

function answerBlock(outcome: CheckOutcome, nowMs: number, warn = false): string {
  const big =
    outcome.timing.secondsToAnswer === null ? "No answer measured" : `Answered in ${outcome.timing.secondsToAnswer}s`;
  return `<span class="answer"><span class="big${warn ? " warn-text" : ""}">${escapeHtml(big)}</span><span class="when" title="${escapeHtml(outcome.at)}">${relativeTime(outcome.at, nowMs)}</span></span>`;
}

function conversation(outcome: CheckOutcome): string {
  if (outcome.transcript === undefined) {
    return `<p class="not-recorded">Transcript not recorded for this run.</p>`;
  }
  const turns = outcome.transcript;
  const lineTurns = turns.filter((turn) => turn.speaker !== "bot");
  const bubbles = turns
    .map((turn) => {
      const canary = turn.speaker === "bot";
      return `<div class="turn ${canary ? "canary" : "line-side"}">
  <span class="who">${canary ? "CANARY" : "LINE"} · ${offsetStamp(turn.offsetSeconds)}</span>
  <div class="bubble">${escapeHtml(turn.text)}</div>
</div>`;
    })
    .join("\n");
  const deadAir =
    lineTurns.length === 0
      ? `<div class="dead-air"><span class="dots">· · · · · · · · · · · · · ·</span><span class="label">DEAD AIR</span><span class="expl">The call connected — no audio detected from the line. This is what your callers hear.</span></div>`
      : "";
  return `<div class="convo">${bubbles}${deadAir === "" ? "" : `\n${deadAir}`}</div>`;
}

function heardPanel(check: CheckState, latest: CheckOutcome): string {
  const duration =
    latest.transcript !== undefined && latest.transcript.length > 0
      ? offsetStamp(latest.transcript[latest.transcript.length - 1].offsetSeconds)
      : null;
  const meta = [duration, `recorded ${humanizeStamps(latest.at)}`].filter((part): part is string => part !== null).join(" · ");
  const passes = check.history.filter((outcome) => outcome.status === "pass");
  const lastPass = passes.length === 0 ? null : passes[passes.length - 1];
  const previous =
    lastPass === null || lastPass.callId === latest.callId
      ? ""
      : `<details class="prev-call" data-remember="${escapeHtml(check.id)}:prev">
  <summary><span class="caret">▶</span> See the last passing call · ${escapeHtml(humanizeStamps(lastPass.at))}</summary>
  ${conversation(lastPass)}
</details>`;
  return `<div class="heard">
  <div class="heard-head"><span class="t">What the canary heard</span><span class="m">${escapeHtml(meta)}</span></div>
  ${conversation(latest)}
  ${previous}
</div>`;
}

function failingCheck(check: CheckState, latest: CheckOutcome, nowMs: number): string {
  const failures = [
    ...latest.assertions.filter((entry) => !entry.pass).map((entry) => `${entry.assertion.path}: ${entry.detail}`),
    ...latest.timingViolations,
    ...(latest.confidenceViolation === null ? [] : [latest.confidenceViolation]),
    ...(latest.status === "error" ? [`call error: ${latest.failureCode ?? "unknown"}`] : []),
  ];
  const chips = failures.map((entry) => `<div class="assert-chip">${escapeHtml(entry)}</div>`).join("\n");
  const stillFailing = check.regressions.some((entry) => entry.kind === "still_failing");
  const headline = stillFailing ? "Still failing" : latest.status === "error" ? "Call did not complete" : "Different answer than expected";
  const note =
    check.note === null
      ? ""
      : `<div class="note-card">
  <div class="note-head"><span class="sq"></span><span class="t">What happened</span><span class="ai">AI summary</span><span class="when">${relativeTime(check.note.at, nowMs)}</span></div>
  <div class="note-body">${escapeHtml(check.note.markdown)}</div>
</div>`;
  const confidence = latest.confidence === null ? "" : ` · match confidence ${Math.round(latest.confidence * 100)}%`;
  return `<details data-remember="${escapeHtml(check.id)}" open>
  <summary class="failing-summary">
    <span class="caret" style="color:var(--bad)">▶</span>
    <div class="row-main"><div class="name"><a class="quiet" href="/check/${encodeURIComponent(check.id)}">${escapeHtml(check.name)}</a></div><div class="meta">${escapeHtml(check.id)}${escapeHtml(confidence)}</div></div>
    <span class="pill outline-bad">${escapeHtml(headline)}</span>
    ${sparkline(check)}
    ${answerBlock(latest, nowMs)}
    <span class="status-pill bad">${STATUS_LABEL[latest.status] ?? escapeHtml(latest.status)}</span>
  </summary>
  <div class="failing-body">
    ${chips}
    ${heardPanel(check, latest)}
    ${note}
  </div>
</details>`;
}

function passingCheck(check: CheckState, latest: CheckOutcome, nowMs: number): string {
  const confidence = latest.confidence === null ? "" : ` · match confidence ${Math.round(latest.confidence * 100)}%`;
  const timingWarn = check.regressions.some((entry) => entry.kind === "timing_regressed");
  return `<div class="row">
  <span class="lead"></span>
  <div class="row-main"><div class="name"><a class="quiet" href="/check/${encodeURIComponent(check.id)}">${escapeHtml(check.name)}</a></div><div class="meta">${escapeHtml(check.id)}${escapeHtml(confidence)}</div></div>
  ${eventPill(check)}
  ${sparkline(check)}
  ${answerBlock(latest, nowMs, timingWarn)}
  <span class="status-pill ok">Passing</span>
</div>`;
}

function neverRunCheck(check: CheckState): string {
  return `<div class="row never-run">
  <span class="lead"></span>
  <span class="name">${escapeHtml(check.name)}</span>
  <span class="meta">${escapeHtml(check.id)}</span>
  <span class="pill ghost">Never run</span>
</div>`;
}

function lineHeader(line: LineState): string {
  const failing = line.checks.filter((check) => check.latest !== null && check.latest.status !== "pass").length;
  const verifiedPill =
    line.verification === null
      ? ""
      : `<span class="pill ok">Verified · ${escapeHtml(line.verification.method.replaceAll("_", " "))}</span>`;
  const healthPill =
    line.verification === null
      ? `<span class="pill warn">Unverified — checks will not run</span>`
      : failing > 0
        ? `<span class="pill bad strong">${failing} check${failing === 1 ? "" : "s"} failing</span>`
        : `<span class="pill ok strong">All ${line.checks.length} check${line.checks.length === 1 ? "" : "s"} passing</span>`;
  return `<div><h2>${escapeHtml(line.name)}</h2><div class="sub">${escapeHtml(line.id)} · ${escapeHtml(line.maskedPhone)}</div></div>
  ${verifiedPill}
  <span class="spacer"></span>
  ${healthPill}`;
}

function lineSection(line: LineState, nowMs: number, ownershipCode: string | null): string {
  if (line.verification === null) {
    const hint =
      ownershipCode === null
        ? `Record a written authorization for this line, then run <span class="code">linecanary verify ${escapeHtml(line.id)}</span>.`
        : `To prove you own this line, add the greeting code <span class="code">&quot;Canary ID, ${escapeHtml(ownershipCode)}&quot;</span> to its greeting recording, then run <span class="code">linecanary verify ${escapeHtml(line.id)}</span>. Once heard, these checks start running.`;
    return `<section class="line unverified">
  <details data-remember="line:${escapeHtml(line.id)}">
    <summary class="line-summary"><span class="caret" style="color:var(--faint)">▶</span>${lineHeader(line)}</summary>
    <div class="unverified-body">
      <div class="expl">${hint}</div>
      ${line.checks.map((check) => neverRunCheck(check)).join("\n")}
    </div>
  </details>
</section>`;
  }

  const rows = line.checks
    .map((check) => {
      if (check.latest === null) return neverRunCheck(check);
      return check.latest.status === "pass" ? passingCheck(check, check.latest, nowMs) : failingCheck(check, check.latest, nowMs);
    })
    .join("\n");

  if (line.health === "ok") {
    return `<section class="line">
  <details data-remember="line:${escapeHtml(line.id)}">
    <summary class="line-summary"><span class="caret" style="color:var(--faint)">▶</span>${lineHeader(line)}</summary>
    <div style="border-top:1px solid var(--border)">${rows}</div>
  </details>
</section>`;
  }
  return `<section class="line">
  <div class="line-head">${lineHeader(line)}</div>
  ${rows}
</section>`;
}

export function renderDashboard(state: DashboardState, ownershipCodes: Record<string, string | null> = {}): string {
  const nowMs = Date.parse(state.generatedAt);
  const attention = state.lines.filter((line) => line.health === "attention");
  const stats = `${state.totals.lines} line${state.totals.lines === 1 ? "" : "s"} · ${state.totals.checks} check${state.totals.checks === 1 ? "" : "s"}<br>${state.totals.callsToday} test call${state.totals.callsToday === 1 ? "" : "s"} today`;
  const banner = state.allClear
    ? `<div class="banner">
  <div class="dot-live" style="background:#F5C518;animation:breathe 2.6s ease-in-out infinite"></div>
  <div><h1>The canary is singing — all lines healthy</h1><div class="sub">Every check on every line passed its latest test call.</div></div>
  <div class="stats">${stats}</div>
</div>`
    : `<div class="banner">
  <div class="dot-live" style="background:var(--bad);animation:pulse-red 2s ease-in-out infinite"></div>
  <div><h1>${attention.length} line${attention.length === 1 ? "" : "s"} need${attention.length === 1 ? "s" : ""} attention</h1><div class="sub">${state.totals.passing} of ${state.totals.checks} checks are passing. The ones that aren't are opened below with what the canary heard.</div></div>
  <div class="stats">${stats}</div>
</div>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="30">
<title>LineCanary — line health</title>
${FONTS}
<style>${DASHBOARD_CSS}</style>
${THEME_BOOT}
</head>
<body>
<div class="wrap">
<header class="masthead">
  <div class="logo"><i></i></div>
  <div class="wordmark">LineCanary</div>
  <span class="spacer"></span>
  <span class="hint">Updates every 30 seconds</span>
  <a class="status-link" href="/status">Public status page →</a>
  <div class="theme">
    <button id="theme-light" type="button">Light</button>
    <button id="theme-dark" type="button">Dark</button>
  </div>
</header>
${banner}
${state.lines.map((line) => lineSection(line, nowMs, ownershipCodes[line.id] ?? null)).join("\n")}
<footer><div class="dot"></div><span>LineCanary · every result above comes from a real phone call · calls roll up into each check's 24-run trend</span></footer>
</div>
${OPERATOR_SCRIPTS}
</body>
</html>`;
}

/* ---------------------------------------------------------------- call log */

function callEntry(check: CheckState, outcome: CheckOutcome, nowMs: number, open: boolean): string {
  const bad = outcome.status !== "pass";
  const failures = [
    ...outcome.assertions.filter((entry) => !entry.pass).map((entry) => `${entry.assertion.path}: ${entry.detail}`),
    ...outcome.timingViolations,
    ...(outcome.confidenceViolation === null ? [] : [outcome.confidenceViolation]),
    ...(outcome.status === "error" ? [`call error: ${outcome.failureCode ?? "unknown"}`] : []),
  ];
  const chips = failures.map((entry) => `<div class="assert-chip">${escapeHtml(entry)}</div>`).join("\n");
  const confidence = outcome.confidence === null ? "" : ` · confidence ${Math.round(outcome.confidence * 100)}%`;
  return `<div class="call${bad ? " bad" : ""}">
  <details data-remember="call:${escapeHtml(outcome.callId)}"${open ? " open" : ""}>
    <summary>
      <span class="caret"${bad ? ' style="color:var(--bad)"' : ""}>▶</span>
      <div class="when-block">
        <div class="t">${escapeHtml(humanizeStamps(outcome.at))}</div>
        <div class="m">${escapeHtml(outcome.callId)}${escapeHtml(confidence)}</div>
      </div>
      ${answerBlock(outcome, nowMs)}
      <span class="status-pill ${bad ? "bad" : "ok"}">${STATUS_LABEL[outcome.status] ?? escapeHtml(outcome.status)}</span>
    </summary>
    <div class="call-body">
      ${chips}
      <div class="heard">
        <div class="heard-head"><span class="t">What the canary heard</span></div>
        ${conversation(outcome)}
      </div>
    </div>
  </details>
</div>`;
}

/** Every stored call for one check, newest first — the call log. */
export function renderCheckLog(line: LineState, check: CheckState, generatedAt: string): string {
  const nowMs = Date.parse(generatedAt);
  const calls = [...check.history].reverse();
  const latest = check.latest;
  const statusPill =
    latest === null
      ? `<span class="pill ghost">Never run</span>`
      : `<span class="status-pill ${latest.status === "pass" ? "ok" : "bad"}">${STATUS_LABEL[latest.status] ?? escapeHtml(latest.status)}</span>`;
  const entries =
    calls.length === 0
      ? `<div class="call"><div class="call-body" style="border-top:none">No calls recorded yet.</div></div>`
      : calls.map((outcome, index) => callEntry(check, outcome, nowMs, index === 0)).join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="30">
<title>${escapeHtml(check.name)} — call log · LineCanary</title>
${FONTS}
<style>${DASHBOARD_CSS}</style>
${THEME_BOOT}
</head>
<body>
<div class="wrap">
<header class="masthead">
  <div class="logo"><i></i></div>
  <div class="wordmark">LineCanary</div>
  <span class="spacer"></span>
  <a class="status-link" href="/">← Back to dashboard</a>
  <div class="theme">
    <button id="theme-light" type="button">Light</button>
    <button id="theme-dark" type="button">Dark</button>
  </div>
</header>
<div class="log-head">
  <div>
    <h1>${escapeHtml(check.name)} — call log</h1>
    <div class="sub">${escapeHtml(check.id)} · ${escapeHtml(line.name)} · ${escapeHtml(line.maskedPhone)} · ${calls.length} call${calls.length === 1 ? "" : "s"} on record</div>
  </div>
  <span class="spacer"></span>
  ${sparkline(check)}
  ${statusPill}
</div>
${entries}
<footer><div class="dot"></div><span>Every entry is one real phone call. History keeps the most recent 50 calls per check.</span></footer>
</div>
${OPERATOR_SCRIPTS}
</body>
</html>`;
}

/* --------------------------------------------------------------- status page */

const STATUS_CSS = `
*{box-sizing:border-box;margin:0;padding:0}
html,body{background:#FBFAF7}
body{font-family:${SANS};color:#1D1C19;-webkit-font-smoothing:antialiased}
a{color:#8A6D00;text-decoration:none}
a:hover{color:#5C4900;text-decoration:underline}
.page{min-height:100vh;display:flex;flex-direction:column;align-items:center;padding:64px 24px 48px}
.col{width:100%;max-width:640px;display:flex;flex-direction:column}
.eyebrow{display:flex;align-items:center;gap:8px}
.eyebrow .mark{width:16px;height:16px;border-radius:5px;background:#F5C518;display:inline-flex;align-items:center;justify-content:center}
.eyebrow .mark i{width:5px;height:5px;border-radius:50%;background:#1D1C19}
.eyebrow span{font-size:12px;font-weight:700;letter-spacing:.1em;color:#8A867C;text-transform:uppercase}
h1{font-size:30px;font-weight:800;letter-spacing:-.02em;margin-top:14px}
h2{font-size:17px;font-weight:700;margin-top:40px}
.state{display:flex;align-items:center;gap:11px;margin-top:24px}
.state .dot{width:13px;height:13px;border-radius:50%;flex:none}
.state .t{font-size:21px;font-weight:700}
.state.ok .dot{background:#1F9D62}
.state.ok .t{color:#15803D}
.state.bad .dot{background:#D64545}
.state.bad .t{color:#B93B3B}
.verified{font-size:14px;color:#6E6C63;margin-top:8px}
.ticks-head{display:flex;align-items:baseline;justify-content:space-between;margin-top:36px}
.ticks-head .t{font-size:13.5px;font-weight:700;color:#4A4740}
.ticks-head .m{font-family:${MONO};font-size:11px;color:#9C9890}
.ticks{display:flex;align-items:center;gap:3px;height:34px;margin-top:10px}
.ticks i{width:3px;border-radius:2px;flex:none}
.ticks-cap{font-size:12px;color:#9C9890;margin-top:8px}
.checks{margin-top:34px;border-top:1px solid #E7E4DC}
.check-row{display:flex;align-items:center;justify-content:space-between;padding:14px 0;border-bottom:1px solid #EEEBE3;gap:12px}
.check-row .n{font-size:14.5px;font-weight:600}
.check-row .r{display:flex;align-items:center;gap:10px}
.check-row .a{font-family:${MONO};font-size:12px;color:#6E6C63}
.check-row .a.bad{color:#B93B3B}
.badge{font-size:11.5px;font-weight:700;border-radius:99px;padding:3px 11px}
.badge.ok{color:#15803D;background:#E7F5EC;border:1px solid #CBE8D5}
.badge.bad{color:#B93B3B;background:#FCECEA;border:1px solid #F3D1CC}
.privacy{font-size:12.5px;line-height:1.65;color:#9C9890;margin-top:26px;max-width:520px}
.foot{display:flex;align-items:center;gap:10px;margin-top:44px;padding-top:16px;border-top:1px solid #E7E4DC}
.foot .dot{width:9px;height:9px;border-radius:50%;background:#F5C518;border:1px solid #D8AE0E;flex:none}
.foot .t{font-size:13px;font-weight:700;color:#4A4740}
`;

/** Public, client-facing artifact: no tasks, no transcripts, no numbers. */
export function renderStatus(state: DashboardState, title = "Phone line status", lineId?: string): string {
  const nowMs = Date.parse(state.generatedAt);
  const lines = lineId === undefined ? state.lines : state.lines.filter((line) => line.id === lineId);
  const sections = lines
    .map((line) => {
      const failingCount = line.checks.filter((check) => check.latest !== null && check.latest.status !== "pass").length;
      const runs = line.checks
        .flatMap((check) => check.history.slice(-30))
        .sort((a, b) => a.at.localeCompare(b.at))
        .slice(-60);
      const passSeconds = runs
        .filter((outcome) => outcome.status === "pass")
        .map((outcome) => outcome.timing.secondsToAnswer)
        .filter((value): value is number => value !== null);
      const maxSeconds = Math.max(...passSeconds, 1);
      const ticks = runs
        .map((outcome) => {
          if (outcome.status !== "pass") return `<i style="height:28px;background:#D64545"></i>`;
          const height = 12 + Math.round(((outcome.timing.secondsToAnswer ?? maxSeconds / 2) / maxSeconds) * 14);
          return `<i style="height:${height}px;background:#57A87A"></i>`;
        })
        .join("");
      const newest = runs[runs.length - 1];
      const allRuns = line.checks.flatMap((check) => check.history);
      const uptime =
        allRuns.length === 0 ? null : (allRuns.filter((outcome) => outcome.status === "pass").length / allRuns.length) * 100;
      const uptimeText =
        uptime === null ? "" : ` · <strong>${uptime >= 99.95 ? "100" : uptime.toFixed(1)}% uptime</strong> over the last ${allRuns.length} calls`;
      const stateLine =
        failingCount > 0
          ? `<div class="state bad"><span class="dot"></span><span class="t">Partial issue — ${failingCount} check${failingCount === 1 ? "" : "s"} failing</span></div>
<div class="verified">checks run as real phone calls${uptimeText}</div>`
          : `<div class="state ok"><span class="dot"></span><span class="t">Operational</span></div>
<div class="verified">${newest === undefined ? "No checks recorded yet" : `Last verified <strong>${relativeTime(newest.at, nowMs)}</strong>`}${uptimeText} · checks run as real phone calls</div>`;
      const rows = line.checks
        .map((check) => {
          const latest = check.latest;
          if (latest === null) {
            return `<div class="check-row"><span class="n">${escapeHtml(check.name)}</span><span class="r"><span class="a">no runs yet</span></span></div>`;
          }
          if (latest.status !== "pass") {
            return `<div class="check-row"><span class="n">${escapeHtml(check.name)}</span><span class="r"><span class="a bad">being investigated</span><span class="badge bad">Failing</span></span></div>`;
          }
          const answered = latest.timing.secondsToAnswer === null ? "" : `answered in ${latest.timing.secondsToAnswer}s`;
          return `<div class="check-row"><span class="n">${escapeHtml(check.name)}</span><span class="r"><span class="a">${escapeHtml(answered)}</span><span class="badge ok">OK</span></span></div>`;
        })
        .join("\n");
      const heading = lines.length > 1 ? `<h2>${escapeHtml(line.name)}</h2>` : "";
      return `${heading}
${stateLine}
<div class="ticks-head"><span class="t">Last ${runs.length} checks</span><span class="m">oldest → newest</span></div>
<div class="ticks" role="img" aria-label="recent check results">${ticks}</div>
<div class="ticks-cap">Each tick is one real test call placed to this line</div>
<div class="checks">${rows}</div>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="60">
<title>${escapeHtml(title)}</title>
${FONTS}
<style>${STATUS_CSS}</style>
</head>
<body>
<div class="page"><div class="col">
<div class="eyebrow"><span class="mark"><i></i></span><span>Phone line status</span></div>
<h1>${escapeHtml(title)}</h1>
${sections}
<div class="privacy">Checks are placed as real, automated phone calls to this line. No customer calls are monitored or recorded. This page updates automatically.</div>
<div class="foot"><span class="dot"></span><span class="t">Monitored by LineCanary</span><span style="flex:1"></span><a href="/" style="font-size:11.5px;color:#B5B1A6">operator view</a></div>
</div></div>
</body>
</html>`;
}
