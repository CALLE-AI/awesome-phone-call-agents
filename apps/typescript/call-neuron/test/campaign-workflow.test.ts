import assert from "node:assert/strict";
import test from "node:test";

import { onRequest } from "../functions/api/[[path]]";
import { buildCampaignCsv, canPlanRecipient, campaignMetrics, maskPhone, safeCsvCell, type CampaignResult, type Recipient } from "../src/campaign";
import { buildCallInstruction, type OfferBrief } from "../src/live";

const recipients: Recipient[] = [
  {
    id: "rec-01",
    studentName: "Test Student One",
    studentCode: "STU-001",
    recipientName: "Test Guardian One",
    phone: "+15550101001",
    recipientType: "guardian",
    employeeCode: "EMP-001",
    consentSource: "Signed test consent",
    consentTimestamp: "2026-08-01T10:00:00Z",
    status: "eligible",
  },
  {
    id: "rec-02",
    studentName: "Test Student Two",
    studentCode: "STU-002",
    recipientName: "Test Adult Two",
    phone: "+15550101002",
    recipientType: "adult_student",
    employeeCode: "EMP-001",
    consentSource: "Portal test consent",
    consentTimestamp: "2026-08-01T10:05:00Z",
    status: "eligible",
  },
];

const results: CampaignResult[] = [
  { recipientId: "rec-01", providerSignal: "completed", summary: "Test completed.", transcript: "Test transcript.", attemptedAt: "2026-08-01T11:00:00Z" },
  { recipientId: "rec-02", providerSignal: "voicemail", summary: "Test voicemail.", transcript: "", attemptedAt: "2026-08-01T11:05:00Z" },
];

const offer: OfferBrief = {
  organization: "Test Learning Centre",
  callbackPhone: "+15550102000",
  offer: "A staff-approved support conversation is available.",
  details: "No eligibility or award decision has been made.",
  escalation: "all eligibility and award questions",
};

test("campaign masks phones and exports only privacy-minimal fields", () => {
  const masked = maskPhone(recipients[0].phone);
  assert.equal(masked.includes(recipients[0].phone), false);
  assert.equal(masked.endsWith(recipients[0].phone.slice(-4)), true);

  const csv = buildCampaignCsv(results, { "rec-01": "interested" }, recipients);
  assert.match(csv, /student_code,employee_code,provider_signal,operator_disposition/u);
  assert.doesNotMatch(csv, /Test Guardian|Test Student|\+1555|transcript/iu);
  assert.equal(safeCsvCell("=2+2"), "'=2+2");
});

test("resolution metrics require operator dispositions", () => {
  assert.deepEqual(campaignMetrics(results, {}), {
    attempted: 2,
    resolved: 0,
    followUp: 2,
    resolutionRate: 0,
  });
  assert.deepEqual(campaignMetrics(results, { "rec-01": "interested", "rec-02": "unreachable" }), {
    attempted: 2,
    resolved: 1,
    followUp: 1,
    resolutionRate: 50,
  });
});

test("opted-out and durably attempted recipients cannot enter planning", () => {
  assert.equal(canPlanRecipient(recipients[0], undefined, false), true);
  assert.equal(canPlanRecipient(recipients[0], "opted_out", false), false);
  assert.equal(canPlanRecipient(recipients[0], "unreviewed", true), false);
  assert.equal(canPlanRecipient({ ...recipients[0], status: "blocked" }, "unreviewed", false), false);
});

test("voicemail policy is neutral and off by default", () => {
  const withoutVoicemail = buildCallInstruction(recipients[0], offer, false);
  const withVoicemail = buildCallInstruction(recipients[0], offer, true);
  assert.match(withoutVoicemail, /do not leave a voicemail/iu);
  assert.match(withVoicemail, /Please call us back at \+15550102000/u);
  const voicemail = withVoicemail.split("If nobody answers, leave only:")[1] || "";
  assert.doesNotMatch(voicemail, /Test Student One|STU-001/u);
});

test("a deployment without the operator gate rejects live CALL-E routes", async () => {
  const response = await onRequest({
    request: new Request("https://call-neuron.example/api/auth/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    }),
    env: {},
  });
  assert.equal(response.status, 403);
  assert.match(await response.text(), /disabled for this deployment/u);
});
