import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HardenedCalleGateway } from "../../server/calle/client-hardened";
import { assertProviderUrlPolicy } from "../../server/calle/http-secure";
import { assertLiveExecutionAllowed, type CalleExecutionContext } from "../../server/calle/live-gate";
import { decideOrigin } from "../../server/calle/origin-policy";
import { authenticateOperator } from "../../server/calle/operator-auth";
import { hardenedCalleRouter } from "../../server/calle/router-hardened";

const prior = { ...process.env };

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in prior)) delete process.env[key];
  }
  Object.assign(process.env, prior);
  vi.restoreAllMocks();
});

function liveContext(overrides: Partial<CalleExecutionContext> = {}): CalleExecutionContext {
  return {
    intent: "live",
    operatorAuthorized: true,
    requestIsLoopback: true,
    recipientAuthorized: true,
    source: "direct-gateway",
    ...overrides,
  };
}

function listen(app: express.Express) {
  return new Promise<{ url: string; close: () => Promise<void> }>((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("No listener address");
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        close: () => new Promise((done, reject) => server.close((error) => (error ? reject(error) : done()))),
      });
    });
  });
}

describe("CALL-E direct gateway hardening", () => {
  it("defaults to mock transport even when a provider key is configured", async () => {
    const gateway = new HardenedCalleGateway();
    const call = await gateway.createCall({
      task: "Confirm a family check-in",
      recipients: [{ phones: ["+14165550123"], region: "CA" }],
      idempotencyKey: "default-mock-123456",
    });
    expect(call.id).toMatch(/^call_mock_/);
  });

  it("requires each live gate before selecting a live provider request", () => {
    const config = { liveCallsEnabled: true, killSwitch: false, liveIntentRequired: true, liveLoopbackOnly: true };
    expect(() => assertLiveExecutionAllowed(liveContext({ intent: "mock" }), config)).toThrow(/explicit live intent/i);
    expect(() => assertLiveExecutionAllowed(liveContext({ operatorAuthorized: false }), config)).toThrow(/operator/i);
    expect(() => assertLiveExecutionAllowed(liveContext({ requestIsLoopback: false }), config)).toThrow(/loopback/i);
    expect(() => assertLiveExecutionAllowed(liveContext({ recipientAuthorized: false }), config)).toThrow(/recipient/i);
    expect(() => assertLiveExecutionAllowed(liveContext(), { ...config, killSwitch: true })).toThrow(/kill switch/i);
  });

  it("requires operator authorization on private direct records", async () => {
    process.env.CALLE_ALLOW_LOOPBACK_OPERATOR = "false";
    const app = express();
    app.use(express.json());
    app.use("/api/calle", hardenedCalleRouter);
    const { url, close } = await listen(app);
    try {
      const response = await fetch(`${url}/api/calle/calls/call_mock_private`);
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ code: "OPERATOR_AUTH_REQUIRED" });
    } finally {
      await close();
    }
  });

  it("rejects malformed E.164 recipients after operator authentication", async () => {
    process.env.CALLE_ALLOW_LOOPBACK_OPERATOR = "true";
    const app = express();
    app.use(express.json());
    app.use("/api/calle", hardenedCalleRouter);
    const { url, close } = await listen(app);
    try {
      const response = await fetch(`${url}/api/calle/calls`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task: "Authorized test call",
          recipients: [{ phones: ["4165550123"], region: "CA" }],
          idempotencyKey: "invalid-recipient-123456",
        }),
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: "INVALID_RECIPIENT" });
    } finally {
      await close();
    }
  });

  it("uses exact approved origins and never reflects a near match", () => {
    process.env.CALLE_APPROVED_ORIGINS = "https://console.example.test";
    expect(decideOrigin("https://console.example.test")).toMatchObject({ allowed: true, credentialed: true });
    expect(decideOrigin("https://console.example.test.attacker.test")).toMatchObject({ allowed: false });
    expect(decideOrigin("http://console.example.test")).toMatchObject({ allowed: false });
  });

  it("does not treat a public request with a forwarded address as an operator", () => {
    process.env.CALLE_ALLOW_LOOPBACK_OPERATOR = "false";
    const principal = authenticateOperator({
      header: () => undefined,
      ip: "203.0.113.10",
      socket: { remoteAddress: "203.0.113.10" },
    } as never);
    expect(principal.authenticated).toBe(false);
  });

  it("rejects non-HTTPS provider endpoints before sending a bearer token", () => {
    process.env.CALLE_BASE_URL = "http://provider.example.test";
    expect(() => assertProviderUrlPolicy("/v1/calls")).toThrow(/HTTPS/i);
  });
});
