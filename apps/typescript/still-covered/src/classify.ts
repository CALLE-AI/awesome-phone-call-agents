// Fail-closed classification. The voice agent proposes; the code decides; a caseworker confirms.
//
// Rules, in order:
//   1. Nobody reached (failed attempt, voicemail, nobody identifiable) -> unreachable.
//   2. A completed call with no usable structured result -> unverified.
//   3. "Don't call me again" wins over everything else -> opted_out.
//   4. Identity not confirmed -> identity_unconfirmed. Nothing about coverage was said.
//   5. An exemption answer of yes -> likely_exempt. Medical frailty needs BOTH a condition and a
//      limit on daily activities, as the CMS rule requires; a condition alone goes to review.
//   6. 80 or more hours, or income of about $580 a month -> likely_meets. They still must report.
//   7. Every exemption answered no and hours known to be short -> at_risk.
//   8. Anything unclear -> needs_review. Unknown never becomes "fine".
//   9. Low CALL-E confidence never lets a favourable result through without a human.
// If the agent told the person more than the answers support, a correction call is required.

import type { CallRecipient } from "@call-e/calle";
import { ASKABLE_CODES, type AskableCode, type Classification, type ExemptionCode, type Outcome, type ScreeningResult } from "./types.js";

export interface ClassifyInput {
  recipient: Pick<CallRecipient, "status" | "structuredResult" | "attempts">;
  confidenceLabel: string | null;
  hoursPerMonth: number;
}

export function isScreeningResult(value: unknown): value is ScreeningResult {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const v = value as Record<string, unknown>;
  return (
    typeof v["call_outcome"] === "string" &&
    typeof v["identity_confirmed"] === "string" &&
    v["answers"] !== null &&
    typeof v["answers"] === "object" &&
    typeof v["monthly_hours"] === "number" &&
    typeof v["agent_told_them"] === "string" &&
    typeof v["opt_out"] === "string"
  );
}

function answerOf(result: ScreeningResult, code: AskableCode): string {
  return result.answers[code] ?? "unknown";
}

export function classifyScreening(input: ClassifyInput): Classification {
  const { recipient, confidenceLabel, hoursPerMonth } = input;
  const reasons: string[] = [];
  const make = (outcome: Outcome, agentSaid: Classification["agentSaid"] = null): Classification => ({ outcome, reasons, exemptions: [], correctionNeeded: false, agentSaid });

  const completedAttempt = recipient.attempts.some((a) => a.status === "completed");
  if (recipient.status === "failed" || recipient.status === "skipped" || !completedAttempt) {
    const codes = recipient.attempts.map((a) => a.failureCode).filter((c): c is string => c !== null);
    reasons.push(codes.length > 0 ? `no completed attempt (${codes.join(", ")})` : "no completed attempt");
    return make("unreachable");
  }

  const result = recipient.structuredResult;
  if (!isScreeningResult(result)) {
    reasons.push("call completed but no valid structured result was returned");
    return make("unverified");
  }
  const agentSaid = result.agent_told_them;

  if (result.opt_out === "yes") {
    reasons.push("asked not to be called about this again");
    return make("opted_out", agentSaid);
  }
  if (result.call_outcome === "voicemail" || result.call_outcome === "no_person") {
    reasons.push(result.call_outcome === "voicemail" ? "voicemail answered; only the neutral message was left" : "no identifiable person answered");
    return make("unreachable", agentSaid);
  }
  if (result.call_outcome === "wrong_person" || result.identity_confirmed !== "yes") {
    reasons.push(result.call_outcome === "wrong_person" ? "someone else answered; nothing about coverage was discussed" : "identity was not confirmed; nothing about coverage was discussed");
    return make("identity_unconfirmed", agentSaid);
  }
  if (result.call_outcome === "declined_now") {
    reasons.push("confirmed identity but asked to be called at a better time");
    return make("declined", agentSaid);
  }
  if (result.call_outcome === "cut_short") {
    reasons.push("the call ended before the screening was finished");
    return make("unverified", agentSaid);
  }

  const exemptions: ExemptionCode[] = [];
  for (const code of ASKABLE_CODES) {
    if (answerOf(result, code) !== "yes") {
      continue;
    }
    if (code === "medically_frail" && result.frail_daily_limitation !== "yes") {
      continue;
    }
    exemptions.push(code);
  }
  const frailConditionOnly = answerOf(result, "medically_frail") === "yes" && result.frail_daily_limitation !== "yes";
  const meetsByHours = result.monthly_hours >= hoursPerMonth;
  const meetsByIncome = result.income_band === "580_or_more";

  let outcome: Outcome;
  if (exemptions.length > 0) {
    outcome = "likely_exempt";
    reasons.push(`answers support: ${exemptions.join(", ")}`);
  } else if (frailConditionOnly) {
    outcome = "needs_review";
    reasons.push("a health condition was reported without a limit on daily activities; medical frailty needs both, so a navigator reviews");
  } else if (meetsByHours || meetsByIncome) {
    outcome = "likely_meets";
    reasons.push(meetsByHours ? `reported about ${result.monthly_hours} hours a month` : "reported earning about 580 dollars a month or more");
  } else {
    const unclear = ASKABLE_CODES.filter((c) => answerOf(result, c) === "unknown");
    const shortfallKnown = result.monthly_hours >= 0 || result.income_band === "under_580";
    if (unclear.length === 0 && shortfallKnown) {
      outcome = "at_risk";
      reasons.push(result.monthly_hours >= 0 ? `no exemption found and about ${result.monthly_hours} hours a month, below ${hoursPerMonth}` : "no exemption found and income under 580 dollars a month");
    } else {
      outcome = "needs_review";
      if (unclear.length > 0) {
        reasons.push(`unclear answers: ${unclear.join(", ")}`);
      }
      if (!shortfallKnown) {
        reasons.push("hours and income were not established");
      }
    }
  }

  // Judged on what the answers support, before any confidence downgrade.
  const correctionNeeded =
    (agentSaid === "may_qualify_exemption" && outcome !== "likely_exempt") ||
    (agentSaid === "may_meet_requirement" && outcome !== "likely_meets" && outcome !== "likely_exempt");
  if (correctionNeeded) {
    reasons.push(`the agent said "${agentSaid}", which the answers do not support; a person must call back to correct it`);
  }

  const favourable = outcome === "likely_exempt" || outcome === "likely_meets";
  if (favourable && confidenceLabel !== null && confidenceLabel.toLowerCase() === "low") {
    reasons.push("CALL-E completion confidence is low; a navigator confirms before anything is sent");
    outcome = "needs_review";
  }

  return { outcome, reasons, exemptions: outcome === "likely_exempt" ? exemptions : [], correctionNeeded, agentSaid };
}
