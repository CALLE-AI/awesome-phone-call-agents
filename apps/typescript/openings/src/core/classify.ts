import type { CallStructuredResult, Verdict } from "./types";

/**
 * Compute a verdict from a structured CALL-E result.
 *
 * Deliberately pure: no I/O, no model calls. The classification logic is
 * auditable and unit-testable against a truth table. Unknown is never
 * upgraded to a confident verdict: a voicemail is `unreachable`, and reaching
 * a person without a plan/availability answer is `inconclusive` — never
 * `open`, and never `unreachable` (a human did answer).
 */
export function classifyResult(r: CallStructuredResult): Verdict {
  switch (r.line_outcome) {
    case "reached_staff":
      return classifyReachedStaff(r);
    case "voicemail":
    case "ivr_dead_end":
      // No person was reached. Do not guess.
      return "unreachable";
    case "disconnected":
      // The number does not exist in service. The listing is a ghost.
      return "ghost";
    case "wrong_entity":
      // The number reaches a different organization than the directory claims.
      return "ghost";
    case "declined":
      return "declined";
    case "unknown":
      return "unreachable";
  }
}

function classifyReachedStaff(r: CallStructuredResult): Verdict {
  // We reached a person but could not learn whether they accept the plan.
  // The call reached a human, so it is not "unreachable" — but there is no
  // actionable answer yet, so it is "inconclusive" (retry) unless we at least
  // learned that they are not accepting new patients.
  if (r.accepts_plan === "unknown") {
    return r.accepting_new_patients === "no" ? "not_accepting" : "inconclusive";
  }

  if (r.accepts_plan === "no" || r.accepts_plan === "out_of_network_only") {
    return "not_accepting";
  }

  // accepts_plan === "yes"
  switch (r.accepting_new_patients) {
    case "yes":
      return "open";
    case "waitlist_only":
      return "waitlist";
    case "no":
      return "not_accepting";
    case "unknown":
      // Plan accepted, but new-patient status unknown. Not an opening yet.
      return "waitlist";
  }
}
