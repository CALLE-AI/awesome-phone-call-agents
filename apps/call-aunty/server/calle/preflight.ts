import { isSupportedCallLanguage, isSupportedRegion } from "./capabilities";
import type { PolicyEnv } from "./policy";
import { evaluateCallPolicy } from "./policy";
import type { CallFailureCode, CallPolicyDecision, PrepareCallInput } from "./types";
import { e164PhoneSchema } from "./types";

export type PreflightReason = {
  code: CallFailureCode | "ok";
  field?: string;
  message: string;
  blocking: boolean;
};

export type PreflightResult = {
  decision: CallPolicyDecision;
  dryRun: boolean;
  allowed: boolean;
  reasons: PreflightReason[];
  summary: string;
};

function reason(
  code: CallFailureCode | "ok",
  message: string,
  blocking: boolean,
  field?: string,
): PreflightReason {
  return { code, message, blocking, field };
}

export function runPreflight(input: PrepareCallInput, env: PolicyEnv): PreflightResult {
  const reasons: PreflightReason[] = [];

  const phone = e164PhoneSchema.safeParse(input.recipientE164);
  if (!phone.success) {
    reasons.push(reason("invalid_recipient", "Recipient must be a valid E.164 number.", true, "recipientE164"));
  }

  if (!input.callConsentGranted) {
    reasons.push(
      reason("missing_consent", "Explicit call consent is required before placing a live call.", true, "callConsentGranted"),
    );
  } else if (!input.consentSource || input.consentSource === "unknown") {
    reasons.push(
      reason("missing_consent", "Consent source should be recorded; attestation alone is acceptable for demo.", false, "consentSource"),
    );
  }

  if (!isSupportedRegion(input.recipientRegion)) {
    reasons.push(
      reason(
        "unsupported_region",
        `Region ${input.recipientRegion.toUpperCase()} is not in the supported CALL-E demo set.`,
        true,
        "recipientRegion",
      ),
    );
  }

  if (!isSupportedCallLanguage(input.callLanguage)) {
    reasons.push(
      reason(
        "unsupported_language",
        "Call language must be a supported runtime language (Bangla UI is separate).",
        true,
        "callLanguage",
      ),
    );
  }

  if (input.triageState === "urgent_in_person_care") {
    reasons.push(
      reason(
        "urgent_state_conflict",
        "Urgent in-person care is indicated; human escalation stays primary.",
        true,
        "triageState",
      ),
    );
  }

  if (env.killSwitch) {
    reasons.push(reason("calls_disabled", "Server kill switch is enabled.", true));
  }

  if (!env.hasApiKey) {
    reasons.push(reason("ok", "No CALLE_API_KEY — dry-run only.", false));
  } else if (!env.liveCallsEnabled) {
    reasons.push(reason("ok", "CALLE_LIVE_CALLS is off — dry-run only.", false));
  }

  if (input.forceDryRun) {
    reasons.push(reason("ok", "forceDryRun requested.", false));
  }

  const policy = evaluateCallPolicy(input, env);
  const blocked = reasons.some((r) => r.blocking) || policy.decision === "deny";

  return {
    decision: policy.decision,
    dryRun: policy.dryRun,
    allowed: !blocked,
    reasons,
    summary: policy.explanation,
  };
}
