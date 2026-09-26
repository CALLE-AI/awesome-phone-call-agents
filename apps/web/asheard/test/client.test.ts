import assert from "node:assert/strict";
import test from "node:test";

import { CalleClient } from "asheard/calle";

/**
 * Stand in for the API with a fixed script of responses, one per read.
 *
 * No network. Each entry is what GET /v1/calls/{id} hands back on that read,
 * in order, and the last entry repeats once the script runs out.
 */
function stubFetch(script: Array<Record<string, unknown>>): () => void {
  const original = globalThis.fetch;
  let read = 0;
  globalThis.fetch = (async () => {
    const body = script[Math.min(read, script.length - 1)];
    read += 1;
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

const client = () => new CalleClient({ apiKey: "iams_live_test" });

test("a terminal status with the result already on it returns straight away", async () => {
  const restore = stubFetch([
    { id: "call_1", status: "completed", structured_result: { open_saturday: "yes" } },
  ]);
  try {
    const { call, settledAfterMs } = await client().waitForResult("call_1", {
      settleForResult: true,
      intervalMs: 1,
    });
    assert.equal(call.status, "completed");
    assert.equal(settledAfterMs, 0, "nothing to wait for, so nothing was waited for");
  } finally {
    restore();
  }
});

test("a terminal status with no result yet keeps reading until one turns up", async () => {
  const restore = stubFetch([
    { id: "call_2", status: "failed", structured_result: null },
    { id: "call_2", status: "failed", structured_result: null },
    { id: "call_2", status: "failed", structured_result: { open_saturday: "unknown" } },
  ]);
  try {
    const { call, settledAfterMs } = await client().waitForResult("call_2", {
      settleForResult: true,
      intervalMs: 1,
      settleMs: 2_000,
    });
    assert.deepEqual(call.structured_result, { open_saturday: "unknown" });
    assert.ok(settledAfterMs > 0, "the wait has to be recorded, not hidden");
  } finally {
    restore();
  }
});

test("a result that never arrives gives back the call rather than hanging", async () => {
  const restore = stubFetch([{ id: "call_3", status: "failed", structured_result: null }]);
  try {
    const { call, settledAfterMs } = await client().waitForResult("call_3", {
      settleForResult: true,
      intervalMs: 1,
      settleMs: 30,
    });
    assert.equal(call.id, "call_3");
    assert.equal(call.structured_result, null);
    assert.ok(settledAfterMs > 0);
  } finally {
    restore();
  }
});

test("without settleForResult a terminal read is returned as-is", async () => {
  const restore = stubFetch([
    { id: "call_4", status: "failed", structured_result: null },
    { id: "call_4", status: "failed", structured_result: { open_saturday: "unknown" } },
  ]);
  try {
    const { call } = await client().waitForResult("call_4", { intervalMs: 1 });
    assert.equal(call.structured_result, null, "opting out means opting out");
  } finally {
    restore();
  }
});

test("giving up on watching is not the same as the call ending", async () => {
  const restore = stubFetch([{ id: "call_5", status: "in_progress" }]);
  try {
    await assert.rejects(
      () => client().waitForResult("call_5", { intervalMs: 1, timeoutMs: 5 }),
      (error: Error) => {
        assert.equal(error.name, "WatchTimeoutError");
        assert.match(error.message, /still running/);
        return true;
      },
    );
  } finally {
    restore();
  }
});
