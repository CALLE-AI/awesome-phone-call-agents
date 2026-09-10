import { createHmac } from "node:crypto";
import { createServer, type Server } from "node:http";

import { describe, expect, it } from "vitest";

import { startPersistentDemoReceiver } from "./persistent-demo-receiver.js";

const publicBaseUrl = "https://synthetic.example";
const twilioAuthToken = "synthetic-test-token";
const accountSid = `AC${"a".repeat(32)}`;
const targetNumber = "+12025550110";
const form = {
  AccountSid: accountSid,
  To: targetNumber,
  From: "+12025550111",
  CallSid: `CA${"b".repeat(32)}`,
};

function signed(path: string, values: Record<string, string> = form) {
  const payload = `${publicBaseUrl}${path}${Object.keys(values)
    .sort()
    .map((key) => `${key}${values[key]}`)
    .join("")}`;
  return {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-twilio-signature": createHmac("sha1", twilioAuthToken).update(payload).digest("base64"),
    },
    body: new URLSearchParams(values).toString(),
  };
}

async function start() {
  return await startPersistentDemoReceiver({
    publicBaseUrl,
    twilioAuthToken,
    accountSid,
    targetNumber,
    port: 0,
  });
}

async function close(server: Server) {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

describe.sequential("persistent signed synthetic Twilio receiver", () => {
  it("serves the complete labeled report without an upstream and exposes only safe readiness", async () => {
    const receiver = await start();
    try {
      const response = await fetch(`${receiver.baseUrl}/twilio/voice`, signed("/twilio/voice"));
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("application/xml");
      const xml = await response.text();
      expect(xml).toContain("SIMULATED synthetic greenhouse phone report");
      expect(xml).toContain("Battery is normal. Output is off.");
      expect(xml).toContain("<Say>");
      expect(xml).toContain("<Hangup/>");
      expect(xml).not.toContain("<Gather");
      expect(await (await fetch(`${receiver.baseUrl}/healthz`)).json()).toEqual({
        ready: true,
        mode: "persistent-demo",
        publicOrigin: publicBaseUrl,
        upstreamConnected: false,
        instanceId: expect.stringMatching(/^[0-9a-f-]{36}$/u),
      });
      expect(
        (await fetch(`${receiver.baseUrl}/twilio/status`, signed("/twilio/status"))).status,
      ).toBe(204);
      const canary = await fetch(
        `${receiver.baseUrl}/twilio/canary/operation-1`,
        signed("/twilio/canary/operation-1"),
      );
      expect(canary.status).toBe(200);
      expect(await canary.text()).toContain("<Hangup/>");
    } finally {
      await receiver.close();
    }
  });

  it("rejects unsigned, wrong account/target, duplicate, oversized and disallowed requests even idle", async () => {
    const receiver = await start();
    try {
      const valid = signed("/twilio/voice");
      expect(
        (
          await fetch(`${receiver.baseUrl}/twilio/voice`, {
            ...valid,
            headers: { ...valid.headers, "x-twilio-signature": "invalid" },
          })
        ).status,
      ).toBe(403);
      for (const values of [
        { ...form, AccountSid: `AC${"c".repeat(32)}` },
        { ...form, To: "+12025550112" },
      ]) {
        expect(
          (await fetch(`${receiver.baseUrl}/twilio/voice`, signed("/twilio/voice", values))).status,
        ).toBe(403);
      }
      expect(
        (
          await fetch(`${receiver.baseUrl}/twilio/voice`, {
            ...valid,
            body: `${valid.body}&To=${encodeURIComponent(targetNumber)}`,
          })
        ).status,
      ).toBe(400);
      expect(
        (await fetch(`${receiver.baseUrl}/twilio/voice`, { ...valid, body: "x".repeat(16_385) }))
          .status,
      ).toBe(413);
      for (const path of [
        "/api/v1/live-simulator/runs",
        "/twilio/voice?extra=1",
        "/twilio/canary/%2fetc",
        "/twilio/canary/..",
        "/admin",
      ]) {
        expect((await fetch(`${receiver.baseUrl}${path}`, signed(path))).status).toBe(404);
      }
      expect((await fetch(`${receiver.baseUrl}/twilio/voice`)).status).toBe(404);
    } finally {
      await receiver.close();
    }
  });

  it("forwards only authenticated fixed routes with original form and signature, without fallback for active errors", async () => {
    const seen: Array<{ url?: string; body: string; signature: string | string[] | undefined }> =
      [];
    let status = 200;
    let reviewOnly = false;
    const upstream = createServer((request, response) => {
      let body = "";
      request.on("data", (chunk: Buffer) => {
        body += chunk.toString("utf8");
      });
      request.on("end", () => {
        seen.push({
          ...(request.url === undefined ? {} : { url: request.url }),
          body,
          signature: request.headers["x-twilio-signature"],
        });
        response.writeHead(status, {
          "content-type": "application/xml",
          ...(reviewOnly ? { "x-muster-runtime-mode": "review-only" } : {}),
        });
        response.end("<Response><Reject/></Response>");
      });
    });
    await new Promise<void>((resolve) => upstream.listen(43111, "127.0.0.1", resolve));
    const receiver = await start();
    try {
      const init = signed("/twilio/voice");
      for (const code of [200, 403, 404, 500]) {
        status = code;
        const result = await fetch(`${receiver.baseUrl}/twilio/voice`, init);
        expect(result.status).toBe(code);
        expect(await result.text()).toBe("<Response><Reject/></Response>");
      }
      expect(seen).toEqual(
        [0, 1, 2, 3].map(() => ({
          url: "/twilio/voice",
          body: init.body,
          signature: init.headers["x-twilio-signature"],
        })),
      );
      expect(await (await fetch(`${receiver.baseUrl}/healthz`)).json()).toMatchObject({
        upstreamConnected: true,
      });
      status = 404;
      reviewOnly = true;
      const idle = await fetch(`${receiver.baseUrl}/twilio/voice`, init);
      expect(idle.status).toBe(200);
      expect(await idle.text()).toContain("Battery is normal. Output is off.");
    } finally {
      await receiver.close();
      await close(upstream);
    }
  });

  it("refuses malformed public origins and unsafe endpoint credentials", async () => {
    for (const overrides of [
      { publicBaseUrl: "http://synthetic.example" },
      { publicBaseUrl: "https://synthetic.example/path" },
      { targetNumber: "invalid" },
      { accountSid: "invalid" },
      { twilioAuthToken: "" },
    ]) {
      await expect(
        startPersistentDemoReceiver({
          publicBaseUrl,
          twilioAuthToken,
          accountSid,
          targetNumber,
          port: 0,
          ...overrides,
        }),
      ).rejects.toThrow("Persistent demo receiver configuration is invalid");
    }
  });

  it("does not mask an upstream timeout as a successful idle report", async () => {
    const upstream = createServer(() => {
      /* Intentionally unresponsive active host. */
    });
    await new Promise<void>((resolve) => upstream.listen(43111, "127.0.0.1", resolve));
    const receiver = await start();
    try {
      const response = await fetch(`${receiver.baseUrl}/twilio/voice`, signed("/twilio/voice"));
      expect(response.status).toBe(504);
      expect(await response.text()).toBe("");
    } finally {
      await receiver.close();
      await close(upstream);
    }
  }, 10_000);
});
