import assert from "node:assert/strict";
import test from "node:test";

import { assertCalleCallId, parseCalleCallIds, parseCalleCallSnapshot } from "../lib/calle/status";

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
  assert.equal(snapshot.outcome, "pending");
  assert.deepEqual(snapshot.transcript, [
    { id: "att_123-0", offsetSeconds: 2, speaker: "assistant", text: "Hello, I am Senior Phone AI." },
    { id: "att_123-1", offsetSeconds: 8, speaker: "caller", text: "Please call [phone ending 1222] later." },
  ]);
  assert.equal(JSON.stringify(snapshot).includes("private-provider-id"), false);
  assert.equal(JSON.stringify(snapshot).includes("Private provider instruction"), false);
});

test("CALL-E terminal outcomes stay coarse when no-answer and voicemail have no stable enum", () => {
  const completed = parseCalleCallSnapshot({ id: "call_complete", status: "completed", task_completed: true, recipients: [] });
  const incomplete = parseCalleCallSnapshot({ id: "call_noanswer", status: "completed", task_completed: false, summary: "No answer.", recipients: [] });
  const missingJudgment = parseCalleCallSnapshot({ id: "call_voicemail", status: "completed", task_completed: null, summary: "Voicemail reached.", recipients: [] });
  const failed = parseCalleCallSnapshot({ id: "call_failed", status: "failed", failure_code: "opaque", recipients: [] });
  const canceled = parseCalleCallSnapshot({ id: "call_canceled", status: "canceled", recipients: [] });
  const unknown = parseCalleCallSnapshot({ id: "call_unknown", status: "new-provider-state", recipients: [] });

  assert.equal(completed.outcome, "completed");
  assert.equal(incomplete.outcome, "incomplete");
  assert.equal(missingJudgment.outcome, "incomplete");
  assert.equal(failed.outcome, "failed");
  assert.equal(canceled.outcome, "canceled");
  assert.equal(unknown.outcome, "unknown");
  assert.equal(JSON.stringify(failed).includes("opaque"), false);
});

test("CALL-E call IDs are validated before provider requests", () => {
  assert.equal(assertCalleCallId("call_abc-123"), "call_abc-123");
  assert.throws(() => assertCalleCallId("../calls"), /invalid CALL-E call ID/);
});

test("configured CALL-E call IDs are deduplicated and bounded", () => {
  assert.deepEqual(parseCalleCallIds("call_first, call_second,call_first"), ["call_first", "call_second"]);
  assert.deepEqual(parseCalleCallIds(undefined), []);
  assert.throws(() => parseCalleCallIds("call_safe,not-a-call"), /invalid CALL-E call ID/);
});
