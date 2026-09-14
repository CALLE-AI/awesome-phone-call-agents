import express from "express";
import { describe, expect, it } from "vitest";

import { calleRouter } from "../server/calle/router";
import { verifyWebhookSignature } from "../server/calle/webhook";

function listen(app: express.Express) {
  return new Promise<{ url: string; close: () => Promise<void> }>((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("No listen address");
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        close: () =>
          new Promise((done, reject) => {
            server.close((error) => (error ? reject(error) : done()));
          }),
      });
    });
  });
}

describe("CALL-E Express gateway", () => {
  it("creates, fetches, and lists mock calls through /api/calle", async () => {
    const app = express();
    app.use(express.json());
    app.use("/api/calle", calleRouter);
    const { url, close } = await listen(app);
    try {
      const created = await fetch(`${url}/api/calle/calls`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task: "Confirm a family check-in",
          recipients: [{ phones: ["+14165550123"], region: "CA" }],
          idempotencyKey: "router-core-123456",
        }),
      });
      expect(created.status).toBe(201);
      const payload = (await created.json()) as { ok: boolean; data: { id: string; status: string } };
      expect(payload.ok).toBe(true);
      expect(payload.data.id).toMatch(/^call_mock_/);
      expect(payload.data.status).toBe("completed");

      const fetched = await fetch(`${url}/api/calle/calls/${payload.data.id}`);
      const fetchedPayload = (await fetched.json()) as { ok: boolean; data: { id: string } };
      expect(fetchedPayload.ok).toBe(true);
      expect(fetchedPayload.data.id).toBe(payload.data.id);

      const events = await fetch(`${url}/api/calle/calls/${payload.data.id}/events`);
      const eventPayload = (await events.json()) as { ok: boolean; data: { data: unknown[] } };
      expect(eventPayload.ok).toBe(true);
      expect(eventPayload.data.data.length).toBeGreaterThan(0);
    } finally {
      await close();
    }
  });

  it("rejects a webhook without a valid HMAC", async () => {
    const app = express();
    app.use(express.json());
    app.use("/api/calle", calleRouter);
    const { url, close } = await listen(app);
    try {
      const response = await fetch(`${url}/api/calle/webhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-calle-signature": "sha256=deadbeef" },
        body: JSON.stringify({ id: "call_mock_x", status: "completed" }),
      });
      expect(response.status).toBe(401);
    } finally {
      await close();
    }
  });

  it("rejects unsigned webhooks when no secret is configured", () => {
    expect(verifyWebhookSignature(JSON.stringify({ id: "call_mock_x" }), "sha256=deadbeef")).toBe(false);
  });
});
