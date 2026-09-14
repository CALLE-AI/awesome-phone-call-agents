import type {
  Call,
  CallRecipient,
  CreateCallInput,
} from "@call-e/calle";
import { createHash } from "node:crypto";
import {
  canonicalJson,
  digestPreviewContent,
  type ApprovalReceipt,
  type CallPreviewContent,
} from "./preview.js";
import { buildProviderRecipientResultSchema, normalizeProviderStructuredResult } from "./result-schema.js";

export interface CallRequest {
  caseId: string;
  recipientPhoneE164: string;
  preview: CallPreviewContent;
  approval: ApprovalReceipt;
  idempotencyKey: string;
}

export interface ProviderDispatchBinding {
  recipient: {
    phoneE164: string;
    region: "AU";
    locale: "en-AU";
  };
  task: string;
  recipientResultSchema: Record<string, unknown>;
  approval: ApprovalReceipt;
}

export type CallOutcome =
  | { kind: "COMPLETED"; callId: string; rawResult: unknown }
  | { kind: "UNREACHED"; callId: string }
  | { kind: "AMBIGUOUS"; callId?: string; reconciliationReference: string; reason: string }
  | { kind: "REJECTED_BEFORE_START"; reason: string };

export interface CalleTransport {
  readonly mode: "fake" | "live";
  startOneCall(request: CallRequest): Promise<CallOutcome>;
}

/** The SDK does not export CallAttempt directly, but it exports it through CallRecipient. */
type CallAttempt = CallRecipient["attempts"][number];

const AMBIGUOUS_CREATE_CODES = new Set([
  "idempotency_conflict",
  "internal_error",
  "provider_unavailable",
  "rate_limit_exceeded",
]);

const DETERMINISTIC_REJECTION_CODES = new Set([
  "call_not_ready",
  "forbidden",
  "insufficient_balance",
  "invalid_phone",
  "invalid_recipient",
  "invalid_request",
  "no_recipients",
  "not_found",
  "policy_violation",
  "recipient_blocked",
  "recipient_result_schema_invalid",
  "result_schema_invalid",
  "unauthorized",
  "unsupported_language",
  "unsupported_region",
]);

export interface CalleClientPort {
  calls: {
    create(input: CreateCallInput, options: { idempotencyKey: string }): Promise<Call>;
    waitForResult(callId: string, options: { timeoutMs: number; intervalMs: number }): Promise<Call>;
  };
}

export interface LiveCalleConfiguration {
  apiKey: string;
  consentingTestRecipientE164: string;
  baseUrl?: string;
}

export interface LiveCalleDependencies {
  /** Offline test seam. Production uses the lazily imported official SDK. */
  loadClient?: (configuration: LiveCalleConfiguration) => Promise<CalleClientPort>;
}

/**
 * Controlled live adapter. It makes exactly one SDK `create` request and never
 * retries it. Any state that is unknown, contradictory, or not explicitly
 * supported is returned for reconciliation without a redial.
 */
export class LiveCalleClient implements CalleTransport {
  readonly mode = "live" as const;
  readonly #configuration: LiveCalleConfiguration;
  readonly #loadClient: NonNullable<LiveCalleDependencies["loadClient"]>;
  #clientPromise?: Promise<CalleClientPort>;

  constructor(configuration: LiveCalleConfiguration, dependencies: LiveCalleDependencies = {}) {
    if (!configuration.apiKey) throw new Error("CALLE_API_KEY is required for live mode");
    if (!/^\+61\d{9}$/.test(configuration.consentingTestRecipientE164)) {
      throw new Error("A valid consenting Australian test recipient E.164 number is required for live mode");
    }
    validateOfficialBaseUrl(configuration.baseUrl);
    this.#configuration = configuration;
    this.#loadClient = dependencies.loadClient ?? loadSdkClient;
  }

  async startOneCall(request: CallRequest): Promise<CallOutcome> {
    if (request.recipientPhoneE164 !== this.#configuration.consentingTestRecipientE164) {
      return { kind: "REJECTED_BEFORE_START", reason: "Recipient does not match the configured consenting test recipient." };
    }

    let binding: ProviderDispatchBinding;
    try {
      binding = buildProviderDispatchBinding(request.recipientPhoneE164, request.preview, request.approval);
    } catch (error) {
      return {
        kind: "REJECTED_BEFORE_START",
        reason: error instanceof Error ? error.message : "The exact approved provider dispatch payload is invalid.",
      };
    }
    const expectedIdempotencyKey = createProviderIdempotencyKey(binding);
    if (request.idempotencyKey !== expectedIdempotencyKey) {
      return { kind: "REJECTED_BEFORE_START", reason: "The provider idempotency key does not match the exact approved dispatch payload." };
    }

    const { task, recipientResultSchema } = binding;
    const requestFingerprint = digestPreviewContent(request.preview);
    let created: Call;
    try {
      const client = await this.#getClient();
      created = await client.calls.create({
        task,
        recipients: [{
          phones: [binding.recipient.phoneE164],
          region: binding.recipient.region,
          locale: binding.recipient.locale,
        }],
        recipientResultSchema,
        metadata: {
          workflow: "revisit-zero",
          idempotencyReference: request.idempotencyKey,
          requestFingerprint,
        },
      }, { idempotencyKey: request.idempotencyKey });
    } catch (error) {
      return classifyCreateError(error, request.idempotencyKey);
    }

    if (!created.id) {
      return ambiguous(request.idempotencyKey, "CALL-E returned no stable call ID; do not redial.");
    }
    const bindingError = verifyCallBinding(created, {
      task,
      phone: request.recipientPhoneE164,
      idempotencyKey: request.idempotencyKey,
      requestFingerprint,
    });
    if (bindingError) return ambiguous(request.idempotencyKey, bindingError, created.id);

    let terminal: Call;
    try {
      const client = await this.#getClient();
      terminal = await client.calls.waitForResult(created.id, { timeoutMs: 180_000, intervalMs: 2_000 });
    } catch (error) {
      return ambiguous(
        request.idempotencyKey,
        `The call may have started but its result was not confirmed (${safeErrorCategory(error)}); reconcile by call ID without redialling.`,
        created.id,
      );
    }

    if (!terminal.id || terminal.id !== created.id) {
      return ambiguous(request.idempotencyKey, "CALL-E returned a missing or different terminal call ID; reconcile without redialling.", created.id);
    }
    const terminalBindingError = verifyCallBinding(terminal, {
      task,
      phone: request.recipientPhoneE164,
      idempotencyKey: request.idempotencyKey,
      requestFingerprint,
    });
    if (terminalBindingError) return ambiguous(request.idempotencyKey, terminalBindingError, created.id);

    return mapTerminalCall(terminal, request.idempotencyKey);
  }

  async #getClient(): Promise<CalleClientPort> {
    this.#clientPromise ??= this.#loadClient(this.#configuration);
    return this.#clientPromise;
  }
}

export function buildProviderDispatchBinding(
  recipientPhoneE164: string,
  preview: CallPreviewContent,
  approval: ApprovalReceipt,
): ProviderDispatchBinding {
  return {
    recipient: {
      phoneE164: recipientPhoneE164.trim(),
      region: "AU",
      locale: "en-AU",
    },
    task: buildCalleTask(preview),
    recipientResultSchema: buildProviderRecipientResultSchema(preview.visitWindows.map((window) => window.id)),
    approval: structuredClone(approval),
  };
}

export function createProviderIdempotencyKey(binding: ProviderDispatchBinding): string {
  return createHash("sha256")
    .update(`revisit-zero-approved-dispatch-v2\u0000${canonicalJson(binding)}`)
    .digest("hex");
}

async function loadSdkClient(configuration: LiveCalleConfiguration): Promise<CalleClientPort> {
  const sdk: typeof import("@call-e/calle") = await import("@call-e/calle");
  return new sdk.CalleClient({
    apiKey: configuration.apiKey,
    ...(configuration.baseUrl ? { baseUrl: configuration.baseUrl } : {}),
  });
}

function mapTerminalCall(call: Call, reference: string): CallOutcome {
  const recipient = call.recipients[0];
  if (!recipient) return ambiguous(reference, "CALL-E returned no recipient at terminal state.", call.id);

  if (call.status === "completed") {
    const attempt = recipient.attempts[0];
    if (
      call.taskCompleted !== true ||
      recipient.status !== "completed" ||
      recipient.structuredResult === null ||
      recipient.attempts.length !== 1 ||
      !attempt ||
      attempt.status !== "completed" ||
      attempt.failureCode !== null ||
      call.failureCode !== null
    ) {
      return ambiguous(reference, "CALL-E returned an incomplete or contradictory completed state.", call.id);
    }
    return { kind: "COMPLETED", callId: call.id, rawResult: normalizeProviderStructuredResult(recipient.structuredResult) };
  }

  if (call.status === "failed" || call.status === "canceled") {
    if (
      call.taskCompleted === true ||
      !["failed", "skipped"].includes(recipient.status) ||
      recipient.structuredResult !== null ||
      recipient.attempts.some((attempt) => !["failed", "canceled"].includes(attempt.status))
    ) {
      return ambiguous(reference, "CALL-E returned contradictory failure evidence.", call.id);
    }
    const failureCodes = collectFailureCodes(call, recipient);
    if (failureCodes.length > 1) {
      return ambiguous(reference, "CALL-E returned contradictory failure codes; the call requires reconciliation.", call.id);
    }
    // In the pinned Calls contract, failureCode is unconstrained string|null.
    // Candidate strings such as no_answer, declined, voicemail, busy, and
    // expired therefore have no documented Calls semantics and cannot prove an
    // UNREACHED disposition. Preserve every failed/canceled call for a human or
    // future provider reconciliation instead of inferring a negative outcome.
    return ambiguous(
      reference,
      failureCodes.length === 1
        ? "CALL-E returned an unenumerated failure code; the Calls contract does not prove an unreachable outcome."
        : "CALL-E ended without documented failure semantics; the call requires reconciliation.",
      call.id,
    );
  }

  return ambiguous(reference, `CALL-E returned unsupported terminal state ${call.status}.`, call.id);
}

function verifyCallBinding(
  call: Call,
  expected: { task: string; phone: string; idempotencyKey: string; requestFingerprint: string },
): string | null {
  if (call.task !== expected.task) return "The CALL-E record task does not match the approved preview.";
  if (call.metadata.idempotencyReference !== expected.idempotencyKey) return "The CALL-E record idempotency metadata does not match.";
  if (call.metadata.requestFingerprint !== expected.requestFingerprint) return "The CALL-E record fingerprint does not match the approved preview.";
  if (call.metadata.workflow !== "revisit-zero") return "The CALL-E record workflow metadata does not match.";
  if (call.recipients.length !== 1) return "CALL-E did not preserve the exactly-one-recipient boundary.";
  const recipient = call.recipients[0];
  if (!recipient || recipient.phones.length !== 1 || recipient.phones[0] !== expected.phone) {
    return "The CALL-E record recipient does not match the approved consenting test recipient.";
  }
  if (recipient.attempts.length > 1) return "CALL-E returned more than the single permitted outbound attempt.";
  if (recipient.attempts.some((attempt) => attempt.phone !== expected.phone)) {
    return "A CALL-E attempt targeted a number other than the approved consenting test recipient.";
  }
  return null;
}

function collectFailureCodes(call: Call, recipient: CallRecipient): string[] {
  const codes = [call.failureCode, ...recipient.attempts.map((attempt: CallAttempt) => attempt.failureCode)]
    .filter((code): code is string => typeof code === "string" && code.trim().length > 0)
    .map(normalizeFailureCode);
  return [...new Set(codes)];
}

function normalizeFailureCode(code: string): string {
  return code.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function buildCalleTask(preview: CallPreviewContent): string {
  const windows = preview.visitWindows.map((window) => `${window.id}: ${window.label}`).join("; ");
  return [
    preview.objective,
    `Ask only these approved questions: ${preview.allowedQuestions.join(" | ")}`,
    `Approved visit windows: ${windows}`,
    ...preview.guardrails,
    "Do not retry or redial this recipient under any circumstance.",
    "Return only a result matching the supplied closed recipient result schema. contactOutcome is the single source of truth for contact and opt-out state.",
    "Use REACHED only after speaking with the recipient, DO_NOT_CONTACT only after an explicit request to stop automated calls, and UNREACHED only when no recipient was reached.",
    "For DO_NOT_CONTACT or UNREACHED, use UNKNOWN for every access answer and NONE for selectedVisitWindowId. Otherwise use UNKNOWN when no closed answer was obtained and NONE when no visit window was selected.",
  ].join("\n");
}

function validateOfficialBaseUrl(baseUrl?: string): void {
  if (!baseUrl) return;
  if (baseUrl !== "https://api.heycall-e.com" && baseUrl !== "https://api.heycall-e.com/") {
    throw new Error("Live CALL-E baseUrl must be https://api.heycall-e.com");
  }
}

function classifyCreateError(error: unknown, reference: string): CallOutcome {
  const code = extractErrorCode(error);
  const status = extractStatus(error);
  if (code && AMBIGUOUS_CREATE_CODES.has(code)) {
    return ambiguous(reference, `${code} leaves provider execution uncertain; reconcile without redialling.`);
  }
  if (status !== null && ([408, 409, 429].includes(status) || status >= 500)) {
    return ambiguous(reference, `${safeErrorCategory(error)} leaves provider execution uncertain; reconcile without redialling.`);
  }
  if (code && DETERMINISTIC_REJECTION_CODES.has(code)) {
    return { kind: "REJECTED_BEFORE_START", reason: `CALL-E rejected the request before a confirmed call (${code}).` };
  }
  if (status === null) {
    return ambiguous(reference, `${safeErrorCategory(error)} leaves provider execution uncertain; reconcile without redialling.`);
  }
  return { kind: "REJECTED_BEFORE_START", reason: `CALL-E rejected the request before a confirmed call (${safeErrorCategory(error)}).` };
}

function extractErrorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const code = (error as Record<string, unknown>).code;
  return typeof code === "string" && !/^\d{3}$/.test(code) ? normalizeFailureCode(code) : null;
}

function ambiguous(reference: string, reason: string, callId?: string): CallOutcome {
  return {
    kind: "AMBIGUOUS",
    ...(callId ? { callId } : {}),
    reconciliationReference: reference,
    reason,
  };
}

function extractStatus(error: unknown): number | null {
  if (typeof error !== "object" || error === null) return null;
  for (const key of ["status", "statusCode", "code"] as const) {
    const value = (error as Record<string, unknown>)[key];
    if (typeof value === "number") return value;
    if (typeof value === "string" && /^\d{3}$/.test(value)) return Number(value);
  }
  return null;
}

function safeErrorCategory(error: unknown): string {
  const status = extractStatus(error);
  if (status !== null) return `HTTP ${status}`;
  return error instanceof Error && error.name ? error.name : "unclassified transport error";
}
