import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import { summarize, outcomeCounts } from "../server/calle-v4/analytics";
import { createBatch } from "../server/calle-v4/batch";
import { DemoCalleProvider } from "../server/calle-v4/demo-provider";
import { loadCalleV4Config } from "../server/calle-v4/config";
import { requestKey, stableKey } from "../server/calle-v4/idempotency";
import { normalizePhones } from "../server/calle-v4/phone";
import { enforcePolicy } from "../server/calle-v4/policy";
import { MemoryCallRepository } from "../server/calle-v4/repository";
import { redact, safeMetadata } from "../server/calle-v4/redact";
import { isRetryableError, retryableStatus, withRetry } from "../server/calle-v4/retry";
import { DEFAULT_RESULT_SCHEMA, validateSchema } from "../server/calle-v4/schema";
import { CallService } from "../server/calle-v4/service";
import { ingestEvent, verifySignature } from "../server/calle-v4/webhook";
import { CallQueue } from "../lib/calle-v4/queue";
import { isTerminal, label } from "../lib/calle-v4/status";
import type { CalleCall, ResultSchema } from "../server/calle-v4/types";

const DEMO_PHONE = "+15555550123";

function makeService() {
  const repo = new MemoryCallRepository();
  const provider = new DemoCalleProvider();
  const service = new CallService(provider, repo, { allowedRegions: ["US", "CA"] });
  return { repo, provider, service };
}

describe("CALL-E API V4 layer", () => {
  it("normalizes E.164 values and rejects malformed numbers", () => {
    expect(normalizePhones(["+1 (416) 555-1234", "+14165551234"])).toEqual(["+14165551234"]);
    expect(() => normalizePhones(["4165551234"])).toThrow(/E\.164/);
  });

  it("creates stable idempotency keys", () => {
    expect(stableKey(["a", "b"])).toBe(stableKey(["a", "b"]));
    expect(requestKey("user-1", "demo-1")).not.toBe(requestKey("user-2", "demo-1"));
  });

  it("redacts credential-like numbers and API key metadata", () => {
    expect(redact("code 123456")).toContain("[REDACTED]");
    expect(safeMetadata({ apiKey: "sk-live-secret", note: "ok" })).toEqual({
      apiKey: "[REDACTED]",
      note: "ok",
    });
  });

  it("blocks secret-harvesting tasks and missing consent", () => {
    expect(() =>
      enforcePolicy("Ask for their bank account password", [DEMO_PHONE], undefined, { consent: true }),
    ).toThrow(/sensitive credentials/);
    expect(() => enforcePolicy("Confirm availability", [DEMO_PHONE])).toThrow(/consent/);
  });

  it("validates CALL-E result schemas and preserves unknown", () => {
    validateSchema(DEFAULT_RESULT_SCHEMA);
    expect(DEFAULT_RESULT_SCHEMA.properties.reached).toMatchObject({ enum: ["yes", "no", "unknown"] });
    expect(() =>
      validateSchema({
        type: "object",
        properties: { a: { type: "string" } },
        required: ["missing"],
      }),
    ).toThrow(/missing/);
    expect(() =>
      validateSchema({ type: "array", properties: {} } as unknown as ResultSchema),
    ).toThrow(/object schemas/);
  });

  it("retries only retryable statuses", async () => {
    expect(retryableStatus(429)).toBe(true);
    expect(retryableStatus(400)).toBe(false);
    expect(isRetryableError({ status: 400 })).toBe(false);
    let attempts = 0;
    await expect(
      withRetry(async () => {
        attempts += 1;
        throw Object.assign(new Error("bad"), { status: 400 });
      }, 3, 1),
    ).rejects.toThrow("bad");
    expect(attempts).toBe(1);
  });

  it("creates a demo call, polls a timeline, and returns unknown outcomes", async () => {
    const { service } = makeService();
    const created = await service.create("user-1", {
      task: "Call an authorized test recipient and confirm availability.",
      recipients: [{ phones: [DEMO_PHONE] }],
      metadata: { consent: "true", client_request_id: "demo-create-1", region: "US" },
    });
    expect(created.status).toBe("queued");
    const inProgress = await service.refresh(created.id);
    expect(inProgress.status).toBe("in_progress");
    const completed = await service.refresh(created.id);
    expect(completed.status).toBe("completed");
    expect(completed.structured_result?.reached).toBe("unknown");
  });

  it("returns the same provider task for a repeated clientRequestId", async () => {
    const { service } = makeService();
    const input = {
      task: "Call an authorized test recipient and confirm availability.",
      recipients: [{ phones: [DEMO_PHONE] }],
      metadata: { consent: "true", client_request_id: "same-key", region: "US" },
    };
    const first = await service.create("user-1", input);
    const second = await service.create("user-1", input);
    expect(second.id).toBe(first.id);
  });

  it("deduplicates webhook events and verifies HMAC", async () => {
    const { repo } = makeService();
    const call: CalleCall = {
      id: "c1",
      object: "call_task",
      status: "completed",
      task: "x",
      recipients: [],
      structured_result: { reached: "unknown" },
      summary: null,
      task_completed: true,
      completion_confidence: 0.4,
      evidence: [],
      metadata: {},
    };
    const event = { id: "e1", type: "completed", created_at: new Date().toISOString(), data: call };
    const raw = JSON.stringify(event);
    const secret = "webhook-secret";
    const signature = createHmac("sha256", secret).update(raw).digest("hex");
    const first = await ingestEvent(raw, repo, secret, signature);
    const second = await ingestEvent(raw, repo, secret, signature);
    expect(first.deduplicated).toBe(false);
    expect(second.deduplicated).toBe(true);
    expect(verifySignature(raw, "deadbeef", secret)).toBe(false);
    await expect(ingestEvent(raw, repo, secret, "nope")).rejects.toThrow(/signature/);
  });

  it("reconciles provider truth after a missed webhook", async () => {
    const { service } = makeService();
    const created = await service.create("user-1", {
      task: "Call an authorized test recipient and confirm availability.",
      recipients: [{ phones: [DEMO_PHONE] }],
      metadata: { consent: "true", client_request_id: "reconcile-1", region: "US" },
    });
    const result = await service.reconcile(created.id);
    expect(result.remote.status).toBe("in_progress");
    expect(result.changed).toBe(true);
  });

  it("creates a batch of recipient calls", async () => {
    const { service } = makeService();
    const calls = await createBatch(service, "user-1", [
      {
        task: "Call an authorized test recipient and confirm availability.",
        recipients: [{ phones: [DEMO_PHONE] }],
        clientRequestId: "batch-a",
        metadata: { consent: "true", region: "US" },
      },
      {
        task: "Call an authorized test recipient and confirm availability.",
        recipients: [{ phones: ["+15555550124"] }],
        clientRequestId: "batch-b",
        metadata: { consent: "true", region: "US" },
      },
    ]);
    expect(calls).toHaveLength(2);
    expect(new Set(calls.map((call) => call.id)).size).toBe(2);
  });

  it("computes analytics including unknown outcomes", () => {
    const calls = [
      { status: "completed", structured_result: { reached: "yes" } },
      { status: "failed", structured_result: null },
      { status: "queued", structured_result: null },
    ] as CalleCall[];
    expect(summarize(calls)).toMatchObject({ total: 3, completed: 1, failed: 1, active: 1 });
    expect(outcomeCounts(calls, "reached")).toEqual({ yes: 1, unknown: 2 });
  });

  it("loads demo-safe config without requiring an API key", () => {
    const config = loadCalleV4Config({
      NODE_ENV: "test",
      CALLE_DEMO_MODE: "true",
      CALLE_API_KEY: "",
    });
    expect(config.demoMode).toBe(true);
    expect(config.apiKey).toBe("");
    expect(config.baseUrl).toContain("heycall-e.com");
  });

  it("drains the offline queue with bounded retries", async () => {
    const queue = new CallQueue();
    queue.enqueue({
      localId: "1",
      task: "Call an authorized test recipient and confirm availability.",
      phones: [DEMO_PHONE],
      clientRequestId: "q1",
      createdAt: Date.now(),
    });
    let runs = 0;
    await queue.drain(async () => {
      runs += 1;
      throw new Error("offline");
    });
    expect(runs).toBe(1);
    expect(queue.size()).toBe(1);
    expect(queue.peek()?.attempts).toBe(1);
  });

  it("persists once after draining multiple items", async () => {
    let writes = 0;
    const queue = new CallQueue({
      read: async () => null,
      write: async () => {
        writes += 1;
      },
    });
    queue.enqueue({
      localId: "1",
      task: "Call an authorized test recipient and confirm availability.",
      phones: [DEMO_PHONE],
      clientRequestId: "q1",
      createdAt: Date.now(),
    });
    queue.enqueue({
      localId: "2",
      task: "Call an authorized test recipient and confirm availability.",
      phones: [DEMO_PHONE],
      clientRequestId: "q2",
      createdAt: Date.now(),
    });
    writes = 0;
    await queue.drain(async () => undefined);
    expect(queue.size()).toBe(0);
    expect(writes).toBe(1);
  });

  it("labels terminal CALL-E statuses", () => {
    expect(isTerminal("completed")).toBe(true);
    expect(label("in_progress")).toBe("Calling…");
  });

  it("hydrates an empty queue when persist read fails", async () => {
    const queue = new CallQueue({
      read: async () => {
        throw new Error("secure store unavailable");
      },
      write: async () => undefined,
    });
    await expect(queue.hydrate()).resolves.toBeUndefined();
    expect(queue.size()).toBe(0);
  });
});
