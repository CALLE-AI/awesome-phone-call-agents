import { isSupportedCallLanguage, isSupportedRegion } from "./capabilities";
import type { CallFailureCode, CallPolicyDecision, CallPurpose, PrepareCallInput } from "./types";

/** @deprecated use capabilities registry */
export { CALLE_CAPABILITY as CALLE_SUPPORTED_CAPABILITY } from "./capabilities";
export const CALLE_SUPPORTED_REGIONS = new Set(["US", "CA", "GB", "AU"]);
export const CALLE_SUPPORTED_CALL_LANGUAGES = new Set(["en", "en-us", "en-gb", "es", "fr"]);

export type PolicyResult = {
  decision: CallPolicyDecision;
  reasonCode: CallFailureCode | "ok";
  dryRun: boolean;
  explanation: string;
};

export type PolicyEnv = {
  liveCallsEnabled: boolean;
  hasApiKey: boolean;
  killSwitch: boolean;
};

export function evaluateCallPolicy(input: PrepareCallInput, env: PolicyEnv): PolicyResult {
  if (env.killSwitch) {
    return {
      decision: "deny",
      reasonCode: "calls_disabled",
      dryRun: true,
      explanation: "Server kill switch is on; outbound calling is disabled.",
    };
  }

  if (!input.callConsentGranted) {
    return {
      decision: "deny",
      reasonCode: "missing_consent",
      dryRun: true,
      explanation: "Live phone contact requires explicit call consent on the woman record.",
    };
  }

  if (input.triageState === "urgent_in_person_care") {
    return {
      decision: "deny",
      reasonCode: "urgent_state_conflict",
      dryRun: true,
      explanation:
        "Urgent in-person care is already indicated. Keep human escalation primary; do not delay with an automated conversation.",
    };
  }

  const region = input.recipientRegion.toUpperCase();
  if (!isSupportedRegion(region)) {
    return {
      decision: "deny",
      reasonCode: "unsupported_region",
      dryRun: true,
      explanation: `Recipient region ${region} is not in the CALL-E supported demo set.`,
    };
  }

  const language = input.callLanguage.toLowerCase();
  if (!isSupportedCallLanguage(language)) {
    return {
      decision: "deny",
      reasonCode: "unsupported_language",
      dryRun: true,
      explanation:
        "CALL-E spoken language must be a supported runtime language. Bangla UI copy is separate from call language.",
    };
  }

  if (input.forceDryRun || !env.liveCallsEnabled || !env.hasApiKey) {
    return {
      decision: "dry_run",
      reasonCode: "ok",
      dryRun: true,
      explanation: !env.hasApiKey
        ? "No CALLE_API_KEY configured; running dry-run only."
        : !env.liveCallsEnabled
          ? "CALLE_LIVE_CALLS is not enabled; running dry-run only."
          : "forceDryRun requested; no live call will be placed.",
    };
  }

  return {
    decision: "allow",
    reasonCode: "ok",
    dryRun: false,
    explanation: "Policy allows a live CALL-E follow-up call.",
  };
}

export { buildFollowUpTask } from "./call-plan";
export { validateCallPolicy } from "./api-policy";
