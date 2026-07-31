import { test } from "node:test";
import assert from "node:assert/strict";
import { runCall, assertTrustedBaseUrl } from "../src/calle/client.js";
import { startFakeCalle, type FakeCalle } from "../fake/calle-server.js";
import { prisma } from "../src/db/client.js";
import { makeBusiness } from "./fixtures.js";

const schema = { type: "object", required: ["accepted"], properties: { accepted: { type: "string", enum: ["yes", "no"] } } };

test("runCall in dry-run mode never calls the network and records a mock CallLog", async () => {
  const business = await makeBusiness();
  const result = await runCall({
    flow: "BACKFILL",
    businessId: business.id,
    phone: "+15559990000",
    task: "Offer the slot.",
    resultSchema: schema,
    dryRunResult: { accepted: "yes" },
    idempotencyKey: `test_${Date.now()}`,
  });
  assert.equal(result.dryRun, true);
  assert.equal(result.calleCallId, null);
  assert.deepEqual(result.structuredResult, { accepted: "yes" });

  const log = await prisma.callLog.findUniqueOrThrow({ where: { id: result.callLogId } });
  assert.equal(log.dryRun, true);
  assert.equal(log.status, "dry_run");
});

test("runCall in live mode drives the real @call-e/calle SDK against a fake CALL-E server", async () => {
  const business = await makeBusiness();
  const livePhone = "+15550009999"; // matches test/.env.test LIVE_CALL_OVERRIDE_PHONE
  let fake: FakeCalle | undefined;
  const originalBaseUrl = process.env.CALLE_BASE_URL;
  const originalDryRun = process.env.CALLE_DRY_RUN;
  try {
    fake = await startFakeCalle([
      {
        phone: livePhone,
        status: "completed",
        botLines: ["Do you accept the slot?"],
        userLines: ["Yes, I'll take it."],
        structuredResult: { accepted: "yes" },
      },
    ]);
    process.env.CALLE_BASE_URL = fake.baseUrl;
    process.env.CALLE_DRY_RUN = "false";

    const result = await runCall({
      flow: "BACKFILL",
      businessId: business.id,
      phone: livePhone,
      task: "Offer the slot.",
      resultSchema: schema,
      dryRunResult: { accepted: "no" },
      idempotencyKey: `test_live_${Date.now()}`,
    });

    assert.equal(result.dryRun, false);
    assert.equal(result.status, "completed");
    assert.ok(result.calleCallId?.startsWith("call_fake"));
    assert.deepEqual(result.structuredResult, { accepted: "yes" });
    assert.equal(result.transcript.length, 2);

    const log = await prisma.callLog.findUniqueOrThrow({ where: { id: result.callLogId } });
    assert.equal(log.dryRun, false);
    assert.equal(log.calleCallId, result.calleCallId);
  } finally {
    process.env.CALLE_BASE_URL = originalBaseUrl;
    process.env.CALLE_DRY_RUN = originalDryRun;
    await fake?.close();
  }
});

test("assertTrustedBaseUrl rejects untrusted hosts so the API key is never sent to them", () => {
  assert.throws(() => assertTrustedBaseUrl("https://evil.example.com"));
  assert.throws(() => assertTrustedBaseUrl("http://api.heycall-e.com")); // must be https except loopback
  assert.doesNotThrow(() => assertTrustedBaseUrl("https://api.heycall-e.com"));
  assert.doesNotThrow(() => assertTrustedBaseUrl("http://127.0.0.1:4000"));
});
