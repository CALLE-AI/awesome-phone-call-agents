// Offline tests for the fake CALL-E Developer API server.
// Run with: npm test  (or: node --test tests/)
// No credentials, no network beyond 127.0.0.1, no real calls.

import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

import { createFakeCalleServer } from "../fake-calle-server.mjs";

const BASE_BODY = {
  task: "Call the recipient and ask whether they can attend Friday lunch.",
  recipients: [{ phones: ["+15555550100"], region: "US", locale: "en-US" }],
  recipient_result_schema: {
    type: "object",
    required: ["can_attend"],
    properties: { can_attend: { type: "string", enum: ["yes", "no", "unknown"] } },
  },
  result_schema: {
    type: "object",
    required: ["completed_count"],
    properties: { completed_count: { type: "integer" } },
  },
};

/** @param {string} baseUrl @param {string} path @param {RequestInit} [init] */
async function api(baseUrl, path, init) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { authorization: "Bearer test-key", "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = await response.json().catch(() => null);
  return { status: response.status, body, headers: response.headers };
}

/** @param {string} baseUrl @param {Record<string, unknown>} [overrides] */
async function createCall(baseUrl, overrides = {}) {
  return api(baseUrl, "/v1/calls", {
    method: "POST",
    body: JSON.stringify({ ...BASE_BODY, ...overrides }),
  });
}

/** Poll GET /v1/calls/{id} until a terminal status or deadline. */
async function waitForTerminal(baseUrl, callId, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    const response = await api(baseUrl, `/v1/calls/${callId}`);
    last = response;
    if (response.status === 200 && typeof response.body?.status === "string") {
      const terminal = new Set(["completed", "failed", "no_answer", "voicemail", "busy", "declined", "canceled"]);
      if (terminal.has(response.body.status)) return response;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`call ${callId} did not reach a terminal status in time; last: ${JSON.stringify(last?.body)}`);
}

/** Minimal webhook capture server on an ephemeral port. */
async function startCaptureServer() {
  const received = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      received.push({
        headers: req.headers,
        body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
      });
      res.writeHead(204);
      res.end();
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = /** @type {import("node:net").AddressInfo} */ (server.address()).port;
  return { server, url: `http://127.0.0.1:${port}/hook`, received, close: () => server.close() };
}

async function withServer(testFn, options = {}) {
  const runner = createFakeCalleServer({ terminalDelayMs: 300, ...options });
  await new Promise((resolve) => runner.server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${runner.port()}`;
  try {
    await testFn(baseUrl, runner);
  } finally {
    runner.close();
  }
}

test("healthz responds ok", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/healthz`);
    assert.equal(response.status, 200);
  });
});

test("missing or wrong bearer token is rejected with 401", async () => {
  await withServer(async (baseUrl) => {
    const noAuth = await fetch(`${baseUrl}/v1/calls`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(BASE_BODY),
    });
    assert.equal(noAuth.status, 401);
    const payload = await noAuth.json();
    assert.equal(typeof payload.error.code, "string");
  }, { apiKey: "secret-key" });
  await withServer(async (baseUrl) => {
    const wrongKey = await api(baseUrl, "/v1/calls", {
      method: "POST",
      body: JSON.stringify(BASE_BODY),
      headers: { authorization: "Bearer wrong-key" },
    });
    assert.equal(wrongKey.status, 401);
  }, { apiKey: "secret-key" });
});

test("invalid payloads fail validation with structured error codes", async () => {
  await withServer(async (baseUrl) => {
    const cases = [
      [{ ...BASE_BODY, task: " " }, "invalid_task"],
      [{ ...BASE_BODY, recipients: [] }, "no_recipients"],
      [{ ...BASE_BODY, recipients: [{ phones: ["5555550100"] }] }, "invalid_e164"],
      [{ ...BASE_BODY, webhook_url: "ftp://example.com/hook" }, "invalid_webhook_url"],
      [{ ...BASE_BODY, ttl_seconds: 0 }, "invalid_ttl_seconds"],
      [{ ...BASE_BODY, metadata: { scenario: "does_not_exist" } }, "invalid_scenario"],
    ];
    for (const [body, expectedCode] of cases) {
      const response = await api(baseUrl, "/v1/calls", { method: "POST", body: JSON.stringify(body) });
      assert.equal(response.status, 400, `expected 400 for ${expectedCode}`);
      assert.equal(response.body.error.code, expectedCode);
    }
  });
});

test("Idempotency-Key replays the same call and rejects body changes", async () => {
  await withServer(async (baseUrl) => {
    const init = {
      method: "POST",
      headers: { "idempotency-key": "wf_123_friday_lunch" },
      body: JSON.stringify(BASE_BODY),
    };
    const first = await api(baseUrl, "/v1/calls", init);
    assert.equal(first.status, 201);
    const second = await api(baseUrl, "/v1/calls", init);
    assert.equal(second.status, 201);
    assert.equal(second.body.call_id, first.body.call_id);
    assert.equal(second.body.idempotent_replay, true);

    const mutated = await api(baseUrl, "/v1/calls", {
      method: "POST",
      headers: { "idempotency-key": "wf_123_friday_lunch" },
      body: JSON.stringify({ ...BASE_BODY, task: "Different task." }),
    });
    assert.equal(mutated.status, 409);
    assert.equal(mutated.body.error.code, "idempotency_key_reuse");
  });
});

test("completed scenario returns a schema-valid structured result with an anchored transcript", async () => {
  await withServer(async (baseUrl) => {
    const created = await createCall(baseUrl);
    assert.equal(created.status, 201);
    assert.equal(created.body.status, "queued");
    const terminal = await waitForTerminal(baseUrl, created.body.call_id);

    assert.equal(terminal.body.status, "completed");
    assert.equal(terminal.body.task_completed, true);
    assert.equal(typeof terminal.body.completion_confidence.score, "number");

    assert.deepEqual(terminal.body.structured_result, { completed_count: 1 });
    const recipient = terminal.body.recipients[0];
    assert.ok(
      ["yes", "no", "unknown"].includes(recipient.structured_result.can_attend),
      "structured_result values must be schema-valid enum members",
    );

    const turns = recipient.attempts[0].transcript_turns;
    assert.ok(turns.length >= 3);
    assert.equal(turns[0].speaker, "bot");
    const userTurns = turns.filter((turn) => turn.speaker === "user");
    assert.ok(userTurns.length >= 1);
    // Evidence must quote a turn the recipient actually spoke.
    for (const item of terminal.body.evidence) {
      const quoted = userTurns.some((turn) => item.includes(turn.text));
      assert.ok(quoted, `evidence not anchored in transcript: ${item}`);
    }
  });
});

test("completed_low_confidence keeps a low score so clients can test thresholds", async () => {
  await withServer(async (baseUrl) => {
    const created = await createCall(baseUrl, { metadata: { scenario: "completed_low_confidence" } });
    const terminal = await waitForTerminal(baseUrl, created.body.call_id);
    assert.equal(terminal.body.status, "completed");
    assert.ok(terminal.body.completion_confidence.score < 0.5);
    assert.equal(terminal.body.completion_confidence.label, "low");
  });
});

test("non-completed terminal scenarios report failure codes and null results", async () => {
  await withServer(async (baseUrl) => {
    for (const scenario of ["no_answer", "voicemail", "busy", "declined", "failed", "canceled"]) {
      const created = await createCall(baseUrl, { metadata: { scenario } });
      const terminal = await waitForTerminal(baseUrl, created.body.call_id);
      assert.equal(terminal.body.status, scenario, `${scenario} terminal status`);
      assert.equal(terminal.body.task_completed, false, `${scenario} task_completed`);
      assert.equal(terminal.body.structured_result, null, `${scenario} structured_result`);
      const attempt = terminal.body.recipients[0].attempts.at(-1);
      assert.ok(attempt.failure_code, `${scenario} failure_code`);
    }
  });
});

test("the no_answer scenario surfaces the chosen NO ANSWER alias in events", async () => {
  await withServer(async (baseUrl) => {
    const created = await createCall(baseUrl, { metadata: { scenario: "no_answer" } });
    await waitForTerminal(baseUrl, created.body.call_id);
    const events = await api(baseUrl, `/v1/calls/${created.body.call_id}/events`);
    const raw = JSON.stringify(events.body);
    assert.ok(raw.includes("NO ANSWER"), "event payload should carry the raw alias form");
    const limited = await api(baseUrl, `/v1/calls/${created.body.call_id}/events?limit=1`);
    assert.equal(limited.body.events.length, 1);
  });
});

test("non-terminal statuses are progress, not results", async () => {
  await withServer(async (baseUrl) => {
    const created = await createCall(baseUrl, {
      metadata: { scenario: "completed", terminal_delay_ms: 4000, progress_delay_ms: 1500 },
    });
    const early = await api(baseUrl, `/v1/calls/${created.body.call_id}`);
    assert.equal(early.status, 200);
    assert.ok(["queued", "preparing", "in_progress"].includes(early.body.status));
    assert.notEqual(early.body.status, "completed");
  });
});

test("ttl_seconds bounds queryability after terminal status", async () => {
  await withServer(async (baseUrl) => {
    const created = await createCall(baseUrl, { ttl_seconds: 1 });
    await waitForTerminal(baseUrl, created.body.call_id);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const expired = await api(baseUrl, `/v1/calls/${created.body.call_id}`);
    assert.equal(expired.status, 404);
    assert.equal(expired.body.error.code, "expired");
  });
});

test("unsigned terminal webhook fires, may repeat, and reconciliation via GET works", async () => {
  const capture = await startCaptureServer();
  try {
    await withServer(async (baseUrl) => {
      const created = await createCall(baseUrl, {
        webhook_url: capture.url,
        metadata: { scenario: "completed", webhook_repeat: 2 },
      });
      const terminal = await waitForTerminal(baseUrl, created.body.call_id);

      // Webhook delivery races the polling loop; give repeats a moment.
      await new Promise((resolve) => setTimeout(resolve, 400));
      assert.equal(capture.received.length, 2, "duplicate webhook deliveries");

      for (const hit of capture.received) {
        assert.equal(hit.headers["content-type"], "application/json");
        assert.ok(hit.headers["call-e-event-id"], "CALL-E-Event-Id header present");
        assert.equal(typeof hit.headers["x-signature"], "undefined", "webhook must be unsigned");
        assert.equal(hit.body.call_id, created.body.call_id);
        assert.equal(hit.body.type, "call.completed");
      }
      const eventIds = capture.received.map((hit) => hit.headers["call-e-event-id"]);
      assert.notEqual(eventIds[0], eventIds[1], "duplicates carry distinct event ids");

      // The documented defense: treat the webhook as a hint, re-fetch truth.
      const authoritative = await api(baseUrl, `/v1/calls/${created.body.call_id}`);
      assert.equal(authoritative.body.status, terminal.body.status);
      assert.equal(authoritative.body.call_id, capture.received[0].body.call_id);
    });
  } finally {
    capture.close();
  }
});

test("unknown call ids and endpoints return 404", async () => {
  await withServer(async (baseUrl) => {
    const unknown = await api(baseUrl, "/v1/calls/call_does_not_exist");
    assert.equal(unknown.status, 404);
    assert.equal(unknown.body.error.code, "not_found");
    const badPath = await api(baseUrl, "/v2/calls");
    assert.equal(badPath.status, 404);
  });
});
