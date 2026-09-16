import assert from "node:assert/strict";
import test from "node:test";

import { createFakeCalleProvider } from "../lib/calle/fake-provider";
import { parseCalleCallSnapshot } from "../lib/calle/status";

test("fake CALL-E provider advances deterministic states without network or credentials", async () => {
  const provider = createFakeCalleProvider({
    callId: "call_offline123",
    snapshots: [
      { status: "queued", task_completed: null, recipients: [] },
      { status: "completed", task_completed: false, summary: "The recipient did not answer.", recipients: [] },
    ],
  });

  const accepted = await provider.fetch("https://api.heycall-e.com/v1/calls", { method: "POST", body: "{}" });
  const queued = parseCalleCallSnapshot(await accepted.json());
  const firstRead = await provider.fetch("https://api.heycall-e.com/v1/calls/call_offline123");
  const secondRead = await provider.fetch("https://api.heycall-e.com/v1/calls/call_offline123");

  assert.equal(accepted.status, 201);
  assert.equal(queued.outcome, "pending");
  assert.equal(parseCalleCallSnapshot(await firstRead.json()).outcome, "pending");
  assert.equal(parseCalleCallSnapshot(await secondRead.json()).outcome, "incomplete");
  assert.equal(provider.requestCount(), 3);
});

test("fake CALL-E provider fails closed for unexpected origins and routes", async () => {
  const provider = createFakeCalleProvider({
    callId: "call_offline123",
    snapshots: [{ status: "queued", recipients: [] }],
  });
  assert.equal((await provider.fetch("https://example.com/v1/calls")).status, 400);
  assert.equal((await provider.fetch("https://api.heycall-e.com/v1/unknown")).status, 404);
});
