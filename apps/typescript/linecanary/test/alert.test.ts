import { test } from "node:test";
import assert from "node:assert/strict";
import { exitCode, formatReport, maskPhone, sendSlack, slackPayload } from "../src/alert.js";
import type { RunReport, CheckRun } from "../src/runner.js";
import { outcome } from "./baseline.test.js";

function run(overrides: Partial<CheckRun> = {}): CheckRun {
  return {
    planned: { checkId: "hours", lineId: "main-office", phone: "+15550100", task: "…" },
    outcome: outcome(),
    regressions: [],
    skipped: null,
    error: null,
    ...overrides,
  };
}

function report(overrides: Partial<RunReport> = {}): RunReport {
  return { startedAt: "2026-08-02T10:00:00.000Z", live: true, runs: [run()], regressions: [], ok: true, ...overrides };
}

const REGRESSED: RunReport = report({
  ok: false,
  runs: [
    run({
      outcome: outcome({ status: "fail" }),
      regressions: [{ checkId: "hours", kind: "new_failure", detail: "answered: expected true, got false" }],
    }),
  ],
  regressions: [{ checkId: "hours", kind: "new_failure", detail: "answered: expected true, got false" }],
});

test("phone masking keeps only the plus sign and the last two digits", () => {
  assert.equal(maskPhone("+15550100"), "+" + "•".repeat(6) + "00");
  assert.equal(maskPhone("+442071838750"), "+" + "•".repeat(10) + "50");
  assert.equal(maskPhone("garbage"), "•••");
});

test("formatReport names every check, its status and regressions", () => {
  const text = formatReport(REGRESSED);
  assert.match(text, /hours/);
  assert.match(text, /fail/);
  assert.match(text, /new_failure/);
  assert.match(text, /answered/);
  assert.doesNotMatch(text, /\+15550100/, "full phone numbers stay out of alert text");
});

test("formatReport shows skips and errors distinctly", () => {
  const text = formatReport(
    report({
      ok: false,
      runs: [run({ skipped: "unverified-line", outcome: null }), run({ error: "internal_error: boom", outcome: null })],
    }),
  );
  assert.match(text, /unverified-line/);
  assert.match(text, /internal_error/);
});

test("slack payload masks phones and carries the regression details", () => {
  const payload = JSON.stringify(slackPayload(REGRESSED));
  assert.match(payload, /new_failure/);
  assert.doesNotMatch(payload, /\+15550100/);
});

test("sendSlack posts only for reports that need attention", async () => {
  const posts: { url: string; body: string }[] = [];
  const fetchStub = (async (input: string | URL | Request, init?: RequestInit) => {
    posts.push({ url: String(input), body: String(init?.body) });
    return new Response("ok", { status: 200 });
  }) as typeof fetch;

  await sendSlack("https://hooks.slack.example/T0/B0", report(), fetchStub);
  assert.equal(posts.length, 0, "an ok report must not page anyone");

  await sendSlack("https://hooks.slack.example/T0/B0", REGRESSED, fetchStub);
  assert.equal(posts.length, 1);
  assert.match(posts[0].body, /new_failure/);
});

test("sendSlack surfaces a non-2xx response as an error", async () => {
  const fetchStub = (async () => new Response("no", { status: 500 })) as typeof fetch;
  await assert.rejects(() => sendSlack("https://hooks.slack.example/T0/B0", REGRESSED, fetchStub), /500/);
});

test("exit codes: 0 ok, 1 regressions or failures, 2 run errors", () => {
  assert.equal(exitCode(report()), 0);
  assert.equal(exitCode(REGRESSED), 1);
  assert.equal(exitCode(report({ ok: false, runs: [run({ error: "internal_error: boom", outcome: null })] })), 2);
});
