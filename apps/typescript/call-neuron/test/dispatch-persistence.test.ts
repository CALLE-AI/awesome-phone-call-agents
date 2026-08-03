import assert from "node:assert/strict";
import test from "node:test";

import "fake-indexeddb/auto";

import type { Recipient } from "../src/campaign";
import type { CallRun, OfferBrief, ReviewedPlan } from "../src/live";
import {
  beginDispatch,
  clearLocalDraft,
  fingerprintDispatch,
  loadDispatchAttempts,
  loadPhoneSuppressions,
  markAcceptanceUnknown,
  matchPhoneSuppressions,
  recordAcceptedRun,
  recordReviewedPlan,
  reserveDispatch,
  runFromAcceptedAttempt,
  saveLocalDraft,
} from "../src/persistence";

const recipient: Recipient = {
  id: "recipient-01",
  studentName: "Test Student",
  studentCode: "STU-001",
  recipientName: "Test Guardian",
  phone: "+15550101001",
  recipientType: "guardian",
  employeeCode: "EMP-001",
  consentSource: "Signed test consent",
  consentTimestamp: "2026-08-01T10:00:00Z",
  status: "eligible",
};

const offer: OfferBrief = {
  organization: "Test Learning Centre",
  callbackPhone: "+15550102000",
  offer: "A staff-approved support conversation is available.",
  details: "No eligibility or award decision has been made.",
  escalation: "all eligibility and award questions",
};

const plan: ReviewedPlan = {
  planId: "plan-01",
  confirmToken: "not-persisted",
  expiresAt: "2026-08-03T10:00:00Z",
  instruction: "Test instruction",
};

async function resetDatabase() {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase("call-neuron-local");
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function saveDraft(disposition: "unreviewed" | "opted_out" = "unreviewed") {
  await saveLocalDraft({
    sourceName: "test.csv",
    recipients: [recipient],
    offer,
    dispositions: { [recipient.id]: disposition },
    savedAt: "2026-08-02T10:00:00Z",
  });
}

test("dispatch fingerprints bind the recipient and exact approved content", async () => {
  const base = await fingerprintDispatch(recipient, offer, false);
  const voicemail = await fingerprintDispatch(recipient, offer, true);
  const changedOffer = await fingerprintDispatch(recipient, { ...offer, details: "Changed approved details." }, false);
  const reimported = await fingerprintDispatch({ ...recipient, id: "new-row-id" }, offer, false);
  const reassigned = await fingerprintDispatch({ ...recipient, id: "new-row-id", studentCode: "STU-999", employeeCode: "EMP-999" }, offer, false);

  assert.notEqual(base.contentBinding, voicemail.contentBinding);
  assert.notEqual(base.contentBinding, changedOffer.contentBinding);
  assert.equal(base.recipientKey, reimported.recipientKey);
  assert.equal(base.contentBinding, reimported.contentBinding);
  assert.equal(base.recipientKey, reassigned.recipientKey);
});

test("refresh, second-tab and lost-response states remain durably blocked", async () => {
  await resetDatabase();
  await saveDraft();

  const reservation = await reserveDispatch(recipient, offer, false);
  assert.equal(reservation.phase, "planning");
  await assert.rejects(() => reserveDispatch(recipient, offer, false), /already reserved|earlier session/iu);

  const planned = await recordReviewedPlan(reservation, plan);
  const dispatching = await beginDispatch(planned);
  const unresolved = await markAcceptanceUnknown(dispatching);
  assert.equal(unresolved.phase, "acceptance_unknown");

  const afterRefresh = await loadDispatchAttempts();
  assert.equal(afterRefresh.length, 1);
  assert.equal(afterRefresh[0].phase, "acceptance_unknown");
  assert.equal(afterRefresh[0].planId, plan.planId);
  assert.equal("confirmToken" in afterRefresh[0], false);
  await assert.rejects(() => reserveDispatch(recipient, { ...offer, details: "Different content" }, true), /may have been accepted|duplicate call/iu);

  await clearLocalDraft();
  assert.equal((await loadDispatchAttempts())[0].phase, "acceptance_unknown");
  await assert.rejects(() => reserveDispatch({ ...recipient, id: "reimported-id", studentCode: "STU-NEW", employeeCode: "EMP-NEW" }, offer, false), /may have been accepted|duplicate call/iu);
});

test("accepted run IDs survive refresh and provide same-run reconciliation", async () => {
  await resetDatabase();
  await saveDraft();
  const reservation = await reserveDispatch(recipient, offer, false);
  const planned = await recordReviewedPlan(reservation, plan);
  const dispatching = await beginDispatch(planned);
  const run: CallRun = {
    runId: "run-accepted-01",
    status: "QUEUED",
    summary: "Accepted",
    transcript: "Sensitive transcript must not persist",
    attemptedAt: "2026-08-02T10:05:00Z",
  };
  await recordAcceptedRun(dispatching, run);

  const [restoredAttempt] = await loadDispatchAttempts();
  const restoredRun = runFromAcceptedAttempt(restoredAttempt);
  assert.equal(restoredAttempt.runId, run.runId);
  assert.equal(restoredRun?.runId, run.runId);
  assert.equal(restoredRun?.status, "QUEUED");
  assert.equal(JSON.stringify(restoredAttempt).includes(run.transcript), false);
  await assert.rejects(() => reserveDispatch(recipient, offer, false), /already accepted|same run/iu);
});

test("opt-out is checked both before planning and again before dispatch", async () => {
  await resetDatabase();
  await saveDraft("opted_out");
  await assert.rejects(() => reserveDispatch(recipient, offer, false), /opted out/iu);

  await resetDatabase();
  await saveDraft();
  const reservation = await reserveDispatch(recipient, offer, false);
  const planned = await recordReviewedPlan(reservation, plan);
  await saveDraft("opted_out");
  await assert.rejects(() => beginDispatch(planned), /opted out/iu);
  assert.equal((await loadDispatchAttempts())[0].phase, "planned");
});

test("phone opt-outs survive reset and block re-imports with changed codes", async () => {
  await resetDatabase();
  await saveLocalDraft({
    sourceName: "opted-out.csv",
    recipients: [{ ...recipient, status: "blocked", blocker: "Consent withdrawn — Do Not Call" }],
    offer,
    dispositions: {},
    savedAt: "2026-08-03T09:00:00Z",
  });
  const phoneKeys = await loadPhoneSuppressions();
  assert.equal(phoneKeys.length, 1);

  await clearLocalDraft();
  const reimported = { ...recipient, id: "different-row", studentCode: "STU-999", employeeCode: "EMP-999" };
  const matches = await matchPhoneSuppressions([reimported], await loadPhoneSuppressions());
  assert.equal(matches[reimported.id], true);

  await saveLocalDraft({
    sourceName: "replacement.csv",
    recipients: [reimported],
    offer,
    dispositions: {},
    savedAt: "2026-08-03T10:00:00Z",
  });
  await assert.rejects(() => reserveDispatch(reimported, offer, false), /opted out/iu);
});
