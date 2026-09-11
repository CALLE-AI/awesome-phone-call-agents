import {
  DISPOSITIONS,
  INTENTS,
  PACKS,
  TOOL_IDS,
  type FraudOpsCase,
  type FraudOpsOutcome,
  type Intent,
} from "./types";

export class SchemaError extends Error {
  constructor(
    readonly target: "case" | "outcome",
    readonly issues: string[]
  ) {
    super(`${target} failed schema: ${issues.join("; ")}`);
    this.name = "SchemaError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && item.length > 0);
}

const E164 = /^\+[1-9][0-9]{7,14}$/;
const QUIET = /^[0-2][0-9]:[0-5][0-9]-[0-2][0-9]:[0-5][0-9]$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

export function validateCase(value: unknown): string[] {
  const issues: string[] = [];
  if (!isRecord(value)) return ["case must be an object"];

  for (const key of [
    "case_id",
    "intent",
    "pack_fired",
    "reason_plain",
    "contact",
    "context",
    "deep_links",
    "policy",
    "callback_url",
  ]) {
    if (!(key in value)) issues.push(`missing ${key}`);
  }

  if (typeof value.case_id !== "string" || !value.case_id) issues.push("case_id");
  if (!INTENTS.includes(value.intent as Intent)) issues.push("intent");
  if (!PACKS.includes(value.pack_fired as (typeof PACKS)[number])) {
    issues.push("pack_fired");
  }
  if (typeof value.reason_plain !== "string" || !value.reason_plain) {
    issues.push("reason_plain");
  }
  if (typeof value.callback_url !== "string" || !value.callback_url.startsWith("http")) {
    issues.push("callback_url");
  }

  if (!isRecord(value.contact)) {
    issues.push("contact");
  } else {
    if (typeof value.contact.name !== "string" || !value.contact.name) issues.push("contact.name");
    if (typeof value.contact.phone_e164 !== "string" || !E164.test(value.contact.phone_e164)) {
      issues.push("contact.phone_e164");
    }
    if (typeof value.contact.role !== "string" || !value.contact.role) issues.push("contact.role");
    if (typeof value.contact.locale !== "string" || value.contact.locale.length < 2) {
      issues.push("contact.locale");
    }
  }

  if (!isRecord(value.context)) {
    issues.push("context");
  } else {
    if (value.context.missing_docs !== undefined && !isStringArray(value.context.missing_docs)) {
      issues.push("context.missing_docs");
    }
    if (value.context.amount_due !== undefined && typeof value.context.amount_due !== "number") {
      issues.push("context.amount_due");
    }
    if (value.context.days_late !== undefined && !Number.isInteger(value.context.days_late)) {
      issues.push("context.days_late");
    }
  }

  if (!isRecord(value.deep_links)) {
    issues.push("deep_links");
  }

  if (value.intent === "evidence_collection") {
    if (typeof value.counterpart_case_id !== "string" || !value.counterpart_case_id) {
      issues.push("counterpart_case_id");
    }
    if (typeof value.safety_sensitive !== "boolean") issues.push("safety_sensitive");
    if (
      typeof value.incident_summary_plain !== "string" ||
      !value.incident_summary_plain
    ) {
      issues.push("incident_summary_plain");
    }
    if (
      !isRecord(value.deep_links) ||
      typeof value.deep_links.evidence_share !== "string" ||
      !value.deep_links.evidence_share.startsWith("http")
    ) {
      issues.push("deep_links.evidence_share");
    }
  }

  if (!isRecord(value.policy)) {
    issues.push("policy");
  } else {
    if (!Number.isInteger(value.policy.attempt_n)) issues.push("policy.attempt_n");
    if (!Number.isInteger(value.policy.max_attempts)) issues.push("policy.max_attempts");
    if (
      typeof value.policy.quiet_hours_local !== "string" ||
      !QUIET.test(value.policy.quiet_hours_local)
    ) {
      issues.push("policy.quiet_hours_local");
    }
    if (typeof value.policy.allow_ptp !== "boolean") issues.push("policy.allow_ptp");
    if (typeof value.policy.allow_pay_link_sms !== "boolean") {
      issues.push("policy.allow_pay_link_sms");
    }
  }

  return issues;
}

export function validateOutcome(value: unknown): string[] {
  const issues: string[] = [];
  if (!isRecord(value)) return ["outcome must be an object"];

  for (const key of [
    "case_id",
    "intent",
    "call_id",
    "recording_id",
    "disposition",
    "quotes",
    "next_action",
    "fields",
    "transcript_snippet",
    "ended_at",
  ]) {
    if (!(key in value)) issues.push(`missing ${key}`);
  }

  if (typeof value.case_id !== "string" || !value.case_id) issues.push("case_id");
  if (!INTENTS.includes(value.intent as Intent)) issues.push("intent");
  if (typeof value.call_id !== "string" || !value.call_id) issues.push("call_id");
  if (typeof value.recording_id !== "string" || !value.recording_id) {
    issues.push("recording_id");
  }
  if (typeof value.next_action !== "string" || !value.next_action) {
    issues.push("next_action");
  }
  if (typeof value.transcript_snippet !== "string") issues.push("transcript_snippet");
  if (typeof value.ended_at !== "string" || !DATETIME.test(value.ended_at)) {
    issues.push("ended_at");
  }
  if (!isStringArray(value.quotes) && !Array.isArray(value.quotes)) {
    issues.push("quotes");
  } else if (Array.isArray(value.quotes) && !isStringArray(value.quotes)) {
    issues.push("quotes items");
  }

  const intent = value.intent as Intent;
  const allowed = DISPOSITIONS[intent];
  if (allowed && !allowed.includes(value.disposition as never)) {
    issues.push(`disposition ${String(value.disposition)} not valid for ${intent}`);
  }

  if (!isRecord(value.fields)) {
    issues.push("fields");
  } else {
    if (value.fields.ptp_date !== undefined && !DATE.test(String(value.fields.ptp_date))) {
      issues.push("fields.ptp_date");
    }
    if (value.fields.missing_docs !== undefined && !isStringArray(value.fields.missing_docs)) {
      issues.push("fields.missing_docs");
    }
    if (
      value.fields.callback_at !== undefined &&
      (typeof value.fields.callback_at !== "string" || !DATETIME.test(value.fields.callback_at))
    ) {
      issues.push("fields.callback_at");
    }
    if (
      value.fields.follow_up_at !== undefined &&
      (typeof value.fields.follow_up_at !== "string" ||
        !DATETIME.test(value.fields.follow_up_at))
    ) {
      issues.push("fields.follow_up_at");
    }
    if (
      value.fields.sentiment_check_sent !== undefined &&
      typeof value.fields.sentiment_check_sent !== "boolean"
    ) {
      issues.push("fields.sentiment_check_sent");
    }
    if (
      value.fields.advocate_assigned !== undefined &&
      typeof value.fields.advocate_assigned !== "boolean"
    ) {
      issues.push("fields.advocate_assigned");
    }
    if (
      value.fields.tool_invoked !== undefined &&
      !TOOL_IDS.includes(value.fields.tool_invoked as (typeof TOOL_IDS)[number])
    ) {
      issues.push("fields.tool_invoked");
    }
    if (
      value.fields.hostility_strikes !== undefined &&
      (!Number.isInteger(value.fields.hostility_strikes) ||
        (value.fields.hostility_strikes as number) < 0 ||
        (value.fields.hostility_strikes as number) > 2)
    ) {
      issues.push("fields.hostility_strikes");
    }
    if (
      value.fields.deescalation_override !== undefined &&
      typeof value.fields.deescalation_override !== "boolean"
    ) {
      issues.push("fields.deescalation_override");
    }
    if (
      value.fields.unsafe_flag !== undefined &&
      typeof value.fields.unsafe_flag !== "boolean"
    ) {
      issues.push("fields.unsafe_flag");
    }
  }

  return issues;
}

export function assertValidCase(value: unknown): FraudOpsCase {
  const issues = validateCase(value);
  if (issues.length) throw new SchemaError("case", issues);
  return value as FraudOpsCase;
}

export function assertValidOutcome(value: unknown): FraudOpsOutcome {
  const issues = validateOutcome(value);
  if (issues.length) throw new SchemaError("outcome", issues);
  return value as FraudOpsOutcome;
}
