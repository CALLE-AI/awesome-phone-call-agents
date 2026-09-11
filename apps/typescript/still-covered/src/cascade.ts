// What happens after a verdict. Pure functions: no clock, no socket, no call.
//
// Silence is the signal. The people who lose coverage over paperwork are the ones nobody reached,
// so an unreachable person is redialled once and then goes to the letter-and-outreach list with a
// high priority. Nobody is ever called more than three times in one campaign.

import type { NextAction, Outcome } from "./types.js";

export interface CascadePolicy {
  /** Calls per person in the first pass plus the redial. */
  maxAttempts: number;
  retryDelayMinutes: number;
  /** Minutes until someone who asked for a better time is called again. */
  declinedRetryMinutes: number;
}

export const DEFAULT_POLICY: CascadePolicy = {
  maxAttempts: 2,
  retryDelayMinutes: 30,
  declinedRetryMinutes: 60,
};

/** Absolute cap per person per campaign, whatever the configuration says. */
export const HARD_CALL_CAP = 3;

export function nextAction(outcome: Outcome | null, attempts: number, policy: CascadePolicy = DEFAULT_POLICY): NextAction {
  switch (outcome) {
    case "cleared_by_data":
      return { type: "none", reason: "the state's own records already settle this person; no call needed" };
    case "likely_exempt":
      return { type: "packet", reason: "answers support an exemption; a caseworker reviews the packet before anything is recorded" };
    case "likely_meets":
      return { type: "report-reminder", reason: "may already meet the requirement; still needs to report it" };
    case "at_risk":
      return { type: "navigator", reason: "no exemption found and below the requirement; a navigator helps before the check date", highPriority: true };
    case "needs_review":
      return { type: "navigator", reason: "answers were incomplete or unclear; a navigator follows up" };
    case "declined":
      return attempts < HARD_CALL_CAP
        ? { type: "follow-up", reason: "confirmed identity and asked for a better time", delayMinutes: policy.declinedRetryMinutes }
        : { type: "mail", reason: "asked for a better time but the call limit is reached; send the plain-language letter" };
    case "opted_out":
      return { type: "suppress", reason: "asked not to be called again; mail only from now on" };
    case "identity_unconfirmed":
    case "unreachable":
    case "unverified":
      if (attempts < Math.min(policy.maxAttempts, HARD_CALL_CAP)) {
        return {
          type: "retry",
          reason: outcome === "identity_unconfirmed" ? "identity not confirmed; redial once" : outcome === "unreachable" ? "not reached; redial once" : "call did not finish the screening; redial once",
          delayMinutes: policy.retryDelayMinutes,
        };
      }
      return { type: "mail", reason: "not screened after the maximum number of calls; send the plain-language letter and add to community outreach", highPriority: true };
    case "not_attempted":
      return { type: "operator-review", reason: "CALL-E did not accept the call task; nobody was dialled. Resume the campaign or call by hand." };
    case null:
      return { type: "retry", reason: "no result yet", delayMinutes: 0 };
    default: {
      const exhaustive: never = outcome;
      return exhaustive;
    }
  }
}
