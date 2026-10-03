import { describe, expect, it } from "vitest";
import { MemoryCallRepository } from "../server/calle-v4/repository";
import { stableKey } from "../server/calle-v4/idempotency";
import { normalizePhones } from "../server/calle-v4/phone";
import { redact } from "../server/calle-v4/redact";

describe("CALL-E V4 integration primitives", () => {
  it("normalizes E.164 values", () =>
    expect(normalizePhones(["+14165551234", "+14165551234"])).toEqual(["+14165551234"]));
  it("creates stable idempotency keys", () => expect(stableKey(["a", "b"])).toBe(stableKey(["a", "b"])));
  it("redacts credential-like numbers", () => expect(redact("code 123456")).toContain("[REDACTED]"));
  it("deduplicates webhook events", async () => {
    const repo = new MemoryCallRepository();
    const event = {
      id: "e1",
      type: "completed",
      created_at: new Date().toISOString(),
      data: {
        id: "c1",
        object: "call_task" as const,
        status: "completed" as const,
        task: "x",
        recipients: [],
        structured_result: null,
        summary: null,
        task_completed: null,
        completion_confidence: null,
        evidence: [],
        metadata: {},
      },
    };
    expect(await repo.putEvent(event)).toBe(true);
    expect(await repo.putEvent(event)).toBe(false);
  });
});
