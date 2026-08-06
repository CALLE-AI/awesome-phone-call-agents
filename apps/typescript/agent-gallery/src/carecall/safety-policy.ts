import {
  careCallSafetyFlagDetails,
  careCallUrgencyDetails,
  outcomesForKind,
  careCallOutcomeLabel,
  type CareCallSafetyFlag,
  type CareCallUrgency,
} from "../workflows/carecall";
import { routineKindOrder, routineKindProfile } from "./routine-kinds";

/**
 * The operator-facing safety policy.
 *
 * The per-kind boundaries, review flags, urgency levels, and permitted
 * outcomes are read from the code that enforces them rather than restated, so
 * the policy an operator reads cannot drift from the rules the workflow
 * actually applies. Only the standing may/never rules are written here, and
 * they mirror the product boundary in the app README.
 */

export const safetyPolicyMay: string[] = [
  "Repeat a caregiver-approved reminder in the words the caregiver supplied.",
  "Ask one clear question at a time and wait for an answer.",
  "Record what the senior says about themselves as a self-report, nothing more.",
  "Ask whether food, a drink, or medication is within reach.",
  "Offer a callback from an authorized caregiver.",
  "Route ambiguity, silence, distress, and requests for help to a person.",
];

export const safetyPolicyNever: string[] = [
  "Diagnose a condition, assess mood, or screen for anything.",
  "Recommend a dose, or advise repeating, skipping, delaying, or changing medication.",
  "Treat silence, hesitation, or an ambiguous answer as completion.",
  "Ask for money, banking information, an OTP, a password, or a full NRIC.",
  "Create a recurring schedule that is not visible and stoppable.",
  "Claim that emergency help or a caregiver has been dispatched.",
];

export interface PolicyKindEntry {
  kind: string;
  label: string;
  callLabel: string;
  boundary: string;
  outcomes: string[];
}

export function safetyPolicyKinds(): PolicyKindEntry[] {
  return routineKindOrder.map((kind) => {
    const profile = routineKindProfile(kind);
    return {
      kind,
      label: profile.label,
      callLabel: profile.callLabel,
      boundary: profile.boundary,
      outcomes: outcomesForKind(kind).map(careCallOutcomeLabel),
    };
  });
}

export const safetyPolicyFlags = Object.entries(careCallSafetyFlagDetails)
  .map(([flag, detail]) => ({ flag: flag as CareCallSafetyFlag, ...detail }));

/** Ordered most urgent first; "none" is stated last so the settled case is visible too. */
export const safetyPolicyUrgencies = (["contact-now", "follow-up-today", "review", "none"] as CareCallUrgency[])
  .map((urgency) => ({ urgency, ...careCallUrgencyDetails[urgency] }));

export const safetyPolicyEscalation = [
  "A live call runs in English only. Other languages stay blocked until their quality is verified.",
  "A provider marking a call complete is not proof that anything was taken, eaten, drunk, or attended.",
  "An uncertain start, a lost lease, a missed occurrence, or a revoked authorization stops and waits for a person. Nothing is redialled blindly.",
  "Cancellation cannot recall a call the provider has already accepted.",
];

export const safetyPolicyEmergency =
  "For an immediate emergency in Singapore a person should call 995. CareCall does not contact emergency services, and never says that it has.";
