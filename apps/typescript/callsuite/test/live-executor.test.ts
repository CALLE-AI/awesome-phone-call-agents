import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createPinnedFetch, executeAuthorizedCall, type LiveCallClient } from "../src/live-executor.js";

const target = "+15550101234";

describe("production live executor boundary", () => {
  it("rejects an unauthorized target before constructing a client", async () => {
    let clientConstructed = false;

    await assert.rejects(
      executeAuthorizedCall(baseInput(new Set(["+15550105678"])), () => {
        clientConstructed = true;
        return completedClient();
      }),
      /not present.*No call was placed/i,
    );
    assert.equal(clientConstructed, false);
  });

  it("submits one authorized SDK request and normalizes its terminal result", async () => {
    let createCount = 0;
    const client = completedClient(() => {
      createCount += 1;
    });

    const execution = await executeAuthorizedCall(baseInput(new Set([target])), () => client);

    assert.equal(createCount, 1);
    assert.equal(execution.result.verdict, "fail");
    assert.equal(execution.result.exitCode, 1);
    assert.deepEqual(execution.result.automation, { blocked: true, attribution: "target" });
  });

  it("lets terminal platform failure override a structured target failure", async () => {
    const client = completedClient();
    const original = client.calls.createAndWait;
    client.calls.createAndWait = async (input) => ({
      ...(await original(input)),
      status: "failed",
    });

    const execution = await executeAuthorizedCall(baseInput(new Set([target])), () => client);

    assert.equal(execution.result.verdict, "error");
    assert.equal(execution.result.exitCode, 3);
    assert.deepEqual(execution.result.automation, { blocked: true, attribution: "none" });
  });

  it("pins credential-bearing requests to the approved HTTPS origin and refuses redirects", async () => {
    let received: Request | undefined;
    const protectedFetch = createPinnedFetch(async (request) => {
      received = request;
      return new Response("{}", { status: 200 });
    });

    await protectedFetch(
      new Request("https://api.heycall-e.com/v1/calls", {
        headers: { authorization: "Bearer test-only-key" },
      }),
    );

    assert.equal(received?.url, "https://api.heycall-e.com/v1/calls");
    assert.equal(received?.redirect, "error");
  });

  it("rejects lookalike and non-HTTPS CALL-E origins before making a request", async () => {
    let requestCount = 0;
    const protectedFetch = createPinnedFetch(async () => {
      requestCount += 1;
      return new Response("{}", { status: 200 });
    });

    await assert.rejects(
      protectedFetch(new Request("https://api.heycall-e.com.evil.test/v1/calls")),
      /approved HTTPS API origin/i,
    );
    await assert.rejects(
      protectedFetch(new Request("http://api.heycall-e.com/v1/calls")),
      /approved HTTPS API origin/i,
    );
    assert.equal(requestCount, 0);
  });
});

function baseInput(authorizedTargets: ReadonlySet<string>) {
  return {
    apiKey: "test-only-key",
    target,
    authorizedTargets,
    region: "US",
    locale: "en-US",
    task: "Test a fictional appointment disclosure.",
    resultSchema: { type: "object" },
    toVerdict: () => "fail" as const,
  };
}

function completedClient(onCreate: () => void = () => undefined): LiveCallClient {
  return {
    calls: {
      async createAndWait(input) {
        onCreate();
        return {
          id: "fictional-call-id",
          object: "call_task",
          status: "completed",
          task: input.task,
          recipients: [],
          structuredResult: {
            attendance_outcome: "confirmed",
            cancellation_fee_disclosed: "no",
          },
          summary: null,
          taskCompleted: true,
          completionConfidence: { label: "high", score: 0.95 },
          evidence: [],
          metadata: {},
          failureCode: null,
          failureMessage: null,
          createdAt: "2026-08-07T00:00:00.000Z",
          completedAt: "2026-08-07T00:01:00.000Z",
        };
      },
      async listEvents() {
        return { object: "list", data: [], nextCursor: null };
      },
    },
  };
}
