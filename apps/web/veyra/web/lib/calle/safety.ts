import {
  assertCalleSchemaSubset,
  CalleSchemaError,
} from "@/lib/validation";
import { CAMPAIGN_LOCALES, type CampaignLocale } from "@/types/campaign";

export type CallMode = "fake" | "live";
export type JsonObject = Record<string, unknown>;

const E164 = /^\+[1-9]\d{7,14}$/;
const METADATA_KEY = /^[A-Za-z][A-Za-z0-9_-]{0,39}$/;
const MAX_TASK_LENGTH = 6_000;
const MAX_METADATA_FIELDS = 12;
const MAX_METADATA_VALUE_LENGTH = 240;

export interface SafeCallDraft {
  phone: string;
  locale: CampaignLocale;
  task: string;
  resultSchema: JsonObject;
  metadata?: Record<string, string>;
}

export interface SafeCallApproval {
  approvalDigest: string;
  previewApproved: boolean;
  recipientAuthorizationConfirmed: boolean;
  callCount: number;
}

export interface ApprovedCallRequest extends SafeCallDraft {
  approval: SafeCallApproval;
}

export interface SafeCallPreview {
  mode: CallMode;
  maskedPhone: string;
  callCount: 1;
  task: string;
  resultSchema: JsonObject;
  sideEffects: string[];
  recipientAuthorizationRequired: boolean;
  canCancelAfterDispatch: false;
  approvalDigest: string;
  idempotencyKey: string;
}

export class SafeCallInputError extends Error {
  constructor(readonly issues: string[]) {
    super(issues.join("; "));
    this.name = "SafeCallInputError";
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function onlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
  issues: string[],
): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length) issues.push(`${label} contains unknown field(s): ${unknown.join(", ")}`);
}

function parseMetadata(value: unknown, issues: string[]): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (!isPlainObject(value)) {
    issues.push("metadata must be an object of short string values");
    return undefined;
  }

  const entries = Object.entries(value);
  if (entries.length > MAX_METADATA_FIELDS) {
    issues.push(`metadata supports at most ${MAX_METADATA_FIELDS} fields`);
  }

  const metadata: Record<string, string> = {};
  for (const [key, item] of entries) {
    if (!METADATA_KEY.test(key)) {
      issues.push(`metadata key "${key}" is invalid`);
      continue;
    }
    if (typeof item !== "string" || item.length > MAX_METADATA_VALUE_LENGTH) {
      issues.push(
        `metadata.${key} must be a string no longer than ${MAX_METADATA_VALUE_LENGTH} characters`,
      );
      continue;
    }
    metadata[key] = item;
  }
  return metadata;
}

/** Strict E.164: a leading + followed by 8–15 digits, with no formatting characters. */
export function isE164(value: string): boolean {
  return E164.test(value);
}

export function maskPhone(phone: string): string {
  const visible = phone.slice(-4);
  return `+${"•".repeat(Math.max(phone.length - visible.length - 1, 4))}${visible}`;
}

export function parseCallDraft(value: unknown): SafeCallDraft {
  const issues: string[] = [];
  if (!isPlainObject(value)) {
    throw new SafeCallInputError(["request body must be a JSON object"]);
  }

  onlyKeys(value, ["phone", "locale", "task", "resultSchema", "metadata"], "request", issues);

  const phone = typeof value.phone === "string" ? value.phone : "";
  if (!isE164(phone)) {
    issues.push("phone must use strict E.164 format, for example +14155550100");
  }

  const locale = typeof value.locale === "string" ? value.locale : "";
  if (!CAMPAIGN_LOCALES.includes(locale as CampaignLocale)) {
    issues.push(`locale must be one of: ${CAMPAIGN_LOCALES.join(", ")}`);
  }

  const task = typeof value.task === "string" ? value.task.trim() : "";
  if (task.length < 20) issues.push("task must contain at least 20 characters");
  if (task.length > MAX_TASK_LENGTH) {
    issues.push(`task must not exceed ${MAX_TASK_LENGTH} characters`);
  }

  const resultSchema = value.resultSchema;
  try {
    assertCalleSchemaSubset(resultSchema);
  } catch (error) {
    issues.push(
      error instanceof CalleSchemaError
        ? `resultSchema is not CALL-E compatible: ${error.message}`
        : "resultSchema is invalid",
    );
  }

  const metadata = parseMetadata(value.metadata, issues);
  if (issues.length) throw new SafeCallInputError(issues);

  return {
    phone,
    locale: locale as CampaignLocale,
    task,
    resultSchema: resultSchema as JsonObject,
    ...(metadata && Object.keys(metadata).length ? { metadata } : {}),
  };
}

export function parseApprovedCallRequest(value: unknown): ApprovedCallRequest {
  if (!isPlainObject(value)) {
    throw new SafeCallInputError(["request body must be a JSON object"]);
  }

  const issues: string[] = [];
  onlyKeys(
    value,
    ["phone", "locale", "task", "resultSchema", "metadata", "approval"],
    "request",
    issues,
  );

  let draft: SafeCallDraft | undefined;
  try {
    draft = parseCallDraft({
      phone: value.phone,
      locale: value.locale,
      task: value.task,
      resultSchema: value.resultSchema,
      ...(value.metadata === undefined ? {} : { metadata: value.metadata }),
    });
  } catch (error) {
    if (error instanceof SafeCallInputError) issues.push(...error.issues);
    else throw error;
  }

  const rawApproval = value.approval;
  if (!isPlainObject(rawApproval)) issues.push("approval is required");

  const approvalValue = isPlainObject(rawApproval) ? rawApproval : {};
  onlyKeys(
    approvalValue,
    [
      "approvalDigest",
      "previewApproved",
      "recipientAuthorizationConfirmed",
      "callCount",
    ],
    "approval",
    issues,
  );

  const approvalDigest =
    typeof approvalValue.approvalDigest === "string" ? approvalValue.approvalDigest : "";
  if (!/^[a-f0-9]{64}$/.test(approvalDigest)) {
    issues.push("approval.approvalDigest must come from the preview endpoint");
  }
  if (approvalValue.previewApproved !== true) {
    issues.push("approval.previewApproved must be true");
  }
  if (approvalValue.callCount !== 1) {
    issues.push("approval.callCount must be exactly 1");
  }
  if (typeof approvalValue.recipientAuthorizationConfirmed !== "boolean") {
    issues.push("approval.recipientAuthorizationConfirmed must be a boolean");
  }

  if (issues.length || !draft) throw new SafeCallInputError(issues);

  return {
    ...draft,
    approval: {
      approvalDigest,
      previewApproved: true,
      recipientAuthorizationConfirmed:
        approvalValue.recipientAuthorizationConfirmed as boolean,
      callCount: 1,
    },
  };
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isPlainObject(value)) return value;

  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])]),
  );
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

/**
 * Binds approval and idempotency to the exact authenticated user, recipient, task,
 * result schema and metadata. Changing any approved value produces a different digest.
 */
export async function createCallPreview(
  userId: string,
  draft: SafeCallDraft,
  mode: CallMode,
): Promise<SafeCallPreview> {
  const approvalDigest = await sha256(
    JSON.stringify(
      canonicalize({
        version: 1,
        userId,
        phone: draft.phone,
        locale: draft.locale,
        task: draft.task,
        resultSchema: draft.resultSchema,
        metadata: draft.metadata ?? {},
      }),
    ),
  );

  return {
    mode,
    maskedPhone: maskPhone(draft.phone),
    callCount: 1,
    task: draft.task,
    resultSchema: draft.resultSchema,
    sideEffects:
      mode === "fake"
        ? ["No external request is made", "No phone call is placed", "No CALL-E credit is used"]
        : [
            "One outbound phone call is submitted to CALL-E",
            "The call may consume CALL-E credit",
            "An accepted call cannot be cancelled by Veyra",
          ],
    recipientAuthorizationRequired: mode === "live",
    canCancelAfterDispatch: false,
    approvalDigest,
    idempotencyKey: `veyra_${approvalDigest.slice(0, 48)}`,
  };
}
