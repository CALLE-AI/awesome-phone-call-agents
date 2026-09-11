import assert from "node:assert/strict";
import test from "node:test";
import { fingerprint } from "../lib/callbacks.ts";
import { admittedMemoryItems, approvedCallContext, fingerprintInput, providerMetadataMatches, providerSessionMatches, recipientQuietHours, recipientTranscriptEvidence, reviewedProviderPhone, type PreviewCore, type StoredPreview } from "../lib/call-safety.ts";

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

test("catchup advances only through the oldest thirty included updates", () => {
  const memories = Array.from({ length: 35 }, (_, index) => ({ version: 35 - index, kind: "fact", title: `Update ${35 - index}`, body: "Company update.", status: "accepted", confidence: 0.9, source_excerpt: null }));
  const context = approvedCallContext("catchup", memories, 0);
  assert.equal(context.contextVersion, 30);
  assert.match(context.briefing ?? "", /\[v1 /);
  assert.match(context.briefing ?? "", /\[v30 /);
  assert.doesNotMatch(context.briefing ?? "", /\[v31 /);
});

test("catchup cursor excludes updates omitted by the briefing byte budget", () => {
  const memories = Array.from({ length: 4 }, (_, index) => ({ version: index + 1, kind: "fact", title: `Long update ${index + 1}`, body: "x".repeat(5_000), status: "accepted", confidence: 0.9, source_excerpt: null }));
  const context = approvedCallContext("catchup", memories, 0);
  assert.equal(context.contextVersion, 2);
  assert.doesNotMatch(context.briefing ?? "", /\[v3 /);
});

test("ambiguous or uncorroborated provider memory fails closed", () => {
  const item = { type: "decision", title: "Private beta", body: "Ship to five teams.", status: "accepted", confidence: "high" as const, source_excerpt: "Five teams is the approved private beta.", audience: ["team"] };
  assert.equal(admittedMemoryItems({ outcome: "unknown", memory_items: [item] }, [item.source_excerpt]).length, 0);
  assert.equal(admittedMemoryItems({ outcome: "complete", memory_items: [item] }, ["The weather is clear today."]).length, 0);
  assert.equal(admittedMemoryItems({ outcome: "complete", memory_items: [item] }, ["Yes, five teams is the approved private beta."]).length, 1);
});

test("a denial cannot corroborate an affirmative memory claim", () => {
  const denied = { type: "decision", title: "Private beta approved", body: "The founder approved the private beta.", status: "accepted", confidence: "high" as const, source_excerpt: "We did not approve the private beta.", audience: ["team"] };
  assert.equal(admittedMemoryItems({ outcome: "complete", memory_items: [denied] }, ["Founder: We did not approve the private beta."]).length, 0);
  assert.equal(admittedMemoryItems({ outcome: "complete", memory_items: [{ ...denied, source_excerpt: "We didn’t approve the private beta." }] }, ["Founder: We didn’t approve the private beta."]).length, 0);
});

test("negative contractions cannot corroborate an affirmative memory claim", () => {
  const affirmative = { type: "decision", title: "Private beta approved", body: "The founder approved the private beta.", status: "accepted", confidence: "high" as const, source_excerpt: "approve the private beta", audience: ["team"] };
  for (const evidence of [
    "I don't approve the private beta.",
    "I don’t approve the private beta.",
    "I didn't approve the private beta.",
    "I can’t approve the private beta.",
    "I won't approve the private beta.",
  ]) {
    assert.equal(admittedMemoryItems({ outcome: "complete", memory_items: [affirmative] }, [evidence]).length, 0, evidence);
  }
});

test("only recipient-authored turns can corroborate memory", () => {
  const evidence = recipientTranscriptEvidence([{ attempts: [{ transcriptTurns: [
    { speaker: "bot", text: "The private beta was approved." },
    { speaker: "user", text: "I did not approve the private beta." },
  ] }] }]);
  const affirmative = { type: "decision", title: "Private beta approved", body: "The founder approved the private beta.", status: "accepted", confidence: "high" as const, source_excerpt: "approved the private beta", audience: ["team"] };
  assert.deepEqual(evidence, ["I did not approve the private beta."]);
  assert.equal(admittedMemoryItems({ outcome: "complete", memory_items: [affirmative] }, evidence).length, 0);
});

test("provider metadata and recipient must match the reviewed envelope", () => {
  assert.equal(providerMetadataMatches(core.metadata, { ...core.metadata }), true);
  assert.equal(providerMetadataMatches(core.metadata, { ...core.metadata, session_id: "55555555-5555-4555-8555-555555555555" }), false);
  const recipient = { phones: ["+919876543210"], region: "IN", locale: "en-IN", attempts: [{ phone: "+919876543210" }] };
  assert.equal(reviewedProviderPhone(core.recipient, recipient), "+919876543210");
  assert.equal(reviewedProviderPhone(core.recipient, { ...recipient, locale: "hi-IN" }), null);
  assert.equal(reviewedProviderPhone(core.recipient, { ...recipient, attempts: [{ phone: "+919876543211" }] }), null);
});

test("provider call identity must match the reviewed session", () => {
  const preview: StoredPreview = { ...core, fingerprint: "a".repeat(64), maskedPhone: "+91 •••••• 3210", purpose: "Brief the founder", questions: [], duration: "About 3 minutes" };
  const session = { id: core.previewId, company_id: core.companyId, member_id: core.memberId, requested_by: core.requestedBy, mode: core.mode, provider: core.provider, provider_call_id: "call_123", payload_fingerprint: preview.fingerprint };
  assert.equal(providerSessionMatches(preview, session, { id: "call_123", task: core.task }), true);
  assert.equal(providerSessionMatches(preview, session, { id: "call_other", task: core.task }), false);
  assert.equal(providerSessionMatches(preview, session, { id: "call_123", task: "A changed task" }), false);
});
