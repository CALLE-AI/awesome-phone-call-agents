import assert from "node:assert/strict";
import test from "node:test";
import { callStateLabel, elapsedCallSeconds, formatCallDuration, type CareCallListItem } from "../src/carecall/call-operations";

function item(overrides: Partial<CareCallListItem> = {}): CareCallListItem {
  return {
    job_id: "job-1",
    source: "manual",
    status: "queued",
    senior: { id: "senior-1", preferred_name: "Senior One" },
    routine: { id: "routine-1", title: "Lunch check-in", kind: "meal" },
    scheduled_for: "2026-08-06T04:00:00.000Z",
    created_at: "2026-08-06T03:59:00.000Z",
    updated_at: "2026-08-06T03:59:00.000Z",
    ...overrides,
  };
}

test("call state labels distinguish future schedules from the ready queue", () => {
  assert.equal(callStateLabel(item(), Date.parse("2026-08-06T03:00:00.000Z")), "Scheduled");
  assert.equal(callStateLabel(item({ queue_position: 2 }), Date.parse("2026-08-06T04:00:01.000Z")), "Waiting · position 2");
});

test("call duration formatting and live elapsed time remain explicit", () => {
  assert.equal(formatCallDuration(65), "1m 5s");
  assert.equal(formatCallDuration(undefined), "Not available");
  assert.equal(elapsedCallSeconds(item({ status: "ongoing", started_at: "2026-08-06T04:00:00.000Z" }), Date.parse("2026-08-06T04:00:12.000Z")), 12);
});
