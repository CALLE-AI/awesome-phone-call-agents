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
      outcome: outcome({
        status: "fail",
        transcript: [
          { offsetSeconds: 0, speaker: "bot", text: "Automated test call." },
          { offsetSeconds: 6, speaker: "user", text: "…silence, then a click." },
        ],
      }),
      regressions: [{ checkId: "hours", kind: "new_failure", detail: "answered: expected true, got false" }],
    }),
  ],
  regressions: [{ checkId: "hours", kind: "new_failure", detail: "answered: expected true, got false" }],
});

test("slack payload includes what the canary heard on failing checks", () => {
  const payload = JSON.stringify(slackPayload(REGRESSED));
  assert.match(payload, /what the canary heard/);
  assert.match(payload, /silence, then a click/);
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

test("formatReport shows skips and errors distinctly, with humanized skip reasons", () => {
  const text = formatReport(
    report({
      ok: false,
      runs: [run({ skipped: "unverified-line", outcome: null }), run({ error: "internal_error: boom", outcome: null })],
    }),
  );
  assert.match(text, /line not verified — run: linecanary verify main-office --live/);
  assert.match(text, /internal_error/);
  // One run errored, so something did run: the headline stays ATTENTION.
  assert.match(text, /ATTENTION/);
});

test("a live report where every check was skipped is headlined NOTHING RAN with the breakdown", () => {
  const text = formatReport(
    report({
      ok: false,
      runs: [run({ skipped: "unverified-line", outcome: null }), run({ skipped: "unverified-line", outcome: null })],
    }),
  );
  assert.match(text, /NOTHING RAN/);
  assert.match(text, /2× unverified-line/);
  assert.doesNotMatch(text, /ATTENTION/);
});

test("every skip reason is humanized in the report lines", () => {
  const live = formatReport(
    report({ runs: [run({ skipped: "outside-call-window", outcome: null }), run({ skipped: "filtered", outcome: null })] }),
  );
  assert.match(live, /outside the configured call window/);
  assert.match(live, /filtered by --only/);
  const dry = formatReport(report({ live: false, runs: [run({ skipped: "dry-run", outcome: null })] }));
  assert.match(dry, /dry run \(no call placed\)/);
  assert.doesNotMatch(dry, /NOTHING RAN/, "a dry run is not a live run that skipped everything");
});

test("slack payload masks phones and humanizes regression kinds", () => {
  const payload = JSON.stringify(slackPayload(REGRESSED));
  assert.match(payload, /New failure/);
  assert.doesNotMatch(payload, /new_failure/, "raw snake_case kinds stay out of Slack");
  assert.doesNotMatch(payload, /\+15550100/);
});

test("slack headline says nothing ran when a live run skipped everything", () => {
  const nothing = slackPayload(report({ ok: false, runs: [run({ skipped: "unverified-line", outcome: null })] }));
  assert.match(String(nothing.text), /nothing ran/);
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
  assert.match(posts[0].body, /New failure/);
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

test("a recovery pages with good news even though the report is ok", async () => {
  const recovered = report({
    ok: true,
    runs: [run({ regressions: [{ checkId: "hours", kind: "recovered", detail: "recovered at 2026-08-04T12:00:00Z" }] })],
    regressions: [{ checkId: "hours", kind: "recovered", detail: "recovered at 2026-08-04T12:00:00Z" }],
  });
  const posts: string[] = [];
  const fetchStub = (async (_url: string | URL | Request, init?: RequestInit) => {
    posts.push(String(init?.body));
    return new Response("ok", { status: 200 });
  }) as typeof fetch;
  await sendSlack("https://hooks.slack.example/T0/B0", recovered, fetchStub);
  assert.equal(posts.length, 1, "recovery must notify");
  assert.match(posts[0], /recovered/);
  assert.match(posts[0], /✅/);
});
