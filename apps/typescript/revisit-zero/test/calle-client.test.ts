import type { Call, CallRecipient, CreateCallInput } from "@call-e/calle";
import { CalleAPIError, CalleTimeoutError } from "@call-e/calle";
import { describe, expect, it, vi } from "vitest";
import failedVisitsJson from "../examples/failed-visits.json" with { type: "json" };
import { GOLDEN_RESULT } from "../demo/fake-calle.js";
import {
  buildProviderDispatchBinding,
  createProviderIdempotencyKey,
  LiveCalleClient,
  type CallRequest,
  type CalleClientPort,
} from "../src/calle-client.js";
import type { FailedVisitCase } from "../src/case.js";
import { createApprovalReceipt, createCallPreview, digestPreviewContent } from "../src/preview.js";
import { buildProviderRecipientResultSchema, type StructuredCallResult } from "../src/result-schema.js";

const failedVisit = (failedVisitsJson as FailedVisitCase[])[0]!;
const previewRecord = createCallPreview(failedVisit);
const preview = previewRecord.content;
const approval = createApprovalReceipt(previewRecord, "test-operator", new Date("2026-08-12T00:00:00Z"));
const dispatchBinding = buildProviderDispatchBinding(failedVisit.recipient.phoneE164, preview, approval);
const request: CallRequest = {
  caseId: failedVisit.id,
  recipientPhoneE164: failedVisit.recipient.phoneE164,
  preview,
  approval,
  idempotencyKey: createProviderIdempotencyKey(dispatchBinding),
};
const configuration = {
  apiKey: "offline-test-key",
  consentingTestRecipientE164: failedVisit.recipient.phoneE164,
  baseUrl: "https://api.heycall-e.com",
};

describe("controlled live CALL-E adapter", () => {
  it("binds the provider idempotency key to normalized recipient, task, locale, schema, and approval", () => {
    const original = buildProviderDispatchBinding(`  ${failedVisit.recipient.phoneE164}  `, preview, approval);
    expect(original.recipient.phoneE164).toBe(failedVisit.recipient.phoneE164);
    const originalKey = createProviderIdempotencyKey(original);
    const mutations = [
      { ...structuredClone(original), recipient: { ...original.recipient, phoneE164: "+61491570156" } },
      { ...structuredClone(original), task: `${original.task}\nChanged approved task` },
      { ...structuredClone(original), recipient: { ...original.recipient, locale: "en-NZ" as "en-AU" } },
      { ...structuredClone(original), recipientResultSchema: { ...original.recipientResultSchema, title: "Changed schema" } },
      { ...structuredClone(original), approval: { ...original.approval, approvedBy: "different-operator" } },
    ];
    expect(mutations.map(createProviderIdempotencyKey)).not.toContain(originalKey);
  });

  it("rejects a provider key that is not bound to the exact approved dispatch", async () => {
    const harness = makeHarness();
    const outcome = await client(harness.port).startOneCall({ ...request, idempotencyKey: "case-only-key" });
    expect(outcome).toMatchObject({ kind: "REJECTED_BEFORE_START", reason: expect.stringContaining("exact approved dispatch") });
    expect(harness.create).not.toHaveBeenCalled();
  });

  it("sends one recipient, recipient schema, audit metadata, fingerprint, and idempotency key", async () => {
    const harness = makeHarness();
    const outcome = await client(harness.port).startOneCall(request);

    expect(outcome.kind).toBe("COMPLETED");
    expect(harness.create).toHaveBeenCalledTimes(1);
    expect(harness.wait).toHaveBeenCalledTimes(1);
    const [input, options] = harness.create.mock.calls[0]!;
    expect(input.recipients).toEqual([{ phones: [request.recipientPhoneE164], region: "AU", locale: "en-AU" }]);
    expect(input.recipientResultSchema).toEqual(buildProviderRecipientResultSchema(["TUE_AM", "THU_PM"]));
    expect(JSON.stringify(input.recipientResultSchema)).not.toContain('"const"');
    expect(JSON.stringify(input.recipientResultSchema)).not.toContain('"type":[');
    const schema = input.recipientResultSchema as {
      required: string[];
      properties: {
        contactOutcome: { type: string; enum: string[] };
        schemaVersion: { type: string; enum: string[] };
        selectedVisitWindowId: { type: string; enum: string[] };
        optOut?: unknown;
      };
    };
    expect(schema.required).toEqual(["schemaVersion", "contactOutcome", "accessResolution", "selectedVisitWindowId"]);
    expect(schema.properties.schemaVersion).toEqual({ type: "string", enum: ["1.0"] });
    expect(schema.properties.contactOutcome).toEqual({ type: "string", enum: ["REACHED", "UNREACHED", "DO_NOT_CONTACT"] });
    expect(schema.properties.selectedVisitWindowId).toEqual({ type: "string", enum: ["TUE_AM", "THU_PM", "NONE"] });
    expect(schema.properties.optOut).toBeUndefined();
    expect(input.resultSchema).toBeUndefined();
    expect(input.metadata).toEqual({
      workflow: "revisit-zero",
      idempotencyReference: request.idempotencyKey,
      requestFingerprint: digestPreviewContent(preview),
    });
    expect(options).toEqual({ idempotencyKey: request.idempotencyKey });
    expect(input.task).toContain("Do not retry or redial");
    expect(input.task).toContain("contactOutcome is the single source of truth");
    expect(input.task).toContain("DO_NOT_CONTACT only after an explicit request to stop automated calls");
    expect(input.task).toContain("For DO_NOT_CONTACT or UNREACHED, use UNKNOWN for every access answer and NONE");
    expect(harness.wait).toHaveBeenCalledWith("call-test-1", { timeoutMs: 180_000, intervalMs: 2_000 });
  });

  it("returns the recipient structured result only for a verified completed task", async () => {
    const harness = makeHarness();
    const outcome = await client(harness.port).startOneCall(request);
    expect(outcome).toEqual({ kind: "COMPLETED", callId: "call-test-1", rawResult: GOLDEN_RESULT });
  });

  it("normalizes the provider window sentinel and derives local opt-out from the one authoritative outcome", async () => {
    const doNotContact: StructuredCallResult = {
      schemaVersion: "1.0",
      contactOutcome: "DO_NOT_CONTACT",
      accessResolution: {
        gateUnlocked: "UNKNOWN",
        dogSecured: "UNKNOWN",
        obstructionRemoved: "UNKNOWN",
        presenceArranged: "UNKNOWN",
        externalAccessPartyResolved: "UNKNOWN",
      },
      selectedVisitWindowId: null,
      optOut: true,
    };
    const harness = makeHarness({ terminal: (input) => terminalSuccess(input, { result: toProviderResult(doNotContact) }) });
    const outcome = await client(harness.port).startOneCall(request);
    expect(outcome).toMatchObject({
      kind: "COMPLETED",
      rawResult: { contactOutcome: "DO_NOT_CONTACT", selectedVisitWindowId: null, optOut: true },
    });
  });

  it.each([
    ["no answer", "no_answer"],
    ["declined", "declined"],
    ["voicemail", "voicemail"],
    ["busy", "busy"],
    ["expired", "expired"],
  ])("quarantines candidate failed terminal %s code because Calls does not enumerate it", async (_label, failureCode) => {
    const harness = makeHarness({ terminal: (input) => terminalFailure(input, failureCode) });
    expect(await client(harness.port).startOneCall(request)).toMatchObject({
      kind: "AMBIGUOUS",
      callId: "call-test-1",
      reconciliationReference: request.idempotencyKey,
    });
    expect(harness.create).toHaveBeenCalledTimes(1);
    expect(harness.wait).toHaveBeenCalledTimes(1);
  });

  it("treats an ordinary provider rejection as definitely before start", async () => {
    const harness = makeHarness({
      createError: new CalleAPIError({ code: "invalid_phone", message: "offline invalid phone", status: 400 }),
    });
    expect((await client(harness.port).startOneCall(request)).kind).toBe("REJECTED_BEFORE_START");
    expect(harness.create).toHaveBeenCalledTimes(1);
    expect(harness.wait).not.toHaveBeenCalled();
  });

  it("preserves idempotency conflict without retry", async () => {
    const harness = makeHarness({
      createError: new CalleAPIError({ code: "idempotency_conflict", message: "offline conflict", status: 409 }),
    });
    const outcome = await client(harness.port).startOneCall(request);
    expect(outcome.kind).toBe("AMBIGUOUS");
    expect(harness.create).toHaveBeenCalledTimes(1);
    expect(harness.wait).not.toHaveBeenCalled();
  });

  it.each(["invalid_recipient", "recipient_blocked", "policy_violation", "recipient_result_schema_invalid", "unauthorized"])(
    "rejects deterministic code-only create error %s before start",
    async (code) => {
      const harness = makeHarness({ createError: codeError(code) });
      expect((await client(harness.port).startOneCall(request)).kind).toBe("REJECTED_BEFORE_START");
      expect(harness.create).toHaveBeenCalledTimes(1);
      expect(harness.wait).not.toHaveBeenCalled();
    },
  );

  it.each(["idempotency_conflict", "provider_unavailable", "internal_error", "rate_limit_exceeded"])(
    "quarantines ambiguous code-only create error %s",
    async (code) => {
      const harness = makeHarness({ createError: codeError(code) });
      expect((await client(harness.port).startOneCall(request)).kind).toBe("AMBIGUOUS");
      expect(harness.create).toHaveBeenCalledTimes(1);
      expect(harness.wait).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["HTTP 408", apiError(408)],
    ["HTTP 429", apiError(429)],
    ["HTTP 503", apiError(503)],
    ["unknown transport", new Error("offline connection dropped")],
  ])("quarantines policy-designated ambiguous create failure %s", async (_label, error) => {
    const harness = makeHarness({ createError: error });
    expect((await client(harness.port).startOneCall(request)).kind).toBe("AMBIGUOUS");
    expect(harness.create).toHaveBeenCalledTimes(1);
    expect(harness.wait).not.toHaveBeenCalled();
  });

  it("lets an ambiguous HTTP status override a contradictory deterministic-looking code", async () => {
    const error = Object.assign(new Error("offline contradictory provider response"), { code: "invalid_phone", status: 503 });
    const harness = makeHarness({ createError: error });
    expect((await client(harness.port).startOneCall(request)).kind).toBe("AMBIGUOUS");
    expect(harness.create).toHaveBeenCalledTimes(1);
    expect(harness.wait).not.toHaveBeenCalled();
  });

  it("preserves timeout after create with the known call ID and zero retry", async () => {
    const harness = makeHarness({ waitError: new CalleTimeoutError("offline timeout") });
    const outcome = await client(harness.port).startOneCall(request);
    expect(outcome).toMatchObject({ kind: "AMBIGUOUS", callId: "call-test-1", reconciliationReference: request.idempotencyKey });
    expect(harness.create).toHaveBeenCalledTimes(1);
    expect(harness.wait).toHaveBeenCalledTimes(1);
  });

  it("fails closed on a missing create ID without polling or retrying", async () => {
    const harness = makeHarness({ created: (input) => ({ ...createdCall(input), id: "" }) });
    expect((await client(harness.port).startOneCall(request)).kind).toBe("AMBIGUOUS");
    expect(harness.create).toHaveBeenCalledTimes(1);
    expect(harness.wait).not.toHaveBeenCalled();
  });

  it("fails closed on missing, contradictory, unknown, or mismatched terminal results", async () => {
    const terminals = [
      (input: CreateCallInput) => terminalSuccess(input, { result: null }),
      (input: CreateCallInput) => terminalSuccess(input, { attemptFailureCode: "busy" }),
      (input: CreateCallInput) => terminalFailure(input, "carrier_error"),
      (input: CreateCallInput) => ({ ...terminalSuccess(input), id: "different-call-id" }),
      (input: CreateCallInput) => ({ ...terminalSuccess(input), status: "canceled" as const }),
      (input: CreateCallInput) => {
        const completed = terminalSuccess(input);
        completed.recipients[0]!.attempts = [];
        return completed;
      },
      (input: CreateCallInput) => {
        const completed = terminalSuccess(input);
        completed.recipients[0]!.attempts.push(attempt("completed", null));
        return completed;
      },
      (input: CreateCallInput) => {
        const failed = terminalFailure(input, "busy");
        failed.failureCode = "no_answer";
        return failed;
      },
    ];
    for (const terminal of terminals) {
      const harness = makeHarness({ terminal });
      expect((await client(harness.port).startOneCall(request)).kind).toBe("AMBIGUOUS");
      expect(harness.create).toHaveBeenCalledTimes(1);
    }
  });

  it("fails closed when any returned attempt targets a different phone", async () => {
    const harness = makeHarness({
      terminal: (input) => {
        const completed = terminalSuccess(input);
        completed.recipients[0]!.attempts[0]!.phone = "+61491570156";
        return completed;
      },
    });
    expect((await client(harness.port).startOneCall(request)).kind).toBe("AMBIGUOUS");
    expect(harness.create).toHaveBeenCalledTimes(1);
    expect(harness.wait).toHaveBeenCalledTimes(1);
  });

  it("fails closed before polling if a create response already shows multiple attempts", async () => {
    const harness = makeHarness({
      created: (input) => {
        const created = createdCall(input);
        created.recipients[0]!.attempts = [attempt("failed", "busy"), attempt("failed", "busy")];
        return created;
      },
    });
    expect((await client(harness.port).startOneCall(request)).kind).toBe("AMBIGUOUS");
    expect(harness.create).toHaveBeenCalledTimes(1);
    expect(harness.wait).not.toHaveBeenCalled();
  });

  it("quarantines canceled tasks regardless of candidate failure-code spelling", async () => {
    const canceled = makeHarness({ terminal: (input) => ({ ...terminalFailure(input, "expired"), status: "canceled" }) });
    expect((await client(canceled.port).startOneCall(request)).kind).toBe("AMBIGUOUS");

    const unknown = makeHarness({ terminal: (input) => ({ ...terminalFailure(input, "carrier_error"), status: "canceled" }) });
    expect((await client(unknown.port).startOneCall(request)).kind).toBe("AMBIGUOUS");
  });

  it("binds execution to the configured recipient and returned recipient", async () => {
    const wrongRequest = { ...request, recipientPhoneE164: "+61491570156" };
    const blockedHarness = makeHarness();
    expect((await client(blockedHarness.port).startOneCall(wrongRequest)).kind).toBe("REJECTED_BEFORE_START");
    expect(blockedHarness.create).not.toHaveBeenCalled();

    const changedHarness = makeHarness({
      created: (input) => {
        const call = createdCall(input);
        call.recipients[0]!.phones = ["+61491570156"];
        return call;
      },
    });
    expect((await client(changedHarness.port).startOneCall(request)).kind).toBe("AMBIGUOUS");
    expect(changedHarness.wait).not.toHaveBeenCalled();
  });

  it("accepts only the official HTTPS live base URL", () => {
    expect(() => client(makeHarness().port)).not.toThrow();
    expect(() => new LiveCalleClient({ ...configuration, baseUrl: "http://127.0.0.1:8787" })).toThrow(/api\.heycall-e\.com/);
    expect(() => new LiveCalleClient({ ...configuration, baseUrl: "https://example.com" })).toThrow(/api\.heycall-e\.com/);
    expect(() => new LiveCalleClient({ ...configuration, baseUrl: "https://user:pass@api.heycall-e.com" })).toThrow(/api\.heycall-e\.com/);
    expect(() => new LiveCalleClient({ ...configuration, baseUrl: "https://api.heycall-e.com:443" })).toThrow(/api\.heycall-e\.com/);
    expect(() => new LiveCalleClient({ ...configuration, baseUrl: "https://api.heycall-e.com/v1" })).toThrow(/api\.heycall-e\.com/);
    expect(() => new LiveCalleClient({ ...configuration, baseUrl: "https://api.heycall-e.com?debug=true" })).toThrow(/api\.heycall-e\.com/);
  });
});

function client(port: CalleClientPort): LiveCalleClient {
  return new LiveCalleClient(configuration, { loadClient: async () => port });
}

function makeHarness(options: {
  createError?: Error;
  waitError?: Error;
  created?: (input: CreateCallInput) => Call;
  terminal?: (input: CreateCallInput) => Call;
} = {}) {
  let capturedInput: CreateCallInput | undefined;
  const create = vi.fn(async (input: CreateCallInput, _options: { idempotencyKey: string }) => {
    capturedInput = input;
    if (options.createError) throw options.createError;
    return (options.created ?? createdCall)(input);
  });
  const wait = vi.fn(async (_callId: string, _options: { timeoutMs: number; intervalMs: number }) => {
    if (options.waitError) throw options.waitError;
    if (!capturedInput) throw new Error("test harness did not capture create input");
    return (options.terminal ?? terminalSuccess)(capturedInput);
  });
  return { create, wait, port: { calls: { create, waitForResult: wait } } satisfies CalleClientPort };
}

function createdCall(input: CreateCallInput): Call {
  return call(input, {
    status: "queued",
    taskCompleted: null,
    recipient: { status: "pending", structuredResult: null, attempts: [] },
  });
}

function terminalSuccess(
  input: CreateCallInput,
  options: { result?: unknown; attemptFailureCode?: string } = {},
): Call {
  const attemptFailureCode = options.attemptFailureCode ?? null;
  return call(input, {
    status: "completed",
    taskCompleted: true,
    recipient: {
      status: "completed",
      structuredResult: (options.result === undefined ? toProviderResult(GOLDEN_RESULT) : options.result) as unknown as CallRecipient["structuredResult"],
      attempts: [attempt(attemptFailureCode ? "failed" : "completed", attemptFailureCode)],
    },
  });
}

function toProviderResult(result: StructuredCallResult): Omit<StructuredCallResult, "optOut" | "selectedVisitWindowId"> & { selectedVisitWindowId: string } {
  const { optOut: _derivedLocally, selectedVisitWindowId, ...providerResult } = structuredClone(result);
  return { ...providerResult, selectedVisitWindowId: selectedVisitWindowId ?? "NONE" };
}

function terminalFailure(input: CreateCallInput, failureCode: string): Call {
  return call(input, {
    status: "failed",
    taskCompleted: false,
    recipient: {
      status: failureCode === "expired" ? "skipped" : "failed",
      structuredResult: null,
      attempts: failureCode === "expired" ? [] : [attempt("failed", failureCode)],
    },
    failureCode: failureCode === "expired" ? failureCode : null,
  });
}

function call(
  input: CreateCallInput,
  options: {
    status: Call["status"];
    taskCompleted: boolean | null;
    recipient: Pick<CallRecipient, "status" | "structuredResult" | "attempts">;
    failureCode?: string | null;
  },
): Call {
  const recipientInput = input.recipients?.[0];
  return {
    id: "call-test-1",
    object: "call_task",
    status: options.status,
    task: input.task,
    recipients: [{
      id: "recipient-test-1",
      phones: recipientInput?.phones ?? [],
      locale: recipientInput?.locale ?? null,
      region: recipientInput?.region ?? null,
      status: options.recipient.status,
      structuredResult: options.recipient.structuredResult,
      summary: null,
      attempts: options.recipient.attempts,
    }],
    structuredResult: null,
    summary: null,
    taskCompleted: options.taskCompleted,
    completionConfidence: null,
    evidence: [],
    metadata: input.metadata ?? {},
    failureCode: options.failureCode ?? null,
    failureMessage: null,
    createdAt: "2026-08-12T00:00:00Z",
    completedAt: options.status === "queued" ? null : "2026-08-12T00:01:00Z",
  };
}

function attempt(status: "completed" | "failed", failureCode: string | null): CallRecipient["attempts"][number] {
  return {
    id: "attempt-test-1",
    phone: request.recipientPhoneE164,
    status,
    startedAt: "2026-08-12T00:00:05Z",
    completedAt: "2026-08-12T00:00:55Z",
    summary: null,
    transcriptTurns: [],
    providerCallId: "provider-test-1",
    failureCode,
    failureMessage: null,
  };
}

function apiError(status: number): Error {
  return Object.assign(new Error(`offline HTTP ${status}`), { status });
}

function codeError(code: string): Error {
  return Object.assign(new Error(`offline ${code}`), { code });
}
