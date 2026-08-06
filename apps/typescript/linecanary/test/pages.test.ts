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
  store.recordVerification({ lineId: "main-office", phone: "+15550100", method: "greeting_code", verifiedAt: "2026-08-03T00:00:00Z", callId: "cv" });
  for (const entry of entries) {
    store.append(outcome(entry));
  }
  return store;
}

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
  const html = renderDashboard(buildDashboardState(config(), store));
  assert.ok(!html.includes("<img src=x"), "raw callee markup must not survive");
  assert.ok(html.includes("&lt;img src=x onerror=alert(1)&gt;"));
});

test("dashboard shows health banner, check card and dead-air notice", () => {
  const healthy = renderDashboard(buildDashboardState(config(), storeWith([{ checkId: "hours" }])));
  assert.match(healthy, /all lines healthy/i);
  assert.match(healthy, /hours/);
  assert.match(healthy, /Answered in 5s/);

  const broken = renderDashboard(
    buildDashboardState(config(), storeWith([{ checkId: "hours" }, { checkId: "hours", status: "fail", transcript: [] }])),
  );
  assert.match(broken, /needs attention/i);
  // Regression kinds surface as human phrasing, not raw kind strings.
  assert.match(broken, /Different answer than expected/);
  assert.match(broken, /dead air/i);
});

test("status page stays public-safe: no tasks, no transcripts, no full numbers", () => {
  const store = storeWith([
    { checkId: "hours", transcript: [{ offsetSeconds: 2, speaker: "user", text: "Secret internal wording." }] },
  ]);
  const html = renderStatus(buildDashboardState(config(), store), "Sample Dental phone line");
  assert.match(html, /Sample Dental phone line/);
  assert.match(html, /Operational/);
  assert.ok(!html.includes("Ask hours."), "check tasks must not leak");
  assert.ok(!html.includes("Secret internal wording"), "transcripts must not leak");
  assert.ok(!html.includes("5550100"), "numbers must not leak");
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
  const state = buildDashboardState(config(), store);
  const html = renderCheckLog(state.lines[0], state.lines[0].checks[0], state.generatedAt);
  assert.match(html, /call log/i);
  assert.match(html, /Healthy call answer\./, "passing-call transcripts must be browsable");
  assert.match(html, /call_1/);
  assert.match(html, /call_2/);
  assert.ok(!html.includes(`<script>alert("log")</script>`), "hostile transcript must be escaped");
  assert.match(html, /&lt;script&gt;alert\(&quot;log&quot;\)&lt;\/script&gt;/);
  assert.match(html, /Back to dashboard/);
});

test("server serves the call log and 404s unknown checks", async () => {
  const dir = join(mkdtempSync(join(tmpdir(), "linecanary-serve-")), "baselines");
  const store = openStore(dir);
  store.recordVerification({ lineId: "main-office", phone: "+15550100", method: "greeting_code", verifiedAt: "2026-08-03T00:00:00Z", callId: "cv" });
  store.append(outcome({ checkId: "hours", transcript: [{ offsetSeconds: 2, speaker: "user", text: "Row one." }] }));
  const server = await startDashboard({ ...config(), baselineDir: dir }, { port: 0 });
  try {
    const log = await (await fetch(`http://127.0.0.1:${server.port}/check/hours`)).text();
    assert.match(log, /call log/i);
    assert.match(log, /Row one\./);
    const dash = await (await fetch(`http://127.0.0.1:${server.port}/`)).text();
    assert.match(dash, /href="\/check\/hours"/, "dashboard links to the call log");
    const status = await (await fetch(`http://127.0.0.1:${server.port}/status`)).text();
    assert.match(status, /operator view/, "status page links back to the operator view");
    const missing = await fetch(`http://127.0.0.1:${server.port}/check/nope`);
    assert.equal(missing.status, 404);
  } finally {
    await server.close();
  }
});

test("per-line status page filters to one line and shows uptime", async () => {
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
  const state = buildDashboardState(multiConfig, store);
  const single = renderStatus(state, "Main Office", "main-office");
  assert.match(single, /Main Office/);
  assert.ok(!single.includes("Other Client"), "other clients must not leak on a per-line page");
  assert.ok(!single.includes("other-check"));
  assert.match(single, /66\.7% uptime/);
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
