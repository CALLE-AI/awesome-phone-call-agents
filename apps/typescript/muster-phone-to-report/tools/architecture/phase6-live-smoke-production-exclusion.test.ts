import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("Phase 6 live-smoke production exclusion", () => {
  it("AC-ERROR-11 mechanically forbids every new route, adapter, control, and enablement token", async () => {
    const policy = await readFile(
      new URL("./simulator-production-boundary.ts", import.meta.url),
      "utf8",
    );
    for (const token of [
      "/twilio/voice",
      "/twilio/canary",
      "/twilio/status",
      "simulator:live-smoke:preflight",
      "twilio-live-smoke-control",
      "live-smoke-evidence-coordinator",
      "SIMULATOR_RUN_GATE",
      "NGROK",
    ]) {
      expect(policy, token).toContain(token);
    }
    expect(policy).toMatch(/fresh|artifact/iu);
  });
});
