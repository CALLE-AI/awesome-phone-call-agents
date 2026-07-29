/**
 * Request file loading and validation.
 *
 * Nothing here guesses. A missing phone number, an unenrolled approver or a
 * window longer than the policy allows is an error, not a default.
 */

import { readFileSync } from "node:fs";
import type {
  Approver,
  ApprovalRequest,
  Policy,
  PolicyInput,
} from "./types.js";

export class ConfigError extends Error {}

const E164 = /^\+[1-9]\d{6,14}$/;
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:T[\d:.]+Z?)?$/;

export const POLICY_LIMITS = {
  perCallTimeoutSeconds: { min: 60, max: 600, default: 240 },
  /**
   * Ten minutes is the ceiling. NIST SP 800-63B invalidates an out-of-band
   * authentication that is not completed within ten minutes and an approval
   * that outlives its request is worse than no approval.
   */
  windowSeconds: { min: 60, max: 600, default: 600 },
  minConfidence: { min: 0, max: 1, default: 0.5 },
  maxFailedAttempts: { min: 1, max: 5, default: 3 },
} as const;

export const TITLE_MAX = 120;
export const SUMMARY_MAX = 600;

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ConfigError(`${field} must be a non-empty string.`);
  }
  return value.trim();
}

function requireNumber(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new ConfigError(`${field} must be a number.`);
  }
  if (value < min || value > max) {
    throw new ConfigError(`${field} must be between ${min} and ${max}. Received ${value}.`);
  }
  return value;
}

function resolvePolicy(input: PolicyInput | undefined): Policy {
  const policy = input ?? {};
  const mode = policy.mode ?? "single";
  if (mode !== "single" && mode !== "dual") {
    throw new ConfigError(`policy.mode must be single or dual. Received ${String(mode)}.`);
  }
  const binding = policy.binding ?? "code_from_request";
  if (binding !== "code_from_request" && binding !== "liveness_phrase") {
    throw new ConfigError(
      `policy.binding must be code_from_request or liveness_phrase. Received ${String(binding)}.`,
    );
  }
  const perCallTimeoutSeconds =
    policy.per_call_timeout_seconds === undefined
      ? POLICY_LIMITS.perCallTimeoutSeconds.default
      : requireNumber(
          policy.per_call_timeout_seconds,
          "policy.per_call_timeout_seconds",
          POLICY_LIMITS.perCallTimeoutSeconds.min,
          POLICY_LIMITS.perCallTimeoutSeconds.max,
        );
  const windowSeconds =
    policy.window_seconds === undefined
      ? POLICY_LIMITS.windowSeconds.default
      : requireNumber(
          policy.window_seconds,
          "policy.window_seconds",
          POLICY_LIMITS.windowSeconds.min,
          POLICY_LIMITS.windowSeconds.max,
        );
  if (perCallTimeoutSeconds > windowSeconds) {
    throw new ConfigError(
      "policy.per_call_timeout_seconds must not exceed policy.window_seconds.",
    );
  }
  const minConfidence =
    policy.min_confidence === undefined
      ? POLICY_LIMITS.minConfidence.default
      : requireNumber(
          policy.min_confidence,
          "policy.min_confidence",
          POLICY_LIMITS.minConfidence.min,
          POLICY_LIMITS.minConfidence.max,
        );
  const maxFailedAttempts =
    policy.max_failed_attempts === undefined
      ? POLICY_LIMITS.maxFailedAttempts.default
      : requireNumber(
          policy.max_failed_attempts,
          "policy.max_failed_attempts",
          POLICY_LIMITS.maxFailedAttempts.min,
          POLICY_LIMITS.maxFailedAttempts.max,
        );
  const allowStructuredOnly = policy.allow_structured_only ?? false;
  if (typeof allowStructuredOnly !== "boolean") {
    throw new ConfigError("policy.allow_structured_only must be true or false.");
  }
  return {
    mode,
    binding,
    perCallTimeoutSeconds,
    windowSeconds,
    minConfidence,
    maxFailedAttempts,
    allowStructuredOnly,
  };
}

function validateApprover(value: unknown, index: number, environment: string): Approver {
  if (typeof value !== "object" || value === null) {
    throw new ConfigError(`approvers[${index}] must be an object.`);
  }
  const raw = value as Record<string, unknown>;
  const id = requireString(raw.id, `approvers[${index}].id`);
  const name = requireString(raw.name, `approvers[${index}].name`);
  const phone = requireString(raw.phone, `approvers[${index}].phone`);
  if (!E164.test(phone)) {
    throw new ConfigError(
      `approvers[${index}].phone must be E.164, for example +14155550100. Received ${phone}.`,
    );
  }
  const enrolledAt = requireString(raw.enrolled_at, `approvers[${index}].enrolled_at`);
  if (!ISO_DATE.test(enrolledAt)) {
    throw new ConfigError(`approvers[${index}].enrolled_at must be an ISO date.`);
  }
  const authorizedFor = raw.authorized_for;
  if (!Array.isArray(authorizedFor) || authorizedFor.length === 0) {
    throw new ConfigError(`approvers[${index}].authorized_for must list at least one environment.`);
  }
  const scopes = authorizedFor.map((scope, scopeIndex) =>
    requireString(scope, `approvers[${index}].authorized_for[${scopeIndex}]`),
  );
  if (!scopes.includes(environment)) {
    throw new ConfigError(
      `approvers[${index}] (${id}) is not authorized for ${environment}. Enrolled scopes: ${scopes.join(", ")}.`,
    );
  }
  const approver: Approver = {
    id,
    name,
    phone,
    enrolled_at: enrolledAt,
    authorized_for: scopes,
  };
  if (raw.region !== undefined) {
    approver.region = requireString(raw.region, `approvers[${index}].region`);
  }
  if (raw.locale !== undefined) {
    approver.locale = requireString(raw.locale, `approvers[${index}].locale`);
  }
  return approver;
}

export function parseRequest(input: unknown): ApprovalRequest {
  if (typeof input !== "object" || input === null) {
    throw new ConfigError("The request file must contain a JSON object.");
  }
  const raw = input as Record<string, unknown>;
  const requestId = requireString(raw.request_id, "request_id");
  if (!REQUEST_ID.test(requestId)) {
    throw new ConfigError(
      "request_id must be 3 to 64 characters of letters, digits, dot, dash or underscore.",
    );
  }
  if (typeof raw.change !== "object" || raw.change === null) {
    throw new ConfigError("change must be an object.");
  }
  const changeRaw = raw.change as Record<string, unknown>;
  const title = requireString(changeRaw.title, "change.title");
  if (title.length > TITLE_MAX) {
    throw new ConfigError(`change.title must be ${TITLE_MAX} characters or fewer.`);
  }
  const summary = requireString(changeRaw.summary, "change.summary");
  if (summary.length > SUMMARY_MAX) {
    throw new ConfigError(
      `change.summary must be ${SUMMARY_MAX} characters or fewer. A phone call cannot read an essay.`,
    );
  }
  const environment = requireString(changeRaw.environment, "change.environment");
  const requestedBy = requireString(changeRaw.requested_by, "change.requested_by");
  const links = changeRaw.links;
  if (links !== undefined && !Array.isArray(links)) {
    throw new ConfigError("change.links must be an array of strings.");
  }
  const change = {
    title,
    summary,
    environment,
    requested_by: requestedBy,
    ...(links === undefined
      ? {}
      : {
          links: (links as unknown[]).map((link, index) =>
            requireString(link, `change.links[${index}]`),
          ),
        }),
  };

  const policy = resolvePolicy(raw.policy as PolicyInput | undefined);

  if (!Array.isArray(raw.approvers) || raw.approvers.length === 0) {
    throw new ConfigError("approvers must list at least one enrolled approver.");
  }
  const approvers = raw.approvers.map((approver, index) =>
    validateApprover(approver, index, environment),
  );
  const ids = new Set(approvers.map((approver) => approver.id));
  if (ids.size !== approvers.length) {
    throw new ConfigError("approvers must have unique ids.");
  }
  const phones = new Set(approvers.map((approver) => approver.phone));
  if (phones.size !== approvers.length) {
    throw new ConfigError(
      "approvers must have unique phone numbers. Two approvers on one handset is one approver.",
    );
  }
  if (policy.mode === "dual" && approvers.length < 2) {
    throw new ConfigError("policy.mode dual needs at least two enrolled approvers.");
  }

  return {
    requestId,
    organization: raw.organization === undefined ? "" : requireString(raw.organization, "organization"),
    system: raw.system === undefined ? "automation" : requireString(raw.system, "system"),
    change,
    policy,
    approvers,
  };
}

export function loadRequest(path: string): ApprovalRequest {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    throw new ConfigError(`Cannot read request file ${path}: ${(error as Error).message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new ConfigError(`Request file ${path} is not valid JSON: ${(error as Error).message}`);
  }
  return parseRequest(parsed);
}
