import type { Candidate, CrisisCheck } from "./types";

/**
 * Crisis and safety guardrails for a standing availability watch.
 *
 * These are the non-negotiable gates. A phone product that searches for
 * healthcare access must not run at all when someone appears to be in crisis,
 * must never collect PHI, and must not harass a practice by re-calling it.
 */

const CRISIS_PATTERNS = [
  /suicid/i,
  /\bkill (myself|himself|herself|themse)/i,
  /want to (die|end (my|it|everything))/i,
  /hurting (myself|me)\b/i,
  /\bself-?harm/i,
  /\boverdos/i,
  /immediate danger/i,
  /will i (hurt|harm)/i,
] as const;

const DISCLOSURE = {
  OPENING: "Automated assistant",
  BODY: "Calling to verify availability and insurance acceptance for a person looking for care.",
} as const;

/** Keywords that would put PHI in a call task. Reject them before dialing. */
const PHI_PATTERNS = [
  /\b(diagnos\w*|condition|illness|disorder)s?\b/i,
  /\b(dob|date of birth)\b/i,
  /\bsocial security\b/i,
  /\b(ssn|medicare id)\b/i,
  /\bsymptoms?\b/i,
  /\b(medication|prescription|rx)\b/i,
  /\btreatment plan\b/i,
] as const;

/**
 * Screen a free-form need statement for crisis language.
 * When a crisis is detected, the caller must not start a search and should
 * surface local emergency or crisis resources instead.
 */
export function checkCrisis(input: string): CrisisCheck {
  if (!input || !input.trim()) {
    return { isCrisis: false };
  }
  for (const pattern of CRISIS_PATTERNS) {
    if (pattern.test(input)) {
      return { isCrisis: true, reason: `Matched crisis pattern: ${pattern.source}` };
    }
  }
  return { isCrisis: false };
}

/**
 * Reject a search spec whose `need` field would leak protected health
 * information into the call task. The call task should only ever ask about
 * plan acceptance and availability, never about a condition.
 */
export function containsPhi(input: string): boolean {
  if (!input) return false;
  return PHI_PATTERNS.some((pattern) => pattern.test(input));
}

/** The disclosure line CALL-E is asked to deliver at the start of every call. */
export function disclosureLine(): string {
  return `${DISCLOSURE.OPENING}. ${DISCLOSURE.BODY}`;
}

/**
 * Per-practice calling policy. A practice must not be called more than once
 * per cooldown window, and must never be called again once it has asked not
 * to be contacted.
 */
export interface CallPolicy {
  cooldownMs: number;
}

export const DEFAULT_CALL_POLICY: CallPolicy = { cooldownMs: 24 * 60 * 60 * 1000 };

/**
 * Decide whether a candidate may be called in this cycle.
 * Returns { allow: true } or { allow: false, reason }.
 */
export function mayCall(
  candidate: Candidate,
  lastCalledAt: Date | null,
  optedOut: boolean,
  now: Date,
  policy: CallPolicy = DEFAULT_CALL_POLICY,
): { allow: boolean; reason?: string } {
  if (optedOut) return { allow: false, reason: "practice_opted_out" };
  if (lastCalledAt) {
    const elapsed = now.getTime() - lastCalledAt.getTime();
    if (elapsed < policy.cooldownMs) {
      return { allow: false, reason: "cooldown" };
    }
  }
  return { allow: true };
}
