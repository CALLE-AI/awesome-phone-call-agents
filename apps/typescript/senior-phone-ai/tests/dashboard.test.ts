import assert from "node:assert/strict";
import test from "node:test";

import { parseFamilyMutation } from "../lib/dashboard/mutations";
import { lastCompletedCall, maskedDestination, safeDashboardText } from "../lib/dashboard/workspace";

test("dashboard text masks international, formatted and local phone numbers", () => {
  assert.equal(safeDashboardText("Call +61 449 852 021 or 0449-852-021"), "Call [phone ending 2021] or [phone ending 2021]");
  assert.equal(maskedDestination("+61449852021"), "[phone ending 2021]");
  assert.equal(safeDashboardText({ nested: "(02) 9876 5432" }), '{"nested":"[phone ending 5432]"}');
});

test("last completed call uses a recorded terminal timestamp", () => {
  const calls = [
    { id: "1", seniorId: "senior", status: "completed", endedAt: "2026-09-10T00:00:00Z" },
    { id: "2", seniorId: "senior", status: "failed", endedAt: "2026-09-11T00:00:00Z" },
    { id: "3", seniorId: "senior", status: "completed", endedAt: "2026-09-12T00:00:00Z" },
  ];
  assert.equal(lastCompletedCall(calls, "senior")?.id, "3");
  assert.equal(lastCompletedCall([{ id: "4", seniorId: "senior", status: "completed" }], "senior"), undefined);
});

test("family mutations reject invalid identifiers, timezones and retention", () => {
  assert.throws(() => parseFamilyMutation({ action: "update_profile", seniorId: "not-an-id", displayName: "Margaret", timezone: "Australia/Sydney" }));
  assert.throws(() => parseFamilyMutation({ action: "update_profile", seniorId: "20000000-0000-4000-8000-000000000001", displayName: "Margaret", timezone: "Mars/Base" }), /IANA/);
  assert.throws(() => parseFamilyMutation({ action: "update_preferences", seniorId: "20000000-0000-4000-8000-000000000001", storeTranscripts: false, storeSummaries: true, retentionDays: 0 }));
});
