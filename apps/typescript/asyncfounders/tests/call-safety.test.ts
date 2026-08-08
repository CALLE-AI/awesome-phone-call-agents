import assert from "node:assert/strict";
import test from "node:test";
import { fingerprint } from "../lib/callbacks.ts";
import { admittedMemoryItems, approvedCallContext, fingerprintInput, recipientQuietHours, type PreviewCore } from "../lib/call-safety.ts";

const core: PreviewCore = {
  previewId: "11111111-1111-4111-8111-111111111111",
  companyId: "22222222-2222-4222-8222-222222222222",
  companyVersion: 7,
  companyName: "Acme",
  memberId: "33333333-3333-4333-8333-333333333333",
  mode: "catchup",
  provider: "calle",
  requestedBy: "44444444-4444-4444-8444-444444444444",
  createdAt: "2026-08-08T10:00:00.000Z",
  expiresAt: "2026-08-08T10:10:00.000Z",
  task: "Deliver only the approved unseen company delta.",
  contextVersion: 7,
  recipient: { displayName: "Ada", region: "IN", locale: "en-IN", timezone: "UTC", quietHoursStart: "22:00", quietHoursEnd: "08:00", phoneLastFour: "3210" },
  metadata: { workflow: "asyncfounders", company_id: "22222222-2222-4222-8222-222222222222", session_id: "11111111-1111-4111-8111-111111111111", schema_version: "async-memory-v3" },
};

test("review fingerprint binds destination, task, locale, and company version", async () => {
  const reviewed = await fingerprint(fingerprintInput(core, "+919876543210"));
  assert.notEqual(reviewed, await fingerprint(fingerprintInput(core, "+919876543211")));
  assert.notEqual(reviewed, await fingerprint(fingerprintInput({ ...core, task: `${core.task} Changed.` }, "+919876543210")));
  assert.notEqual(reviewed, await fingerprint(fingerprintInput({ ...core, companyVersion: 8 }, "+919876543210")));
  assert.notEqual(reviewed, await fingerprint(fingerprintInput({ ...core, recipient: { ...core.recipient, locale: "hi-IN" } }, "+919876543210")));
});

test("recipient-local quiet hours handle overnight windows and invalid zones", () => {
  assert.equal(recipientQuietHours({ timezone: "UTC", start: "22:00", end: "08:00" }, new Date("2026-08-08T23:00:00Z")).quiet, true);
  assert.equal(recipientQuietHours({ timezone: "UTC", start: "22:00", end: "08:00" }, new Date("2026-08-08T12:00:00Z")).quiet, false);
  assert.equal(recipientQuietHours({ timezone: "Invalid/Zone", start: "22:00", end: "08:00" }).quiet, true);
});

test("catchup and ask require approved company context", () => {
  const memories = [{ version: 9, kind: "question", title: "Pricing owner", body: "Who owns the pricing decision?", status: "open", confidence: 0.8, source_excerpt: "Pricing ownership remains open." }];
  assert.match(approvedCallContext("catchup", memories, 7).briefing ?? "", /Pricing owner/);
  assert.match(approvedCallContext("ask", memories, 7).briefing ?? "", /Who owns the pricing decision/);
  assert.ok(approvedCallContext("catchup", memories, 9).reason);
  assert.ok(approvedCallContext("ask", [], 0).reason);
});

test("ambiguous or uncorroborated provider memory fails closed", () => {
  const item = { type: "decision", title: "Private beta", body: "Ship to five teams.", status: "accepted", confidence: "high" as const, source_excerpt: "Five teams is the approved private beta.", audience: ["team"] };
  assert.equal(admittedMemoryItems({ outcome: "unknown", memory_items: [item] }, [item.source_excerpt]).length, 0);
  assert.equal(admittedMemoryItems({ outcome: "complete", memory_items: [item] }, ["The weather is clear today."]).length, 0);
  assert.equal(admittedMemoryItems({ outcome: "complete", memory_items: [item] }, ["Yes, five teams is the approved private beta."]).length, 1);
});
