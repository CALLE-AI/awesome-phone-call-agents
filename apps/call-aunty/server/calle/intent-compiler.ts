import { z } from "zod";

import { callPurposeSchema, triageStateSchema, type CallPurpose, type PrepareCallInput } from "./types";

export const compiledCallIntentSchema = z.object({
  purpose: callPurposeSchema,
  targetCategory: z.enum(["beneficiary", "caregiver", "clinic_line"]),
  desiredOutcome: z.string().min(1).max(256),
  consentStatus: z.enum(["granted", "missing", "expired", "revoked"]),
  safetyCategory: z.enum(["routine", "contact_chw_today", "urgent_in_person_care", "blocked"]),
  callWindow: z.enum(["morning", "afternoon", "evening", "any", "unknown"]),
  allowedTools: z.array(z.enum(["structured_capture", "callback_scheduling", "escalation_flag"])),
  beneficiaryRef: z.string().min(1).max(128),
  locale: z.string().min(2).max(16),
  region: z.string().min(2).max(8),
  compileVersion: z.string(),
  source: z.enum(["structured", "colloquial"]),
});

export type CompiledCallIntent = z.infer<typeof compiledCallIntentSchema>;

export type CompileIssue = {
  code: string;
  field?: string;
  message: string;
  blocking: boolean;
};

export type CompileResult =
  | { ok: true; intent: CompiledCallIntent; issues: CompileIssue[] }
  | { ok: false; issues: CompileIssue[] };

const PURPOSE_ALIASES: Record<string, CallPurpose> = {
  remind: "appointment_coordination",
  reminder: "appointment_coordination",
  appointment: "appointment_coordination",
  visit: "appointment_coordination",
  callback: "callback_confirmation",
  "call back": "callback_confirmation",
  followup: "follow_up_after_check_in",
  "follow up": "follow_up_after_check_in",
  checkin: "follow_up_after_check_in",
  "check in": "follow_up_after_check_in",
};

function inferPurpose(text: string): CallPurpose | null {
  const lower = text.toLowerCase();
  for (const [key, purpose] of Object.entries(PURPOSE_ALIASES)) {
    if (lower.includes(key)) return purpose;
  }
  return null;
}

function inferWindow(text: string): CompiledCallIntent["callWindow"] {
  const lower = text.toLowerCase();
  if (/\btomorrow\b|\bmorning\b/.test(lower)) return "morning";
  if (/\bafternoon\b/.test(lower)) return "afternoon";
  if (/\bevening\b|\btonight\b/.test(lower)) return "evening";
  return "unknown";
}

/** Normalize colloquial CHW phrasing into deterministic task fields. */
export function parseColloquialIntent(text: string): Partial<PrepareCallInput> & { rawText: string } {
  const purpose = inferPurpose(text) ?? "follow_up_after_check_in";
  const callWindow = inferWindow(text);
  return {
    rawText: text,
    womanId: "colloquial-beneficiary",
    purpose,
    recipientE164: "+15555550123",
    recipientRegion: "US",
    callLanguage: "en",
    triageState: /urgent|emergency|chest pain/i.test(text) ? "urgent_in_person_care" : "contact_chw_today",
    callConsentGranted: !/no consent|without consent/i.test(text),
    actionToken: `colloquial-${text.length}-${purpose}`.padEnd(8, "x"),
    forceDryRun: true,
    ...(callWindow !== "unknown" ? {} : {}),
  };
}

export function compileCallIntent(input: PrepareCallInput): CompileResult {
  const issues: CompileIssue[] = [];

  if (!input.callConsentGranted) {
    issues.push({
      code: "missing_consent",
      field: "callConsentGranted",
      message: "Explicit consent is required before compiling a call plan.",
      blocking: true,
    });
  }

  if (input.triageState === "urgent_in_person_care") {
    issues.push({
      code: "urgent_state_conflict",
      field: "triageState",
      message: "Urgent in-person care blocks automated outbound calling.",
      blocking: true,
    });
  }

  if (!input.recipientE164.startsWith("+")) {
    issues.push({
      code: "invalid_recipient",
      field: "recipientE164",
      message: "Recipient must be E.164.",
      blocking: true,
    });
  }

  const consentStatus: CompiledCallIntent["consentStatus"] = input.callConsentGranted
    ? "granted"
    : "missing";

  const safetyCategory: CompiledCallIntent["safetyCategory"] =
    input.triageState === "urgent_in_person_care"
      ? "blocked"
      : input.triageState === "contact_chw_today"
        ? "contact_chw_today"
        : "routine";

  const desiredOutcome: Record<CallPurpose, string> = {
    follow_up_after_check_in: "Confirm reachability and callback need.",
    appointment_coordination: "Confirm or reschedule care visit logistics.",
    callback_confirmation: "Confirm previously arranged callback window.",
  };

  if (issues.some((i) => i.blocking)) {
    return { ok: false, issues };
  }

  const intent = compiledCallIntentSchema.parse({
    purpose: input.purpose,
    targetCategory: "beneficiary",
    desiredOutcome: desiredOutcome[input.purpose],
    consentStatus,
    safetyCategory,
    callWindow: "any",
    allowedTools: ["structured_capture", "callback_scheduling", "escalation_flag"],
    beneficiaryRef: input.womanId,
    locale: input.callLanguage,
    region: input.recipientRegion.toUpperCase(),
    compileVersion: "v4.0.0",
    source: "structured",
  });

  return { ok: true, intent, issues };
}

export function compileFromColloquial(text: string): CompileResult {
  const parsed = parseColloquialIntent(text);
  const { rawText: _raw, ...prepareFields } = parsed;
  const result = compileCallIntent(prepareFields as PrepareCallInput);
  if (!result.ok) return result;
  return {
    ok: true,
    intent: { ...result.intent, source: "colloquial" },
    issues: result.issues,
  };
}
