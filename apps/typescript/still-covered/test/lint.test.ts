// The linter's rules were each paid for by a defect on a real call. These tests check both
// directions: our own task must satisfy every rule, and a task missing a rule must be caught.

import assert from "node:assert/strict";
import { test } from "node:test";
import { formatLintReport, lintCallTask, RULES } from "../src/lint.js";
import { loadRules, loadState } from "../src/rules.js";
import { loadEnrollees } from "../src/registry.js";
import { renderScreeningTask } from "../src/tasks.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const { people } = loadEnrollees(join(process.cwd(), "data", "enrollees.sample.csv"));
const ours = renderScreeningTask(loadRules(), loadState("example-state"), people.find((p) => p.id === "e001")!, "2026-09-14");

test("our own call task defends every boundary the linter knows about", () => {
  const report = lintCallTask(ours);
  assert.equal(report.errors, 0, `errors: ${report.findings.filter((f) => f.severity === "error").map((f) => f.id).join(", ")}`);
  assert.equal(report.warnings, 0, `warnings: ${report.findings.filter((f) => f.severity === "warning").map((f) => f.id).join(", ")}`);
  assert.equal(report.passed.length, RULES.length);
});

test("a task that defends nothing is caught on every rule", () => {
  const naive = "Call the customer and ask if they qualify for the programme. Be helpful and friendly.";
  const report = lintCallTask(naive);
  assert.ok(report.errors >= 8, `a bare task should fail most rules, got ${report.errors}`);
  assert.ok(report.findings.some((f) => f.id === "identity-before-disclosure"));
  assert.ok(report.findings.some((f) => f.id === "never-determines"));
  assert.ok(report.findings.some((f) => f.id === "one-question-at-a-time"));
});

test("each rule fails when its own clause is removed from a passing task", () => {
  // Some boundaries are stated twice in our task, deliberately. Removing one clause leaves the
  // other and the rule should still pass, so each entry lists every clause that defends its rule.
  const removals: [string, RegExp[]][] = [
    ["one-question-at-a-time", [/Ask exactly one thing at a time[^\n]*/, /one short question at a time[^\n]*/]],
    ["no-answer-coaching", [/Never say which situations count as exemptions[^\n]*/]],
    ["interruption-handling", [/If you are interrupted part-way[^\n]*/]],
    ["never-offer-the-verifier", [/Never say the year yourself[^\n]*/]],
  ];
  for (const [id, patterns] of removals) {
    let weakened = ours;
    for (const pattern of patterns) {
      weakened = weakened.replace(pattern, "");
    }
    assert.notEqual(weakened, ours, `${id}: the clause was found and removed`);
    const report = lintCallTask(weakened);
    assert.ok(report.findings.some((f) => f.id === id), `${id} is caught once its clause is gone`);
  }
});

test("a voicemail line that names the programme is a finding; naming none is not", () => {
  const leaky = `${ours}\n- If voicemail answers, say: "This is about your Medicaid renewal."`;
  assert.ok(lintCallTask(leaky).findings.some((f) => f.id === "voicemail-names-no-programme"));
  assert.ok(!lintCallTask(ours).findings.some((f) => f.id === "voicemail-names-no-programme"));
});

test("the report reads as guidance, and never claims the agent will obey", () => {
  const text = formatLintReport(lintCallTask(ours));
  assert.match(text, /boundaries defended/);
  assert.match(text, /whether the agent follows them on the day/, "a passing lint is not a passing call");
});

test("the generated linter page carries exactly the rules the tests cover", () => {
  const page = readFileSync(join(process.cwd(), "public", "lint.html"), "utf8");
  // The page inlines each predicate's own source, so drift shows up as a missing id or a changed
  // body. Regenerate with: node --import tsx scripts/build-lint-page.mjs
  for (const rule of RULES) {
    assert.ok(page.includes(JSON.stringify(rule.id)), `${rule.id} is in the page`);
    assert.ok(page.includes(JSON.stringify(rule.requirement)), `${rule.id}: requirement text matches`);
    assert.ok(page.includes(JSON.stringify(rule.learnedFrom)), `${rule.id}: the call it was learned from is cited`);
  }
  const ids = [...page.matchAll(/id: "([a-z-]+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids.sort(), RULES.map((r) => r.id).sort(), "no extra or missing rules in the page");
  assert.ok(!/<script src=|<link rel="stylesheet" href=/.test(page), "self-contained: no external fetches");
});
