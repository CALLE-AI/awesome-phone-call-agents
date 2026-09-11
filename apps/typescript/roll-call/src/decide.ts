import type {
  CallExtraction,
  CallOutcome,
  Disposition,
  GuardianAttempt,
  ReducedOutcome,
  SchoolConfig,
  TranscriptTurn,
} from "./types.js";

/**
 * The decision layer. Pure functions only: no clock, no network, no I/O.
 * CALL-E proposes an extraction; the transcript decides whether it stands.
 */

const AWARE_YES =
  /\b(i know|we know|yes[, .]|i am aware|i'm aware|is (sick|ill|unwell|at home)|has an appointment|ja[, .]|ich wei(ss|ß)|wir wissen|zuhause|zu hause|krank|termin)\b/i;
const AWARE_NO =
  /\b(did not know|didn't know|don't know|do not know|no idea|not aware|wasn't aware|what do you mean|should be (at|in) school|left for school|nein[, .]|wusste (ich |wir )?nicht|keine ahnung|sollte in der schule sein|ist losgegangen)\b/i;

function guardianTurns(transcript: TranscriptTurn[]): string[] {
  return transcript.filter((t) => t.speaker === "user").map((t) => t.text);
}

/**
 * Reduces one CALL-E outcome to the closed vocabulary. A `guardian_aware`
 * verdict is kept only when at least one guardian turn in the transcript
 * supports it. An unsupported verdict becomes `unknown` and the report says so.
 */
export function reduceOutcome(outcome: CallOutcome): ReducedOutcome {
  const r: CallExtraction | null = outcome.status === "completed" ? outcome.structuredResult : null;
  if (!r) {
    return {
      answeredBy: outcome.status === "completed" ? "unknown" : "no_answer",
      guardianAware: "unknown",
      reasonCategory: "unknown",
      expectedReturn: "",
      callbackRequested: "unknown",
      supportingTurn: null,
    };
  }
  const turns = guardianTurns(outcome.transcript);
  let aware = r.guardian_aware;
  let supportingTurn: string | null = null;
  if (r.answered_by !== "guardian") {
    aware = "unknown";
  } else if (aware === "yes") {
    supportingTurn = turns.find((t) => AWARE_YES.test(t) && !AWARE_NO.test(t)) ?? null;
    if (!supportingTurn) aware = "unknown";
  } else if (aware === "no") {
    supportingTurn = turns.find((t) => AWARE_NO.test(t)) ?? null;
    if (!supportingTurn) aware = "unknown";
  }
  return {
    answeredBy: r.answered_by,
    guardianAware: aware,
    reasonCategory: aware === "unknown" && r.answered_by === "guardian" ? "unknown" : r.reason_category,
    expectedReturn: r.expected_return ?? "",
    callbackRequested: r.answered_by === "guardian" ? r.callback_requested : "unknown",
    supportingTurn,
  };
}

/**
 * Whether the cascade should continue to the next guardian after this attempt.
 * It continues only when nobody who could answer for the child was reached.
 */
export function shouldContinueCascade(reduced: ReducedOutcome | null): boolean {
  if (!reduced) return true;
  return reduced.answeredBy !== "guardian";
}

export interface Decision {
  disposition: Disposition;
  because: string;
  nextAction: string;
}

export function decideStudent(attempts: GuardianAttempt[], school: SchoolConfig): Decision {
  const reached = attempts.find((a) => a.reduced?.answeredBy === "guardian");
  if (reached && reached.reduced) {
    const r = reached.reduced;
    const g = `guardian ${reached.guardianIndex + 1}`;
    if (r.guardianAware === "no") {
      return {
        disposition: "safeguarding_alert",
        because: `${g} said they did not know the child is absent: "${r.supportingTurn}"`,
        nextAction: `${school.safeguardingContact} must call ${g} now and follow the school's missing-pupil procedure.`,
      };
    }
    if (r.guardianAware === "yes") {
      const back = r.expectedReturn ? `, back ${r.expectedReturn}` : "";
      const cb = r.callbackRequested === "yes" ? " Guardian asked for a staff call-back." : "";
      return {
        disposition: "accounted_for",
        because: `${g} confirmed they know (${r.reasonCategory}${back}): "${r.supportingTurn}"`,
        nextAction: `Record the absence as explained.${cb}`,
      };
    }
    return {
      disposition: "needs_human_review",
      because: `${g} was reached but no transcript turn supports a clear yes or no about awareness`,
      nextAction: "Office staff read the transcript and call the guardian back.",
    };
  }
  const dialled = attempts.filter((a) => a.skippedReason === null);
  if (dialled.length === 0) {
    const reasons = attempts.map((a) => `guardian ${a.guardianIndex + 1}: ${a.skippedReason}`).join("; ");
    return {
      disposition: "not_called",
      because: reasons || "no guardians listed",
      nextAction: "Office staff contact the guardians by the school's usual channel.",
    };
  }
  const endpoints = dialled.map((a) => a.reduced?.answeredBy ?? "unknown").join(", ");
  return {
    disposition: "unreached",
    because: `${dialled.length} guardian(s) dialled, none confirmed being the guardian (${endpoints})`,
    nextAction: "Office staff keep trying by phone; escalate per the school's unexplained-absence policy.",
  };
}
