import type { ReplayOutput } from "./replay.js";

export function renderHtmlReport(output: ReplayOutput): string {
  const { result, fixture } = output;
  const label = result.verdict.toUpperCase();
  const confidence = result.confidence === null ? "Unavailable" : `${Math.round(result.confidence * 100)}%`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>CallSuite replay: ${escapeHtml(label)}</title>
  <style>
    :root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, sans-serif; }
    body { margin: 0; background: #0b1020; color: #e8edf8; }
    main { width: min(760px, calc(100% - 2rem)); margin: 4rem auto; }
    article { background: #151d33; border: 1px solid #2c3858; border-radius: 16px; padding: 2rem; box-shadow: 0 20px 50px #0006; }
    .verdict { display: inline-block; border-radius: 999px; padding: .4rem .75rem; background: ${colorFor(result.verdict)}; color: #fff; font-weight: 800; letter-spacing: .08em; }
    dl { display: grid; grid-template-columns: max-content 1fr; gap: .7rem 1.25rem; }
    dt { color: #aeb9d4; } dd { margin: 0; overflow-wrap: anywhere; }
    .notice { margin-top: 1.5rem; border-left: 4px solid ${colorFor(result.verdict)}; padding: .75rem 1rem; background: #0d1427; }
    table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
    th, td { text-align: left; padding: .5rem .75rem; border-bottom: 1px solid #2c3858; overflow-wrap: anywhere; }
    th { color: #aeb9d4; font-size: .85rem; text-transform: uppercase; letter-spacing: .05em; }
    footer { margin-top: 1rem; color: #8f9bb8; font-size: .85rem; }
  </style>
</head>
<body>
  <main>
    <article>
      <p class="verdict">${escapeHtml(label)}</p>
      <h1>Replay result</h1>
      <p>${escapeHtml(fixture.summary)}</p>
      <dl>
        <dt>Fixture</dt><dd>${escapeHtml(fixture.id)}</dd>
        <dt>Call status</dt><dd>${escapeHtml(result.callStatus)}</dd>
        <dt>Confidence</dt><dd>${escapeHtml(confidence)}</dd>
        <dt>Exit code</dt><dd>${result.exitCode}</dd>
        <dt>Automation</dt><dd>${result.automation.blocked ? "Blocked" : "May continue"}</dd>
        <dt>Attribution</dt><dd>${result.automation.attribution === "target" ? "Workflow regression" : "No workflow blame"}</dd>
      </dl>
      <p class="notice">${escapeHtml(result.reason)}</p>
      ${renderTestCaseSection(output)}
      <footer>Generated locally by CallSuite replay. No call was placed.</footer>
    </article>
  </main>
</body>
</html>
`;
}

/** Renders the same per-assertion results that the JSON output carries. */
function renderTestCaseSection(output: ReplayOutput): string {
  const report = output.testCase;
  if (!report) {
    return "";
  }

  const rows = report.assertions
    .map(
      (assertion) =>
        `<tr><td>${escapeHtml(assertion.id)}</td><td>${escapeHtml(assertion.path)}</td><td>${escapeHtml(assertion.contains)}</td><td>${escapeHtml(assertion.outcome)}</td></tr>`,
    )
    .join("");

  return `<section>
  <h2>Test case: ${escapeHtml(report.title)}</h2>
  <dl>
    <dt>Test case ID</dt><dd>${escapeHtml(report.id)}</dd>
    <dt>Evaluator verdict</dt><dd>${escapeHtml(report.evaluatorVerdict)} (reference only; assertions decide)</dd>
    <dt>Assertions</dt><dd>${report.totals.met} met, ${report.totals.unmet} unmet, ${report.totals.unknown} unknown</dd>
  </dl>
  <table>
    <thead><tr><th>Assertion</th><th>Evidence path</th><th>Required content</th><th>Outcome</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</section>`;
}

function colorFor(verdict: ReplayOutput["result"]["verdict"]): string {
  if (verdict === "pass") return "#147d47";
  if (verdict === "fail") return "#b4232d";
  if (verdict === "needs-review") return "#9a6700";
  return "#6f42c1";
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
