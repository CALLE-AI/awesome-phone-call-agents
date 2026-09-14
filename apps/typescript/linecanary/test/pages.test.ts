import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "../src/baseline.js";
import { escapeHtml, renderDashboard, renderStatus } from "../src/pages.js";
import { buildDashboardState } from "../src/state.js";
import { startDashboard } from "../src/serve.js";
import { outcome } from "./baseline.test.js";
import type { Config } from "../src/config.js";

function config(): Config {
  return {
    lines: [{ id: "main-office", phone: "+15550100", ownership: { method: "greeting_code", code: "LC-1" } }],
    checks: [
      { id: "hours", line: "main-office", task: "Ask hours.", resultSchema: { type: "object", additionalProperties: false }, assert: [{ path: "a", equals: 1 }] },
    ],
    baselineDir: "unused",
    historyLimit: 200,
  };
}

function storeWith(entries: Parameters<typeof outcome>[0][]): ReturnType<typeof openStore> {
  const store = openStore(join(mkdtempSync(join(tmpdir(), "linecanary-pages-")), "baselines"));
  // The dashboard renders check details only for verified lines.
  store.recordVerification({ lineId: "main-office", phone: "+15550100", method: "greeting_code", verifiedAt: "2026-08-02T00:00:00Z", callId: "cv" });
  for (const entry of entries) {
    store.append(outcome(entry));
  }
  return store;
}

// Outcomes default to 2026-08-02T10:00Z; two hours later nothing is stale.
const FRESH = () => new Date("2026-08-02T12:00:00.000Z");

test("escapeHtml neutralizes markup and quotes", () => {
  assert.equal(escapeHtml(`<script>alert("x")</script>'`), "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&#39;");
});

test("hostile transcript text cannot inject markup into the dashboard", () => {
  // Transcripts render on failing checks — that is exactly where hostile
  // callee text would surface, so the injection test lives there.
  const store = storeWith([
    {
      checkId: "hours",
      status: "fail",
      transcript: [
        { offsetSeconds: 0, speaker: "bot", text: "Automated test call." },
        { offsetSeconds: 4, speaker: "user", text: `<img src=x onerror=alert(1)> "quoted" & <b>bold</b>` },
      ],
    },
  ]);
  const html = renderDashboard(buildDashboardState(config(), store, FRESH));
  assert.ok(!html.includes("<img src=x"), "raw callee markup must not survive");
  assert.ok(html.includes("&lt;img src=x onerror=alert(1)&gt;"));
});

test("dashboard shows health banner, check card and dead-air notice", () => {
  const healthy = renderDashboard(buildDashboardState(config(), storeWith([{ checkId: "hours" }]), FRESH));
  assert.match(healthy, /all lines healthy/i);
  assert.match(healthy, /hours/);
  assert.match(healthy, /Answered in 5s/);

  const broken = renderDashboard(
    buildDashboardState(
      config(),
      storeWith([
        { checkId: "hours", callId: "c-ok", transcript: [{ offsetSeconds: 1, speaker: "user", text: "We are open." }] },
        { checkId: "hours", callId: "c-bad", status: "fail", transcript: [] },
      ]),
      FRESH,
    ),
  );
  assert.match(broken, /needs attention/i);
  // Regression kinds surface as human phrasing, not raw kind strings.
  assert.match(broken, /Different answer than expected/);
  assert.match(broken, /dead air/i);
  // Transcript lists label this call and the passing comparison call.
  assert.match(broken, /aria-label="This call"/);
  assert.match(broken, /aria-label="Last passing call \(comparison\)"/);
});

test("never-run, stale and fresh checks read as three distinct states", () => {
  // Fresh pass → green everywhere.
  const freshState = buildDashboardState(config(), storeWith([{ checkId: "hours" }]), FRESH);
  const freshDash = renderDashboard(freshState);
  assert.match(freshDash, /all lines healthy/i);
  assert.match(freshDash, /status-pill ok/);
  assert.match(renderStatus(freshState), /Operational/);

  // Latest pass older than 26 hours → amber, never green.
  const staleState = buildDashboardState(config(), storeWith([{ checkId: "hours" }]), () => new Date("2026-08-04T12:00:00.000Z"));
  const staleDash = renderDashboard(staleState);
  assert.match(staleDash, /Monitoring is not running for 1 check/);
  assert.match(staleDash, /Not currently being checked/);
  assert.ok(!staleDash.includes("all lines healthy"));
  assert.ok(!staleDash.includes("status-pill ok"), "a stale pass must not wear the green pill");
  const staleStatus = renderStatus(staleState);
  assert.match(staleStatus, /Not currently being checked/);
  assert.ok(!staleStatus.includes(`class="state ok"`), "a stale line must not show the green dot");
  assert.ok(!staleStatus.includes("Operational"));

  // Verified line whose check never ran → amber "Never checked".
  const neverStore = openStore(join(mkdtempSync(join(tmpdir(), "linecanary-pages-")), "baselines"));
  neverStore.recordVerification({ lineId: "main-office", phone: "+15550100", method: "greeting_code", verifiedAt: "2026-08-02T00:00:00Z", callId: "cv" });
  const neverState = buildDashboardState(config(), neverStore, FRESH);
  const neverDash = renderDashboard(neverState);
  assert.match(neverDash, /Never checked/);
  assert.match(neverDash, /Monitoring is not running for 1 check/);
  assert.match(renderStatus(neverState), /Not currently being checked/);
});

test("status page stays public-safe: no tasks, no transcripts, no full numbers", () => {
  const store = storeWith([
    { checkId: "hours", transcript: [{ offsetSeconds: 2, speaker: "user", text: "Secret internal wording." }] },
  ]);
  const html = renderStatus(buildDashboardState(config(), store, FRESH), "Sample Dental phone line");
  assert.match(html, /Sample Dental phone line/);
  assert.match(html, /Operational/);
  assert.ok(!html.includes("Ask hours."), "check tasks must not leak");
  assert.ok(!html.includes("Secret internal wording"), "transcripts must not leak");
  assert.ok(!html.includes("5550100"), "numbers must not leak");
});

test("status page has landmarks, absolute stamps, honest counts and no operator link", () => {
  const state = buildDashboardState(config(), storeWith([{ checkId: "hours" }]), FRESH);
  const html = renderStatus(state, "Sample Dental phone line");
  assert.match(html, /<main>/);
  assert.match(html, /<footer>/);
  assert.ok(!html.includes("operator view"), "the operator link dead-ends on a 401 for clients");
  assert.match(html, /class="ticks" role="img" aria-label="recent check results" tabindex="0"/);
  assert.match(html, /title="passed · 2026-08-02 10:00 UTC"/);
  assert.match(html, /1 of 1 recent test calls answered correctly/);
  assert.ok(!html.includes("% uptime"), "no uptime percentage, rounded or otherwise");
  assert.match(html, /Last verified <strong>2 h ago<\/strong>/);
  assert.match(html, /2026-08-02 10:00 UTC/);
});

test("pages auto-refresh with a focus-guarded script, never a meta refresh", async () => {
  const { renderCheckLog } = await import("../src/pages.js");
  const state = buildDashboardState(config(), storeWith([{ checkId: "hours" }]), FRESH);
  const dash = renderDashboard(state);
  const log = renderCheckLog(state.lines[0], state.lines[0].checks[0], state.generatedAt, 200);
  const status = renderStatus(state);
  for (const html of [dash, log, status]) {
    assert.ok(!html.includes('http-equiv="refresh"'), "meta refresh must be gone");
    assert.match(html, /document\.hasFocus\(\) === false/);
    assert.match(html, /location\.reload\(\)/);
  }
  assert.match(dash, /id="refresh-toggle"/);
  assert.match(dash, /Page refreshes every 30s/);
  assert.match(dash, /30000/);
  assert.match(log, /id="refresh-toggle"/);
  assert.ok(!status.includes("refresh-toggle"), "the public page has no toggle");
  assert.match(status, /60000/);
});

test("dashboard exposes live banner, labelled sparklines and a11y hooks", () => {
  // The failing call's empty transcript renders the dead-air notice, whose
  // decorative ellipsis run must be hidden from AT.
  const store = storeWith([{ checkId: "hours", callId: "c1" }, { checkId: "hours", callId: "c2", status: "fail", transcript: [] }]);
  const dash = renderDashboard(buildDashboardState(config(), store, FRESH));
  assert.match(dash, /class="banner" role="status"/);
  assert.match(dash, /role="img" aria-label="Last 2 calls: 1 passed, 1 failed"/);
  assert.match(dash, /<main id="main">/);
  assert.match(dash, /Skip to content/);
  assert.match(dash, /id="theme-light" type="button" aria-pressed/);
  assert.match(dash, /prefers-color-scheme/);
  assert.match(dash, /:focus-visible\{outline:2px solid var\(--text\);outline-offset:-2px\}/);
  assert.match(dash, /forced-colors: active/);
  assert.match(dash, /aria-label="ending in 00"/);
  assert.match(dash, /class="dots" aria-hidden="true"/);
});

test("links and small print use the corrected contrast palette", () => {
  const dash = renderDashboard(buildDashboardState(config(), storeWith([{ checkId: "hours" }]), FRESH));
  assert.match(dash, /a\{color:var\(--link\)/);
  assert.match(dash, /--link:#8A6D00;--linkHover:#5C4900/);
  assert.match(dash, /--link:#E5B93C;--linkHover:#F0CC66/);
  assert.match(dash, /--ok:#14762F/);
  assert.match(dash, /--faint:#8A8D95/);
});

test("a pending call attempt shows the reconciliation pill", () => {
  const store = storeWith([{ checkId: "hours" }]);
  store.recordPending({ checkId: "hours", idempotencyKey: "k1", callId: null, at: "2026-08-02T11:00:00Z" });
  const dash = renderDashboard(buildDashboardState(config(), store, FRESH));
  assert.match(dash, /Call awaiting reconciliation/);
});

test("absolute stamps render in the call-window timezone when configured", async () => {
  const { renderCheckLog } = await import("../src/pages.js");
  const tzConfig: Config = { ...config(), callWindow: { timezone: "America/Los_Angeles", start: "09:00", end: "17:00" } };
  const state = buildDashboardState(tzConfig, storeWith([{ checkId: "hours" }]), FRESH);
  assert.equal(state.timezone, "America/Los_Angeles");
  assert.match(renderStatus(state), /Aug 2, 3:00 AM PDT/);
  const log = renderCheckLog(state.lines[0], state.lines[0].checks[0], state.generatedAt, 200, state.timezone);
  assert.match(log, /Aug 2, 3:00 AM PDT/);
});

test("server serves dashboard, status and JSON state from disk", async () => {
  const dir = join(mkdtempSync(join(tmpdir(), "linecanary-serve-")), "baselines");
  const store = openStore(dir);
  store.append(outcome({ checkId: "hours" }));
  const served = { ...config(), baselineDir: dir };
  const server = await startDashboard(served, { port: 0, statusTitle: "Test line" });
  try {
    const dash = await (await fetch(`http://127.0.0.1:${server.port}/`)).text();
    assert.match(dash, /LineCanary/i);
    const status = await (await fetch(`http://127.0.0.1:${server.port}/status`)).text();
    assert.match(status, /Test line/);
    const state = (await (await fetch(`http://127.0.0.1:${server.port}/api/state`)).json()) as { lines: unknown[] };
    assert.equal(state.lines.length, 1);
    const missing = await fetch(`http://127.0.0.1:${server.port}/nope`);
    assert.equal(missing.status, 404);
  } finally {
    await server.close();
  }
});

test("served dashboard shows the greeting code hint for unverified lines", async () => {
  const dir = join(mkdtempSync(join(tmpdir(), "linecanary-serve-")), "baselines");
  openStore(dir); // no verification recorded — the line is unverified
  const server = await startDashboard({ ...config(), baselineDir: dir }, { port: 0 });
  try {
    const dash = await (await fetch(`http://127.0.0.1:${server.port}/`)).text();
    assert.match(dash, /Canary ID/, "greeting_code lines get the greeting instruction");
    assert.match(dash, /LC-1/, "the line's own code is shown");
  } finally {
    await server.close();
  }
});

test("call log renders every stored call with transcripts, including passing ones", async () => {
  const { renderCheckLog } = await import("../src/pages.js");
  const store = storeWith([
    { checkId: "hours", callId: "call_1", transcript: [{ offsetSeconds: 3, speaker: "user", text: "Healthy call answer." }] },
    {
      checkId: "hours",
      callId: "call_2",
      status: "fail",
      transcript: [{ offsetSeconds: 4, speaker: "user", text: `<script>alert("log")</script>` }],
    },
  ]);
  const state = buildDashboardState(config(), store, FRESH);
  const html = renderCheckLog(state.lines[0], state.lines[0].checks[0], state.generatedAt, 200);
  assert.match(html, /call log/i);
  assert.match(html, /Healthy call answer\./, "passing-call transcripts must be browsable");
  assert.match(html, /call_1/);
  assert.match(html, /call_2/);
  assert.ok(!html.includes(`<script>alert("log")</script>`), "hostile transcript must be escaped");
  assert.match(html, /&lt;script&gt;alert\(&quot;log&quot;\)&lt;\/script&gt;/);
  assert.match(html, /Back to dashboard/);
  // Calls and transcript turns are real lists, and the cap is the configured one.
  assert.match(html, /<ol class="calls">/);
  assert.match(html, /<li class="call bad">/);
  assert.match(html, /<ol class="convo" aria-label="This call">/);
  assert.match(html, /most recent 200 calls/);
  const trimmed = renderCheckLog(state.lines[0], state.lines[0].checks[0], state.generatedAt, 75);
  assert.match(trimmed, /most recent 75 calls/);
});

test("server serves the call log and styled 404s for unknown ids", async () => {
  const dir = join(mkdtempSync(join(tmpdir(), "linecanary-serve-")), "baselines");
  const store = openStore(dir);
  store.recordVerification({ lineId: "main-office", phone: "+15550100", method: "greeting_code", verifiedAt: "2026-08-02T00:00:00Z", callId: "cv" });
  store.append(outcome({ checkId: "hours", transcript: [{ offsetSeconds: 2, speaker: "user", text: "Row one." }] }));
  const server = await startDashboard({ ...config(), baselineDir: dir }, { port: 0 });
  try {
    const log = await (await fetch(`http://127.0.0.1:${server.port}/check/hours`)).text();
    assert.match(log, /call log/i);
    assert.match(log, /Row one\./);
    const dash = await (await fetch(`http://127.0.0.1:${server.port}/`)).text();
    assert.match(dash, /href="\/check\/hours"/, "dashboard links to the call log");
    const status = await (await fetch(`http://127.0.0.1:${server.port}/status`)).text();
    assert.ok(!status.includes("operator view"), "the operator link is gone from the public page");
    const missingCheck = await fetch(`http://127.0.0.1:${server.port}/check/nope`);
    assert.equal(missingCheck.status, 404);
    assert.equal(missingCheck.headers.get("content-type"), "text/html; charset=utf-8");
    assert.match(await missingCheck.text(), /Check not found/);
    const missingLine = await fetch(`http://127.0.0.1:${server.port}/status/nope`);
    assert.equal(missingLine.status, 404);
    assert.equal(missingLine.headers.get("content-type"), "text/html; charset=utf-8");
    assert.match(await missingLine.text(), /Line not found/);
  } finally {
    await server.close();
  }
});

test("per-line status page filters to one line and counts answered calls", async () => {
  const multiConfig: Config = {
    lines: [
      { id: "main-office", phone: "+15550100", ownership: { method: "greeting_code", code: "LC-1" } },
      { id: "other-client", name: "Other Client", phone: "+15550101", ownership: { method: "greeting_code", code: "LC-2" } },
    ],
    checks: [
      { id: "hours", line: "main-office", task: "Ask hours.", resultSchema: { type: "object", additionalProperties: false }, assert: [{ path: "a", equals: 1 }] },
      { id: "other-check", line: "other-client", task: "Other task.", resultSchema: { type: "object", additionalProperties: false }, assert: [{ path: "b", equals: 2 }] },
    ],
    baselineDir: "unused",
    historyLimit: 200,
  };
  const store = storeWith([{ checkId: "hours" }, { checkId: "hours" }, { checkId: "hours", status: "fail" }]);
  const state = buildDashboardState(multiConfig, store, FRESH);
  const single = renderStatus(state, "Main Office", "main-office");
  assert.match(single, /Main Office/);
  assert.ok(!single.includes("Other Client"), "other clients must not leak on a per-line page");
  assert.ok(!single.includes("other-check"));
  assert.match(single, /2 of 3 recent test calls answered correctly/);
  assert.ok(!single.includes("% uptime"));
});

test("basic auth guards operator surfaces but never the public status pages", async () => {
  const dir = join(mkdtempSync(join(tmpdir(), "linecanary-serve-")), "baselines");
  openStore(dir).append(outcome({ checkId: "hours" }));
  const server = await startDashboard({ ...config(), baselineDir: dir }, { port: 0, password: "canary-secret" });
  try {
    const denied = await fetch(`http://127.0.0.1:${server.port}/`);
    assert.equal(denied.status, 401);
    const wrong = await fetch(`http://127.0.0.1:${server.port}/`, { headers: { authorization: `Basic ${Buffer.from("x:nope").toString("base64")}` } });
    assert.equal(wrong.status, 401);
    const granted = await fetch(`http://127.0.0.1:${server.port}/`, { headers: { authorization: `Basic ${Buffer.from("x:canary-secret").toString("base64")}` } });
    assert.equal(granted.status, 200);
    const publicStatus = await fetch(`http://127.0.0.1:${server.port}/status`);
    assert.equal(publicStatus.status, 200, "public status must stay open");
    const publicLine = await fetch(`http://127.0.0.1:${server.port}/status/main-office`);
    assert.equal(publicLine.status, 200, "per-line status must stay open");
  } finally {
    await server.close();
  }
});

test("binding the dashboard beyond loopback without a password is refused", () => {
  assert.throws(() => startDashboard(config(), { port: 0, host: "0.0.0.0" }), /password/);
});

test("dashboard state never carries a full phone number (masking holds on /api/state)", () => {
  const state = buildDashboardState(config(), storeWith([{ checkId: "hours" }]), FRESH);
  const json = JSON.stringify(state);
  // The verification object used to leak the raw E.164 alongside the mask.
  assert.ok(!/\+\d{7,15}/.test(json), `serialized state must not contain a full number: ${json.match(/\+\d{7,15}/)?.[0] ?? ""}`);
  assert.equal(state.lines[0].verification?.maskedPhone, "+••••••00");
});

test("a status field that is a prototype member is escaped, not treated as a label", () => {
  const state = buildDashboardState(config(), storeWith([{ checkId: "hours", status: "constructor" as never }]), FRESH);
  const dash = renderDashboard(state);
  // Must not emit a raw prototype value (e.g. "function Object() { [native code] }").
  assert.ok(!/\[native code\]/.test(dash), "prototype-chain status lookup must not reach the page");
});

test("an empty-string dashboard password is treated as absent (fails closed on external bind)", () => {
  // Empty password must not both (a) satisfy the auth compare and (b) pass the
  // non-loopback bind guard. It is treated as "no password", so the guard fires.
  assert.throws(() => startDashboard(config(), { port: 0, host: "0.0.0.0", password: "" }), /password/);
});
