import assert from "node:assert/strict";
import test from "node:test";

import { assertCalleCallId, parseCalleCallSnapshot } from "../lib/calle/status";

test("CALL-E snapshots expose bounded conversation turns without provider identifiers", () => {
  const snapshot = parseCalleCallSnapshot({
    id: "call_safe123",
    status: "in_progress",
    task: "Private provider instruction",
    recipients: [{
      phones: ["+61400111222"],
      attempts: [{
        id: "att_123",
        provider_call_id: "private-provider-id",
        transcript_turns: [
          { offset_seconds: 2.2, speaker: "bot", text: "Hello, I am Senior Phone AI." },
          { offset_seconds: 8, speaker: "user", text: "Please call +61 400 111 222 later." },
          { offset_seconds: 9, speaker: "tool", text: "hidden tool payload" },
        ],
      }],
    }],
  }, () => Date.parse("2026-09-11T00:00:00.000Z"));

  assert.equal(snapshot.status, "in_progress");
  assert.deepEqual(snapshot.transcript, [
    { id: "att_123-0", offsetSeconds: 2, speaker: "assistant", text: "Hello, I am Senior Phone AI." },
    { id: "att_123-1", offsetSeconds: 8, speaker: "caller", text: "Please call [phone ending 1222] later." },
  ]);
  assert.equal(JSON.stringify(snapshot).includes("private-provider-id"), false);
  assert.equal(JSON.stringify(snapshot).includes("Private provider instruction"), false);
});

test("CALL-E call IDs are validated before provider requests", () => {
  assert.equal(assertCalleCallId("call_abc-123"), "call_abc-123");
  assert.throws(() => assertCalleCallId("../calls"), /invalid CALL-E call ID/);
});
