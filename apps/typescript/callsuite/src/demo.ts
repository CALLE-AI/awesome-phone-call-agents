import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadReplay, type ReplayOutput } from "./replay.js";
import { loadTestCase } from "./test-case.js";

interface DemoCase {
  id: "broken" | "fixed" | "platform";
  eyebrow: string;
  title: string;
  fixture: string;
  expectedExit: 0 | 1 | 3;
  expectedVerdict: "pass" | "fail" | "error";
}

interface DemoCaseResult extends DemoCase {
  output: ReplayOutput;
}

export interface DemoSummary {
  demoVersion: 1;
  mode: "sanitized-replay";
  testCase: string;
  allExpectedOutcomesVerified: boolean;
  cases: Array<{
    id: DemoCase["id"];
    fixture: string;
    verdict: string;
    exitCode: number;
    automationBlocked: boolean;
    attribution: string;
    assertions: { met: number; unmet: number; unknown: number };
  }>;
  privacy: {
    credentialsLoaded: false;
    callsPlaced: 0;
    fixturesManuallySanitized: true;
  };
}

const DEMO_CASES: DemoCase[] = [
  {
    id: "broken",
    eyebrow: "Problem found",
    title: "The fee was forgotten",
    fixture: "fixtures/broken-omission.sanitized.json",
    expectedExit: 1,
    expectedVerdict: "fail",
  },
  {
    id: "fixed",
    eyebrow: "Safe to release",
    title: "Everything required was said",
    fixture: "fixtures/fixed-disclosure.sanitized.json",
    expectedExit: 0,
    expectedVerdict: "pass",
  },
  {
    id: "platform",
    eyebrow: "Call delivery failed",
    title: "The phone call never arrived",
    fixture: "fixtures/platform-failure.sanitized.json",
    expectedExit: 3,
    expectedVerdict: "error",
  },
];

export async function runJudgeDemo(
  repositoryRoot = process.cwd(),
  outputDirectory = resolve(repositoryRoot, "artifacts", "judge-demo"),
): Promise<{ summary: DemoSummary; htmlPath: string; jsonPath: string }> {
  const testCasePath = resolve(repositoryRoot, "fixtures", "cancellation-fee.test-case.json");
  const testCase = await loadTestCase(testCasePath);
  const cases: DemoCaseResult[] = [];

  for (const demoCase of DEMO_CASES) {
    const output = await loadReplay(resolve(repositoryRoot, demoCase.fixture), { testCase });
    cases.push({ ...demoCase, output });
  }

  const allExpectedOutcomesVerified = cases.every(
    ({ expectedExit, expectedVerdict, output }) =>
      output.result.exitCode === expectedExit && output.result.verdict === expectedVerdict,
  );
  if (!allExpectedOutcomesVerified) {
    throw new Error("Judge demo outcome matrix changed; refusing to produce a misleading report.");
  }

  const [conciseTask, goodTask] = await Promise.all([
    readFile(resolve(repositoryRoot, "prompts", "concise-regression.md"), "utf8"),
    readFile(resolve(repositoryRoot, "prompts", "good.md"), "utf8"),
  ]);
  const summary: DemoSummary = {
    demoVersion: 1,
    mode: "sanitized-replay",
    testCase: testCase.id,
    allExpectedOutcomesVerified,
    cases: cases.map(({ id, fixture, output }) => ({
      id,
      fixture,
      verdict: output.result.verdict,
      exitCode: output.result.exitCode,
      automationBlocked: output.result.automation.blocked,
      attribution: output.result.automation.attribution,
      assertions: output.testCase?.totals ?? { met: 0, unmet: 0, unknown: 0 },
    })),
    privacy: {
      credentialsLoaded: false,
      callsPlaced: 0,
      fixturesManuallySanitized: true,
    },
  };

  const htmlPath = resolve(outputDirectory, "index.html");
  const jsonPath = resolve(outputDirectory, "summary.json");
  await mkdir(dirname(htmlPath), { recursive: true });
  await Promise.all([
    writeFile(htmlPath, renderDemoReport(cases, conciseTask, goodTask), "utf8"),
    writeFile(jsonPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8"),
  ]);

  return { summary, htmlPath, jsonPath };
}

function renderDemoReport(cases: DemoCaseResult[], conciseTask: string, goodTask: string): string {
  const demoData = JSON.stringify(
    cases.map(({ id, eyebrow, title, output }) => ({
      id,
      eyebrow,
      title,
      verdict: output.result.verdict,
      exitCode: output.result.exitCode,
      automationBlocked: output.result.automation.blocked,
      attribution: output.result.automation.attribution,
      assertions: output.testCase?.totals ?? { met: 0, unmet: 0, unknown: 0 },
      summary: output.fixture.summary,
      reason: output.result.reason,
    })),
  ).replaceAll("<", "\\u003c");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>CallSuite — quality control for AI phone agents</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; --ink:#f8fafc; --muted:#9ca8bd; --line:#273149; --panel:#101725; --green:#45e09c; --red:#ff6b7d; --purple:#b69cff; --blue:#8da2ff; }
    * { box-sizing: border-box; }
    html { scroll-behavior:smooth; }
    body { margin:0; color:var(--ink); background:radial-gradient(circle at 82% 0,#202e54 0,transparent 32rem),radial-gradient(circle at 12% 30%,#17213d 0,transparent 28rem),#070b13; min-height:100vh; }
    button { font:inherit; }
    .shell { width:min(1180px,calc(100% - 32px)); margin:0 auto; padding:22px 0 72px; }
    nav { display:flex; justify-content:space-between; align-items:center; padding:8px 0 34px; }
    .brand { display:flex; align-items:center; gap:11px; font-weight:900; font-size:19px; letter-spacing:-.02em; }
    .brand-mark { display:grid; place-items:center; width:34px; height:34px; border-radius:11px; background:linear-gradient(145deg,#9aacff,#6c7ff4); color:#081022; box-shadow:0 10px 30px #7187ff55; }
    .safe { display:flex; align-items:center; gap:8px; color:#bfd2c9; border:1px solid #2a493e; background:#0e201a; padding:8px 12px; border-radius:999px; font-size:13px; }
    .safe i { width:8px; height:8px; background:var(--green); border-radius:50%; box-shadow:0 0 14px var(--green); }
    .hero { display:grid; grid-template-columns:1.25fr .75fr; align-items:end; gap:40px; margin:34px 0 38px; }
    .kicker { color:var(--blue); font-weight:850; letter-spacing:.15em; text-transform:uppercase; font-size:12px; }
    h1 { margin:12px 0 18px; max-width:760px; font-size:clamp(43px,6.2vw,76px); line-height:.98; letter-spacing:-.058em; }
    .lede { max-width:680px; margin:0; color:#b7c1d4; font-size:19px; line-height:1.55; }
    .hero-note { border-left:2px solid #52689f; padding:4px 0 4px 20px; color:var(--muted); line-height:1.55; }
    .hero-note strong { color:var(--ink); display:block; margin-bottom:4px; }
    .workspace { display:grid; grid-template-columns:minmax(0,1.2fr) minmax(330px,.8fr); gap:18px; }
    .panel { border:1px solid var(--line); background:linear-gradient(145deg,#121a2aee,#0d1320ee); border-radius:22px; box-shadow:0 24px 70px #0006; overflow:hidden; }
    .panel-head { display:flex; align-items:center; justify-content:space-between; gap:14px; padding:18px 20px; border-bottom:1px solid var(--line); }
    .panel-head strong { font-size:15px; } .panel-head span { color:var(--muted); font-size:12px; }
    .tabs { display:flex; gap:8px; }
    .tab { cursor:pointer; color:#aab4c7; border:1px solid transparent; background:transparent; border-radius:9px; padding:7px 10px; font-size:12px; font-weight:800; }
    .tab.active[data-task="broken"] { color:#ffc0c8; border-color:#633340; background:#2b1720; }
    .tab.active[data-task="fixed"] { color:#a7f4d0; border-color:#285b47; background:#102b21; }
    .prompt-wrap { position:relative; min-height:350px; padding:24px; }
    .prompt-label { display:flex; align-items:center; gap:9px; margin-bottom:18px; color:#cfd6e5; font-weight:800; }
    .prompt-label i { width:10px; height:10px; border-radius:50%; background:var(--red); }
    .prompt-label.fixed i { background:var(--green); }
    pre { white-space:pre-wrap; word-break:break-word; margin:0; color:#d8dfec; font:14px/1.75 ui-monospace,SFMono-Regular,Consolas,monospace; }
    mark { background:#5f2833; color:#ffd7dc; border-radius:4px; padding:2px 3px; }
    .required { margin-top:20px; display:flex; gap:10px; flex-wrap:wrap; }
    .chip { color:#cbd4e4; background:#111b2c; border:1px solid #2d3a56; border-radius:999px; padding:8px 11px; font-size:12px; }
    .runner { padding:24px; display:flex; flex-direction:column; min-height:430px; }
    .runner h2 { margin:0 0 8px; font-size:27px; letter-spacing:-.035em; }
    .runner > p { color:var(--muted); line-height:1.5; margin:0 0 22px; }
    .run-button { cursor:pointer; border:0; border-radius:13px; padding:14px 18px; background:linear-gradient(135deg,#91a5ff,#6c82f5); color:#071025; font-weight:900; box-shadow:0 14px 35px #7187ff55; transition:transform .18s,filter .18s; }
    .run-button:hover { transform:translateY(-2px); filter:brightness(1.08); }
    .run-button:disabled { cursor:wait; transform:none; filter:saturate(.6); }
    .steps { list-style:none; padding:0; margin:24px 0 0; display:grid; gap:11px; }
    .step { display:flex; align-items:center; gap:11px; color:#6f7d97; transition:color .25s; }
    .step i { display:grid; place-items:center; width:25px; height:25px; border-radius:50%; border:1px solid #35415b; font-style:normal; font-size:11px; }
    .step.active { color:#dce4f5; } .step.active i { border-color:#7f94ef; box-shadow:0 0 0 4px #667eea22; }
    .step.done { color:#bdebd6; } .step.done i { color:#07150f; background:var(--green); border-color:var(--green); }
    .empty { margin:auto 0 0; border:1px dashed #33405b; border-radius:14px; padding:16px; color:#7f8ca5; text-align:center; font-size:13px; }
    .results { margin-top:22px; opacity:1; transform:none; transition:opacity .5s,transform .5s; }
    .results.hidden { opacity:0; transform:translateY(16px); pointer-events:none; height:0; overflow:hidden; margin:0; }
    .results-head { display:flex; align-items:end; justify-content:space-between; gap:20px; margin:48px 0 18px; }
    .results-head h2 { font-size:34px; margin:0; letter-spacing:-.04em; } .results-head p { color:var(--muted); margin:0; }
    .grid { display:grid; grid-template-columns:repeat(3,1fr); gap:16px; }
    .card { opacity:0; transform:translateY(18px); min-height:330px; border:1px solid var(--line); background:linear-gradient(145deg,#151d2e,#0d1421); border-radius:20px; padding:23px; transition:opacity .4s,transform .4s; }
    .results.revealed .card { opacity:1; transform:none; }
    .results.revealed .card:nth-child(2) { transition-delay:.12s; } .results.revealed .card:nth-child(3) { transition-delay:.24s; }
    .card[data-kind="broken"] { border-top:4px solid var(--red); } .card[data-kind="fixed"] { border-top:4px solid var(--green); } .card[data-kind="platform"] { border-top:4px solid var(--purple); }
    .eyebrow { color:var(--muted); font-size:11px; letter-spacing:.13em; text-transform:uppercase; font-weight:850; }
    .card h3 { min-height:52px; margin:9px 0 20px; font-size:21px; line-height:1.22; }
    .verdict { display:flex; align-items:baseline; justify-content:space-between; gap:12px; margin-bottom:18px; }
    .verdict strong { font-size:28px; letter-spacing:-.04em; } .exit { color:var(--muted); font-family:ui-monospace,monospace; }
    dl { display:grid; grid-template-columns:1fr auto; gap:10px; margin:0; } dt { color:var(--muted); } dd { margin:0; font-weight:800; }
    .reason { color:#cbd3e3; line-height:1.48; border-top:1px solid var(--line); margin:18px 0 0; padding-top:16px; }
    .plain { margin-top:48px; display:grid; grid-template-columns:repeat(3,1fr); gap:12px; }
    .plain div { border:1px solid var(--line); background:#0c121e; border-radius:15px; padding:18px; } .plain strong { display:block; font-size:22px; margin-bottom:5px; } .plain span { color:var(--muted); font-size:13px; }
    footer { display:flex; justify-content:space-between; gap:20px; margin-top:42px; padding-top:22px; border-top:1px solid var(--line); color:var(--muted); font-size:12px; }
    @media (max-width:900px) { .hero,.workspace { grid-template-columns:1fr; } .grid { grid-template-columns:1fr; } .plain { grid-template-columns:1fr; } .hero-note { display:none; } }
    @media (prefers-reduced-motion:reduce) { * { scroll-behavior:auto!important; transition:none!important; } }
  </style>
</head>
<body><div class="shell">
  <nav><div class="brand"><span class="brand-mark">C</span>CallSuite</div><div class="safe"><i></i>Safe replay · no phone call</div></nav>
  <header class="hero">
    <div><p class="kicker">Quality control for AI phone agents</p><h1>Would you ship this caller?</h1><p class="lede">A tiny instruction change can make an AI agent forget something important. CallSuite catches it before a customer hears it.</p></div>
    <p class="hero-note"><strong>Today’s example</strong>Cedar Clinic must confirm an appointment and explain the $25 cancellation fee.</p>
  </header>
  <section class="workspace">
    <article class="panel">
      <div class="panel-head"><strong>Agent instructions</strong><div class="tabs"><button class="tab active" data-task="broken">Broken version</button><button class="tab" data-task="fixed">Fixed version</button></div></div>
      <div class="prompt-wrap"><div class="prompt-label" id="prompt-label"><i></i><span>Concise reminder</span></div><pre id="prompt-text">${escapeHtml(conciseTask)}</pre><div class="required"><span class="chip">✓ Confirm appointment</span><span class="chip">Required: explain cancellation fee</span></div></div>
    </article>
    <aside class="panel runner">
      <h2>Check before release</h2><p>CallSuite compares what the agent was required to say with the reviewed call result.</p>
      <button class="run-button" id="run-test">Run safety check</button>
      <ol class="steps" aria-live="polite">
        <li class="step" data-step="0"><i>1</i><span>Load both instruction versions</span></li>
        <li class="step" data-step="1"><i>2</i><span>Check appointment confirmation</span></li>
        <li class="step" data-step="2"><i>3</i><span>Check cancellation-fee disclosure</span></li>
        <li class="step" data-step="3"><i>4</i><span>Make the release decision</span></li>
      </ol>
      <div class="empty" id="empty-state">Ready. No API key or phone call required.</div>
    </aside>
  </section>
  <section class="results hidden" id="results">
    <div class="results-head"><div><p class="kicker">Safety-check results</p><h2>One change. Three clear decisions.</h2></div><p>Generated from reviewed evidence</p></div>
    <div class="grid" id="result-grid"></div>
    <div class="plain"><div><strong>Broken → stop</strong><span>The customer was not told something required.</span></div><div><strong>Fixed → continue</strong><span>Both required parts were present.</span></div><div><strong>Phone service fails → stop safely</strong><span>Do not blame the agent or the customer.</span></div></div>
  </section>
  <footer><span>Powered by CALL-E runtime integration</span><span>Reviewed evidence · no credentials · no live call IDs</span></footer>
</div>
<script id="demo-data" type="application/json">${demoData}</script>
<script>
  const cases = JSON.parse(document.getElementById("demo-data").textContent);
  const prompts = { broken: ${JSON.stringify(conciseTask)}, fixed: ${JSON.stringify(goodTask)} };
  const tabs = document.querySelectorAll(".tab");
  const promptText = document.getElementById("prompt-text");
  const promptLabel = document.getElementById("prompt-label");
  tabs.forEach((tab) => tab.addEventListener("click", () => {
    tabs.forEach((item) => item.classList.remove("active"));
    tab.classList.add("active");
    const fixed = tab.dataset.task === "fixed";
    promptText.textContent = prompts[fixed ? "fixed" : "broken"];
    promptLabel.classList.toggle("fixed", fixed);
    promptLabel.querySelector("span").textContent = fixed ? "Complete reminder" : "Concise reminder";
  }));

  const runButton = document.getElementById("run-test");
  const steps = Array.from(document.querySelectorAll(".step"));
  const results = document.getElementById("results");
  const emptyState = document.getElementById("empty-state");
  const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
  const escape = (value) => String(value).replace(/[&<>"']/g, (character) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[character]);

  function renderCard(item) {
    const decision = item.id === "fixed" ? "CONTINUE" : "STOP";
    const blame = item.attribution === "target" ? "Instructions" : "Nobody";
    const descriptions = {
      broken: "The call confirmed the appointment, but never mentioned the cancellation fee.",
      fixed: "The call confirmed the appointment and clearly explained the cancellation fee.",
      platform: "The fictional CALL-E attempt never reached the phone, so CallSuite stopped without blaming anyone."
    };
    const status = item.id === "fixed" ? "ready to release" : item.id === "broken" ? "release blocked" : "phone service error";
    return '<article class="card" data-kind="' + escape(item.id) + '">' +
      '<p class="eyebrow">' + escape(item.eyebrow) + '</p><h3>' + escape(item.title) + '</h3>' +
      '<div class="verdict"><strong>' + decision + '</strong><span class="exit">' + status + '</span></div>' +
      '<dl><dt>Checks passed</dt><dd>' + item.assertions.met + ' of 2</dd><dt>Who is responsible?</dt><dd>' + blame + '</dd></dl>' +
      '<p class="reason">' + escape(descriptions[item.id]) + '</p></article>';
  }

  runButton.addEventListener("click", async () => {
    runButton.disabled = true;
    runButton.textContent = "Checking…";
    emptyState.textContent = "Reading reviewed evidence…";
    results.classList.add("hidden");
    results.classList.remove("revealed");
    steps.forEach((step) => { step.classList.remove("active", "done"); step.querySelector("i").textContent = Number(step.dataset.step) + 1; });
    for (const step of steps) {
      step.classList.add("active");
      await delay(420);
      step.classList.remove("active");
      step.classList.add("done");
      step.querySelector("i").textContent = "✓";
    }
    document.getElementById("result-grid").innerHTML = cases.map(renderCard).join("");
    emptyState.textContent = "Complete: broken version stopped, fixed version cleared.";
    results.classList.remove("hidden");
    requestAnimationFrame(() => results.classList.add("revealed"));
    runButton.textContent = "Run again";
    runButton.disabled = false;
    results.scrollIntoView({ behavior: "smooth", block: "start" });
  });
</script></body></html>`;
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

const entryPoint = process.argv[1] ? resolve(process.argv[1]) : "";
if (entryPoint === fileURLToPath(import.meta.url)) {
  try {
    const { summary, htmlPath, jsonPath } = await runJudgeDemo();
    const root = process.cwd();
    process.stdout.write([
      "CallSuite judge demo — sanitized replay only",
      "✓ Broken task blocked (exit 1)",
      "✓ Fixed task released (exit 0)",
      "✓ Platform failure blocked without workflow blame (exit 3)",
      `✓ Expected matrix verified: ${summary.allExpectedOutcomesVerified}`,
      `HTML: ${relative(root, htmlPath)}`,
      `JSON: ${relative(root, jsonPath)}`,
      "Safety: 0 credentials loaded · 0 calls placed",
    ].join("\n") + "\n");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`CallSuite demo error: ${message}\n`);
    process.exitCode = 3;
  }
}
