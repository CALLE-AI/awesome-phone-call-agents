import assert from "node:assert/strict";
import test from "node:test";

import {
  CampaignLifecycleError,
  parseCampaignLaunchApproval,
  parseCampaignPreviewInput,
  prepareCampaignLaunch,
} from "../lib/campaigns/lifecycle";
import type { SafeCallDraft } from "../lib/calle/safety";
import type { Contact } from "../types/campaign";

const campaignId = "11111111-1111-4111-8111-111111111111";
const contacts: Contact[] = [
  {
    id: "22222222-2222-4222-8222-222222222222",
    name: "Marta Reyes",
    phoneNumber: "+14155550100",
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    name: "Daniel Osei",
    phoneNumber: "+14155550101",
  },
];

function draft(contact: Contact): SafeCallDraft {
  return {
    phone: contact.phoneNumber,
    locale: "en-IN",
    task: `Identify yourself as an AI and ask ${contact.name} for permission to continue.`,
    resultSchema: {
      type: "object",
      properties: { qualified: { type: "boolean" } },
      required: ["qualified"],
      additionalProperties: false,
    },
    metadata: { campaignId, contactId: contact.id },
  };
}

test("campaign input rejects duplicate recipients and unknown controls", () => {
  assert.throws(
    () =>
      parseCampaignPreviewInput({
        name: "Inbound leads",
        contacts: [contacts[0], { ...contacts[1], phoneNumber: contacts[0].phoneNumber }],
      }),
    (error: unknown) =>
      error instanceof CampaignLifecycleError &&
      error.issues.some((issue) => issue.includes("duplicates another recipient")),
  );
  assert.throws(
    () => parseCampaignPreviewInput({ name: "Inbound leads", contacts, automaticRetry: true }),
    CampaignLifecycleError,
  );
});

test("campaign approval is stable and covers every personalized call", async () => {
  const input = {
    userId: "user-1",
    campaignId,
    mode: "fake" as const,
    locale: "en-IN" as const,
    scheduledAt: null,
    calls: contacts.map((contact) => ({ contact, draft: draft(contact) })),
  };
  const first = await prepareCampaignLaunch(input);
  const second = await prepareCampaignLaunch(input);

  assert.equal(first.preview.callCount, 2);
  assert.equal(first.preview.approvalDigest, second.preview.approvalDigest);
  assert.equal(first.calls.length, 2);
  assert.match(first.calls[0].callResultId, /^[0-9a-f-]{36}$/);
  assert.equal(
    first.calls[0].draft.metadata?.veyraCallResultId,
    first.calls[0].callResultId,
  );

  const changed = await prepareCampaignLaunch({
    ...input,
    calls: [
      input.calls[0],
      {
        ...input.calls[1],
        draft: { ...input.calls[1].draft, task: `${input.calls[1].draft.task} Ask one more question.` },
      },
    ],
  });
  assert.notEqual(first.preview.approvalDigest, changed.preview.approvalDigest);
});

test("live campaigns allow up to ten explicitly authorized recipients", async () => {
  const input = {
    userId: "user-1",
    campaignId,
    mode: "live" as const,
    locale: "en-IN" as const,
    scheduledAt: null,
    calls: contacts.map((contact) => ({ contact, draft: draft(contact) })),
  };
  const prepared = await prepareCampaignLaunch(input);
  assert.equal(prepared.preview.callCount, 2);
  assert.equal(prepared.preview.recipientAuthorizationRequired, true);

  await assert.rejects(
    () =>
      prepareCampaignLaunch({
        ...input,
        calls: Array.from({ length: 11 }, () => input.calls[0]),
      }),
    /campaign must contain 1 to 10 calls/,
  );
});

test("campaign setup validates locale and future schedule", () => {
  const future = new Date(Date.now() + 60_000).toISOString();
  const parsed = parseCampaignPreviewInput({
    name: "Inbound leads",
    contacts: [contacts[0]],
    locale: "en-IN",
    scheduledAt: future,
  });
  assert.equal(parsed.locale, "en-IN");
  assert.equal(parsed.scheduledAt, future);
  assert.throws(
    () =>
      parseCampaignPreviewInput({
        name: "Inbound leads",
        contacts: [contacts[0]],
        locale: "en-GB",
      }),
    CampaignLifecycleError,
  );
});

test("launch approval requires exact count and explicit confirmation fields", () => {
  const parsed = parseCampaignLaunchApproval({
    approvalDigest: "a".repeat(64),
    previewApproved: true,
    recipientAuthorizationConfirmed: false,
    callCount: 2,
  });
  assert.equal(parsed.callCount, 2);
  assert.throws(
    () => parseCampaignLaunchApproval({ ...parsed, callCount: 0 }),
    CampaignLifecycleError,
  );
});
