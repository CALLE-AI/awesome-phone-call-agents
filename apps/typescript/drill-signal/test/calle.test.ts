import assert from "node:assert/strict";
import test from "node:test";
import { CalleApiError, assertTrustedBaseUrl, createSdkPort } from "../src/calle.js";
import { allowedCalleHosts, ConfigError } from "../src/config.js";
import { startFakeCalle } from "../src/fake/calle-server.js";

test("trusted base URL allows loopback for fake server", () => {
  assert.equal(assertTrustedBaseUrl("http://127.0.0.1:39121").hostname, "127.0.0.1");
});

test("untrusted host is refused before SDK client is built", async () => {
  await assert.rejects(
    () => createSdkPort({ apiKey: "calle_test_key", baseUrl: "https://evil.example" }),
    (error: unknown) => error instanceof ConfigError,
  );
});

test("SDK createCall path works against local fake CALL-E server", async () => {
  const fake = await startFakeCalle([
    {
      phone: "+15550100001",
      structuredResult: {
        reached_live_person: true,
        acknowledged_scenario: true,
        can_take_ownership: true,
        first_action: "verify monitoring",
        escalation_target: null,
        needs_help: false,
        follow_up_required: false,
        opt_out: false,
      },
    },
  ]);
  const port = await createSdkPort({ apiKey: "calle_test_key", baseUrl: fake.baseUrl });
  const created = await port.createCall(
    {
      task: "drill contract test",
      recipients: [{ phones: ["+15550100001"] }],
      resultSchema: { type: "object" },
      metadata: { app: "drill-signal" },
    },
    "contract-test-key",
  );
  const finished = await port.waitForResult(created.id, { timeoutMs: 5000, intervalMs: 100 });
  assert.equal(finished.status, "completed");
  assert.equal(fake.created.length, 1);
  await fake.close();
});

test("CALLE_ALLOWED_HOSTS extends trusted base URL hosts", () => {
  const prior = process.env.CALLE_ALLOWED_HOSTS;
  process.env.CALLE_ALLOWED_HOSTS = "allowed.example.com";
  try {
    assert.equal(assertTrustedBaseUrl("https://allowed.example.com", allowedCalleHosts()).hostname, "allowed.example.com");
    assert.throws(() => assertTrustedBaseUrl("https://denied.example.com", allowedCalleHosts()), ConfigError);
  } finally {
    if (prior === undefined) delete process.env.CALLE_ALLOWED_HOSTS;
    else process.env.CALLE_ALLOWED_HOSTS = prior;
  }
});

test("ambiguous API errors are classified", () => {
  assert.equal(new CalleApiError("timeout", "x", 408).ambiguous, true);
  assert.equal(new CalleApiError("bad_request", "x", 400).ambiguous, false);
});
