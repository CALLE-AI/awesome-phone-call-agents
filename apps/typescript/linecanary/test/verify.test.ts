/**
 * Ownership verification is the compliance gate: LineCanary refuses to
 * monitor a line until the operator proves control of it (a verification code
 * placed in the line's own greeting) or records an explicit attestation.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startFakeCalle } from "../fake/calle-server.js";
import { createSdkPort } from "../src/calle.js";
import { openStore } from "../src/baseline.js";
import { verifyLine } from "../src/verify.js";
import type { LineConfig } from "../src/config.js";

function line(overrides: Partial<LineConfig> = {}): LineConfig {
  return {
    id: "main-office",
    phone: "+15550100",
    region: "US",
    locale: "en-US",
    ownership: { method: "greeting_code", code: "LC-7391" },
    ...overrides,
  };
}

function freshStore() {
  return openStore(join(mkdtempSync(join(tmpdir(), "linecanary-verify-")), "baselines"));
}

test("greeting code heard on the line verifies and persists", async () => {
  const fake = await startFakeCalle([
    { phone: "+15550100", structuredResult: { greeting_transcript: "Thank you for calling. This line is monitored. Canary I D: L C 7 3 9 1. For appointments press 1." } },
  ]);
  try {
    const store = freshStore();
    const port = await createSdkPort({ apiKey: "calle_test_key", baseUrl: fake.baseUrl });
    const result = await verifyLine(line(), port, store);
    assert.equal(result.ok, true);
    const verification = store.verification("main-office");
    assert.equal(verification?.method, "greeting_code");
    assert.equal(verification?.phone, "+15550100");
    assert.ok(verification?.callId);
    // The verification call itself carries the disclosure preamble.
    assert.match(fake.created[0].task, /automated test call/i);
  } finally {
    await fake.close();
  }
});

test("a wrong code refuses verification and records nothing", async () => {
  const fake = await startFakeCalle([{ phone: "+15550100", structuredResult: { greeting_transcript: "Thank you for calling Sample Dental. For appointments press 1, for hours press 2." } }]);
  try {
    const store = freshStore();
    const port = await createSdkPort({ apiKey: "calle_test_key", baseUrl: fake.baseUrl });
    const result = await verifyLine(line(), port, store);
    assert.equal(result.ok, false);
    assert.match(result.detail, /does not contain/);
    assert.equal(store.verification("main-office"), null);
  } finally {
    await fake.close();
  }
});

test("a failed call refuses verification with the failure code", async () => {
  const fake = await startFakeCalle([{ phone: "+15550100", status: "failed", failureCode: "no_answer" }]);
  try {
    const store = freshStore();
    const port = await createSdkPort({ apiKey: "calle_test_key", baseUrl: fake.baseUrl });
    const result = await verifyLine(line(), port, store);
    assert.equal(result.ok, false);
    assert.match(result.detail, /no_answer/);
    assert.equal(store.verification("main-office"), null);
  } finally {
    await fake.close();
  }
});

test("attestation verifies without any call", async () => {
  const fake = await startFakeCalle([]);
  try {
    const store = freshStore();
    const port = await createSdkPort({ apiKey: "calle_test_key", baseUrl: fake.baseUrl });
    const attested = line({ ownership: { method: "attestation", statement: "Client authorized monitoring in the MSA." } });
    const result = await verifyLine(attested, port, store);
    assert.equal(result.ok, true);
    assert.equal(fake.created.length, 0);
    assert.equal(store.verification("main-office")?.method, "attestation");
    assert.equal(store.verification("main-office")?.callId, null);
  } finally {
    await fake.close();
  }
});
