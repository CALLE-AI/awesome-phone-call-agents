import { describe, expect, it } from "vitest";

import { vendorResultSchema } from "../dispatch/task";
import { createCallePort } from "./client";

const createdCall = {
  id: "call_test_1",
  object: "call_task",
  status: "queued",
  task: "Ask for availability.",
  recipients: [
    {
      id: "recipient_test_1",
      phones: ["+14155550100"],
      locale: null,
      region: null,
      status: "pending",
      structured_result: null,
      summary: null,
      attempts: [],
    },
  ],
  structured_result: null,
  summary: null,
  task_completed: null,
  completion_confidence: null,
  evidence: [],
  metadata: { workflow: "bellwrench_dispatch" },
  failure_code: null,
  failure_message: null,
  created_at: "2026-08-04T22:00:00.000Z",
  completed_at: null,
};

describe("createCallePort", () => {
  it("uses the SDK request contract and idempotency header without external I/O", async () => {
    const requests: Request[] = [];
    const fakeFetch = async (request: Request) => {
      requests.push(request);
      return Response.json(createdCall, { status: 201 });
    };
    const port = createCallePort("test-key", {
      baseUrl: "http://127.0.0.1:4312",
      environment: "test",
      fetch: fakeFetch,
    });

    const result = await port.create(
      {
        task: "Ask for availability.",
        recipient: { phone: "+14155550100" },
        recipientResultSchema: vendorResultSchema,
        metadata: { workflow: "bellwrench_dispatch" },
      },
      { idempotencyKey: "bellwrench:test:key" },
    );

    expect(result.id).toBe("call_test_1");
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe("http://127.0.0.1:4312/v1/calls");
    expect(requests[0].headers.get("authorization")).toBe("Bearer test-key");
    expect(requests[0].headers.get("idempotency-key")).toBe(
      "bellwrench:test:key",
    );
    await expect(requests[0].clone().json()).resolves.toMatchObject({
      task: "Ask for availability.",
      recipients: [{ phones: ["+14155550100"] }],
      recipient_result_schema: vendorResultSchema,
      metadata: { workflow: "bellwrench_dispatch" },
    });
  });

  it("refuses an unsafe base URL before a client can hold the credential", () => {
    expect(() =>
      createCallePort("must-not-leave", {
        baseUrl: "https://api.heycall-e.com.attacker.test",
        environment: "production",
      }),
    ).toThrow(/CALLE_BASE_URL/);
  });
});
