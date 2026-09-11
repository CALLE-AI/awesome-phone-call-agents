import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("simulator-host HTTP contract documentation", () => {
  it("keeps provider callbacks separate while assigning the Phase 4 REST lifecycle explicitly", async () => {
    const [contract, liveContract, productionOpenApi] = await Promise.all([
      readFile(new URL("../../../docs/api/simulator-host-webhooks.md", import.meta.url), "utf8"),
      readFile(new URL("../../../docs/api/simulator-host-live-runs.md", import.meta.url), "utf8"),
      readFile(new URL("../../../docs/api/openapi.yaml", import.meta.url), "utf8"),
    ]);

    expect(contract).toContain("POST /twilio/voice");
    expect(contract).toContain("POST /twilio/canary/{callbackHandle}");
    expect(contract).toContain("application/x-www-form-urlencoded");
    expect(contract).toContain("X-Twilio-Signature");
    expect(contract).toContain("traceparent");
    expect(contract).toContain("<placeholder>");
    expect(contract).toContain("RUNTIME_PROFILE=<placeholder>");
    expect(contract).toContain("production API and generated-client contract");
    expect(contract).toContain("deliberately excludes simulator-host and provider composition");
    expect(contract).not.toContain("NODE_ENV=<placeholder>");
    expect(contract).not.toMatch(
      /runAuthorization|permit=|GET \/api\/v1\/live|POST \/api\/v1\/live/iu,
    );
    expect(contract).toContain("Phase 4");
    expect(contract).toContain("simulator-host-live-runs.md");
    expect(liveContract).toContain("GET /api/v1/live-simulator/capability");
    expect(liveContract).toContain("POST /api/v1/live-simulator/operations");
    expect(liveContract).toContain("GET /api/v1/live-simulator/operations/{operationId}");
    expect(liveContract).toContain("202");
    expect(liveContract).toContain("Location");
    expect(liveContract).toContain("traceparent");
    expect(liveContract).toContain("SIMULATED");
    expect(liveContract).toContain("SIMULATOR_DEMO_ORIGIN=<placeholder>");
    expect(liveContract).not.toMatch(/CALLE_API_KEY=\S+|TWILIO_AUTH_TOKEN=\S+/u);
    expect(productionOpenApi).not.toMatch(/\/twilio\/|simulator-host|X-Twilio-Signature/iu);
  });
});
