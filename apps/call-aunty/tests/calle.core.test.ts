import { describe, expect, it } from "vitest";

import { CalleGateway } from "../server/calle/client";
import { normalizePhone } from "../server/calle/phone";
import { validateCallPolicy } from "../server/calle/policy";
import { auntyCareResultSchema } from "../server/calle/schema";
import { CalleService } from "../server/calle/service";

describe("CALL-E core", () => {
  it("normalizes E.164", () => {
    expect(normalizePhone(" +1 (416) 555-0123 ")).toBe("+14165550123");
  });

  it("rejects secret disclosure", () => {
    expect(() =>
      validateCallPolicy({
        task: "Ask for the password",
        recipients: [{ phones: ["+14165550123"], region: "CA" }],
        idempotencyKey: "abcdefghi",
      }),
    ).toThrow();
  });

  it("accepts a structured result schema", () => {
    expect(() =>
      validateCallPolicy({
        task: "Confirm a family check-in",
        recipients: [{ phones: ["+14165550123"], region: "CA" }],
        idempotencyKey: "abcdefghi",
        recipientResultSchema: auntyCareResultSchema,
      }),
    ).not.toThrow();
  });

  it("creates a mock call", async () => {
    const gateway = new CalleGateway("mock");
    const call = await gateway.createCall({
      task: "Confirm a family check-in",
      recipients: [{ phones: ["+14165550123"], region: "CA" }],
      idempotencyKey: "mock-core-123456",
    });
    expect(call.status).toBe("completed");
  });

  it("deduplicates with the service", async () => {
    const service = new CalleService(new CalleGateway("mock"));
    const request = {
      task: "Confirm a family check-in",
      recipients: [{ phones: ["+14165550123"], region: "CA" }],
      idempotencyKey: "dedupe-core-123456",
    };
    const first = await service.createCall(request);
    const second = await service.createCall(request);
    expect(first.id).toBe(second.id);
  });
});
