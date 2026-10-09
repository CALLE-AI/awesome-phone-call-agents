import { describe, expect, it } from "vitest";
import { CalleProvider } from "../server/calle-v4/client";
import { loadCalleV4Config } from "../server/calle-v4/config";
import { DEFAULT_RESULT_SCHEMA } from "../server/calle-v4/schema";

const live = process.env.CALLE_LIVE_TEST === "true";
const phone = process.env.CALLE_LIVE_TEST_PHONE;

describe.skipIf(!live || !phone)("CALL-E live /v1/calls (gated)", () => {
  it("creates an authorized test call without printing secrets", async () => {
    const config = loadCalleV4Config({
      ...process.env,
      CALLE_DEMO_MODE: "false",
    });
    expect(config.apiKey.length, "CALLE_API_KEY must be set for live tests").toBeGreaterThan(8);
    expect(phone?.startsWith("+")).toBe(true);

    const provider = new CalleProvider(config);
    const call = await provider.createCall({
      task: "Call an authorized test recipient and confirm availability. Do not collect passwords, OTPs, or payment details.",
      recipients: [{ phones: [phone!] }],
      resultSchema: DEFAULT_RESULT_SCHEMA,
      metadata: { consent: "true", product: "call-aunty", live_test: "true" },
      idempotencyKey: `live-test-${Date.now()}`,
    });

    expect(call.id).toBeTruthy();
    expect(["queued", "in_progress", "completed", "failed", "canceled"]).toContain(call.status);
  });
});
