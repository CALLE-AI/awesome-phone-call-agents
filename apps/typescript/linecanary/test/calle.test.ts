/**
 * The port is the only place the app touches the network or the SDK. These
 * tests pin two things: the trusted-host guard refuses to send the API key
 * anywhere unexpected, and the SDK adapter drives the real `@call-e/calle`
 * client against the fake server and returns normalized app-level snapshots.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError, assertTrustedBaseUrl, createSdkPort } from "../src/calle.js";
import { ConfigError } from "../src/config.js";
import { startFakeCalle } from "../fake/calle-server.js";

const INPUT = {
  task: "Ask for opening hours.",
  recipients: [{ phones: ["+15550100"], region: "US", locale: "en-US" }],
  resultSchema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false },
  metadata: { check: "hours" },
};

test("trusted-host guard accepts the default host, loopback http and allowlisted hosts", () => {
  assert.equal(assertTrustedBaseUrl("https://api.heycall-e.com").hostname, "api.heycall-e.com");
  assert.equal(assertTrustedBaseUrl("http://127.0.0.1:8080").hostname, "127.0.0.1");
  assert.equal(assertTrustedBaseUrl("http://localhost:3000").hostname, "localhost");
  assert.equal(assertTrustedBaseUrl("https://staging.example.com", ["staging.example.com"]).hostname, "staging.example.com");
});

test("trusted-host guard refuses everything else before the key can travel", () => {
  assert.throws(() => assertTrustedBaseUrl("https://evil.example.com"), ConfigError);
  assert.throws(() => assertTrustedBaseUrl("http://evil.example.com"), ConfigError);
  assert.throws(() => assertTrustedBaseUrl("not a url"), ConfigError);
  assert.throws(() => assertTrustedBaseUrl("ftp://api.heycall-e.com"), ConfigError);
  assert.throws(() => assertTrustedBaseUrl("https://sub.api.heycall-e.com"), ConfigError);
  assert.throws(() => assertTrustedBaseUrl("https://ok.example.com", ["*.example.com"]), ConfigError);
});

test("adapter creates a call and maps the snapshot to app types", async () => {
  const fake = await startFakeCalle([
    {
      phone: "+15550100",
      structuredResult: { ok: true },
      confidence: { score: 0.88, label: "high" },
      turns: [
        { speaker: "bot", text: "Automated test call.", offsetSeconds: 0 },
        { speaker: "user", text: "Hello?", offsetSeconds: 5 },
      ],
    },
  ]);
  try {
    const port = await createSdkPort({ apiKey: "calle_test_key", baseUrl: fake.baseUrl });
    const created = await port.createCall(INPUT, "idem-1");
    assert.equal(created.status, "queued");
    assert.equal(fake.created[0].idempotencyKey, "idem-1");

    const done = await port.waitForResult(created.id, { timeoutMs: 5_000, intervalMs: 10 });
    assert.equal(done.status, "completed");
    assert.deepEqual(done.structuredResult, { ok: true });
    assert.equal(done.completionConfidence?.score, 0.88);
    const turns = done.recipients[0].attempts[0].transcriptTurns;
    assert.equal(turns.length, 2);
    assert.equal(turns[1].offsetSeconds, 5);
    assert.equal(turns[1].speaker, "user");

    const fetched = await port.getCall(created.id);
    assert.equal(fetched.id, created.id);
  } finally {
    await fake.close();
  }
});

test("API failures surface as ApiError with ambiguity marked correctly", async () => {
  const cases: { status: number; code: string; ambiguous: boolean }[] = [
    { status: 400, code: "invalid_request", ambiguous: false },
    { status: 409, code: "idempotency_conflict", ambiguous: true },
    { status: 500, code: "internal_error", ambiguous: true },
  ];
  for (const { status, code, ambiguous } of cases) {
    const fake = await startFakeCalle([{ phone: "+15550100", apiError: { status, code } }]);
    try {
      const port = await createSdkPort({ apiKey: "calle_test_key", baseUrl: fake.baseUrl });
      await assert.rejects(
        () => port.createCall(INPUT, "idem-err"),
        (error: unknown) => {
          assert.ok(error instanceof ApiError, `expected ApiError for ${status}`);
          assert.equal(error.status, status);
          assert.equal(error.code, code);
          assert.equal(error.ambiguous, ambiguous, `ambiguity for ${status}`);
          return true;
        },
      );
    } finally {
      await fake.close();
    }
  }
});
