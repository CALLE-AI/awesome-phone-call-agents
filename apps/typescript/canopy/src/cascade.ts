// What happens after a verdict. Pure functions: no clock, no socket, no call.
//
// Silence is the signal. The people who die in heat waves are the ones nobody reached,
// so an unreachable person is never quietly dropped: they are redialled once, then their
// emergency contact is phoned, then they go on the door-knock list for a human.

import type { EscalationResult, NextAction, Outcome, PersonState } from "./types.js";

export interface CascadePolicy {
  /** Total dial attempts to the person before the contact is phoned. */
  maxPersonAttempts: number;
  /** Minutes between the first and second attempt. */
  retryDelayMinutes: number;
  /** Hours until a yellow person is checked again. */
  followUpHours: number;
}

export const DEFAULT_POLICY: CascadePolicy = {
  maxPersonAttempts: 2,
  retryDelayMinutes: 20,
  followUpHours: 2,
};

export function nextAction(state: Pick<PersonState, "attempts" | "contactCalled" | "outcome">, hasContact: boolean, policy: CascadePolicy = DEFAULT_POLICY): NextAction {
  const outcome: Outcome | null = state.outcome;
  switch (outcome) {
    case "green":
      return { type: "close", reason: "every signal agreed the person is safe" };
    case "yellow":
      return {
        type: "follow-up",
        reason: "discomfort or an unmet need; check again",
        delayMinutes: policy.followUpHours * 60,
      };
    case "red":
      if (hasContact && !state.contactCalled) {
        return {
          type: "escalate",
          reason: "red flags reported; phone the emergency contact now",
          suggestEmergencyServices: true,
        };
      }
      return {
        type: "door-knock",
        reason: hasContact ? "contact already phoned; a person must go" : "no emergency contact on file; a person must go",
        suggestEmergencyServices: true,
      };
    case "not_attempted":
      return { type: "operator-review", reason: "CALL-E did not accept the call task; nobody was dialled, so nobody is alerted. Resume the event or call by hand." };
    case "unreachable":
    case "unverified":
      if (state.attempts < policy.maxPersonAttempts) {
        return {
          type: "retry",
          reason: outcome === "unreachable" ? "not reached; redial once" : "call did not establish the facts; redial once",
          delayMinutes: policy.retryDelayMinutes,
        };
      }
      if (hasContact && !state.contactCalled) {
        return { type: "contact-call", reason: "still not reached after redial; ask the emergency contact to check" };
      }
      return { type: "door-knock", reason: "not reached and no contact available; a person must go" };
    case null:
      return { type: "retry", reason: "no verdict yet", delayMinutes: 0 };
    default: {
      const exhaustive: never = outcome;
      return exhaustive;
    }
  }
}

export type EscalationDisposition =
  | { kind: "contact_committed"; etaMinutes: number }
  | { kind: "emergency_services" }
  | { kind: "door_knock"; reason: string };

/** Reads an escalation call result the same fail-closed way: only a clear yes is a commitment. */
export function escalationDisposition(result: EscalationResult | null, personOutcome: Outcome | null): EscalationDisposition {
  if (result === null || result.reached !== "yes") {
    return { kind: "door_knock", reason: "contact not reached" };
  }
  if (result.wants_emergency_services === "yes") {
    return { kind: "emergency_services" };
  }
  if (result.will_check === "yes") {
    const eta = Number.isFinite(result.eta_minutes) && result.eta_minutes > 0 ? Math.min(result.eta_minutes, 240) : 30;
    if (personOutcome === "red" && eta > 60) {
      return { kind: "door_knock", reason: `contact committed but ETA of ${eta} minutes is too long for red flags` };
    }
    return { kind: "contact_committed", etaMinutes: eta };
  }
  return { kind: "door_knock", reason: result.will_check === "no" ? "contact declined" : "contact gave no clear commitment" };
}
