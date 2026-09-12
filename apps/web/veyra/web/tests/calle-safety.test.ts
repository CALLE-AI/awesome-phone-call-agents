import assert from "node:assert/strict";
import test from "node:test";

import { executeApprovedCall, getCallMode } from "../lib/calle/client";
import {
  createCallPreview,
  isE164,
  maskPhone,
  parseApprovedCallRequest,
  parseCallDraft,
  SafeCallInputError,
} from "../lib/calle/safety";

const schema = {
  type: "object",
  properties: {
    consent: { type: "boolean" },
    outcome: { type: "string", enum: ["follow_up", "declined"] },
  },
  required: ["consent", "outcome"],
  additionalProperties: false,
};

const draft = {
  phone: "+14155550100",
  locale: "en-IN",
  task: "Disclose that this is an AI assistant, request consent, and stop if declined.",
  resultSchema: schema,
  metadata: { campaignName: "Reserved-number test" },
};

async function withEnvironment(
  updates: Record<string, string | undefined>,
  callback: () => void | Promise<void>,
): Promise<void> {
  const previous = Object.fromEntries(
    Object.keys(updates).map((key) => [key, process.env[key]]),
  );
  try {
    for (const [key, value] of Object.entries(updates)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await callback();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("strict E.164 accepts digits only and rejects display formatting", () => {
  assert.equal(isE164("+14155550100"), true);
  assert.equal(isE164("+1 415 555 0100"), false);
  assert.equal(isE164("14155550100"), false);
  assert.equal(isE164("+01234567890"), false);
  assert.equal(isE164("+1234567"), false);
});

test("phone masking exposes only the final four digits", () => {
  const masked = maskPhone("+14155550100");
  assert.equal(masked.endsWith("0100"), true);
  assert.equal(masked.includes("415555"), false);
  assert.equal(masked, "+•••••••0100");
});

test("call drafts reject unknown fields and unsupported schemas", () => {
  assert.throws(
    () => parseCallDraft({ ...draft, retry: true }),
    (error: unknown) =>
      error instanceof SafeCallInputError &&
      error.issues.some((issue) => issue.includes("unknown field")),
  );

  assert.throws(
    () =>
      parseCallDraft({
        ...draft,
        resultSchema: { ...schema, oneOf: [schema] },
      }),
    SafeCallInputError,
  );
});

test("preview digest is canonical and bound to all approved content", async () => {
  const first = await createCallPreview("user-1", parseCallDraft(draft), "fake");
  const reordered = await createCallPreview(
    "user-1",
    parseCallDraft({
      resultSchema: {
        additionalProperties: false,
        required: ["consent", "outcome"],
        properties: {
          outcome: { enum: ["follow_up", "declined"], type: "string" },
          consent: { type: "boolean" },
        },
        type: "object",
      },
      metadata: { campaignName: "Reserved-number test" },
      task: draft.task,
      phone: draft.phone,
      locale: draft.locale,
    }),
    "fake",
  );
  const changed = await createCallPreview(
    "user-1",
    parseCallDraft({ ...draft, task: `${draft.task} Return a concise summary.` }),
    "fake",
  );

  assert.equal(first.approvalDigest, reordered.approvalDigest);
  assert.notEqual(first.approvalDigest, changed.approvalDigest);
  const changedLocale = await createCallPreview(
    "user-1",
    parseCallDraft({ ...draft, locale: "en-US" }),
    "fake",
  );
  assert.notEqual(first.approvalDigest, changedLocale.approvalDigest);
  assert.equal(first.callCount, 1);
  assert.equal(first.canCancelAfterDispatch, false);
  assert.deepEqual(first.sideEffects, [
    "No external request is made",
    "No phone call is placed",
    "No CALL-E credit is used",
  ]);
  assert.match(first.idempotencyKey, /^veyra_[a-f0-9]{48}$/);
});

test("approval is exact, explicit, and limited to one call", async () => {
  const preview = await createCallPreview("user-1", parseCallDraft(draft), "fake");
  const approved = parseApprovedCallRequest({
    ...draft,
    approval: {
      approvalDigest: preview.approvalDigest,
      previewApproved: true,
      recipientAuthorizationConfirmed: false,
      callCount: 1,
    },
  });
  assert.equal(approved.approval.callCount, 1);

  assert.throws(
    () =>
      parseApprovedCallRequest({
        ...draft,
        approval: {
          approvalDigest: preview.approvalDigest,
          previewApproved: true,
          recipientAuthorizationConfirmed: false,
          callCount: 2,
        },
      }),
    SafeCallInputError,
  );
});

test("an API key alone cannot switch the default away from fake", async () => {
  await withEnvironment(
    { CALL_MODE: undefined, CALLE_API_KEY: "must-not-enable-live-mode" },
    () => assert.equal(getCallMode(), "fake"),
  );
  await withEnvironment({ CALL_MODE: "unexpected" }, () =>
    assert.throws(() => getCallMode(), /CALL_MODE/),
  );
});

test("live execution fails closed before loading the SDK", async () => {
  const parsed = parseCallDraft(draft);
  const preview = await createCallPreview("user-1", parsed, "live");

  await withEnvironment(
    {
      CALL_MODE: "live",
      CALLE_LIVE_ENABLED: undefined,
      CALLE_API_KEY: "present-but-insufficient",
    },
    async () => {
      await assert.rejects(
        () => executeApprovedCall(parsed, preview),
        /Live calling is disabled/,
      );
    },
  );

  await withEnvironment(
    {
      CALL_MODE: "live",
      CALLE_LIVE_ENABLED: "true",
      CALLE_API_KEY: undefined,
    },
    async () => {
      await assert.rejects(
        () => executeApprovedCall(parsed, preview),
        /CALLE_API_KEY is required/,
      );
    },
  );
});

test("fake execution returns schema-shaped data without an external side effect", async () => {
  await withEnvironment({ CALL_MODE: "fake" }, async () => {
    const parsed = parseCallDraft(draft);
    const preview = await createCallPreview("user-1", parsed, "fake");
    const execution = await executeApprovedCall(parsed, preview);
    assert.equal(execution.mode, "fake");
    assert.equal(execution.externalSideEffect, false);
    assert.deepEqual(execution.structuredResult, {
      consent: true,
      outcome: "follow_up",
    });
    assert.equal(execution.qualified, true);
    assert.match(execution.summary ?? "", /consented.*follow-up/i);
    assert.match(
      execution.transcript ?? "",
      /Simulated transcript[\s\S]*no phone call was placed/,
    );
  });
});
