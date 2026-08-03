import type { ClassificationResult, WellnessStructuredResult } from "./types.js";

/**
 * Keywords in `condition_summary` that suggest the person's condition is
 * concerning enough to combine with a reported concern and escalate. A coarse
 * heuristic, not a medical judgment — it only decides how quickly a caregiver
 * should be notified, never what's medically wrong.
 */
const CONCERNING_CONDITION_KEYWORDS = [
  "pain",
  "hurts",
  "hurting",
  "can't move",
  "cannot move",
  "dizzy",
  "dizziness",
  "fever",
  "feverish",
  "nauseous",
  "nausea",
  "unwell",
  "not well",
  "not feeling well",
  "collapsed",
  "exhausted",
];

function conditionSoundsConcerning(summary: string | undefined): boolean {
  if (!summary) return false;
  const lower = summary.toLowerCase();
  return CONCERNING_CONDITION_KEYWORDS.some((keyword) => lower.includes(keyword));
}

/**
 * Classifies a completed call's structured result into `ok`, `mild_concern`,
 * or `escalate`.
 *
 * Rule: escalate when there's a reported concern *combined with* a concerning
 * condition or meal status, or when the person didn't answer at all. A
 * concern or a condition issue alone is a mild concern, not an escalation.
 */
export function classifyWellnessResult(
  result: Record<string, unknown> | null
): ClassificationResult {
  if (!result) {
    return {
      level: "escalate",
      reasons: ["No structured result was returned (the call may have failed)."],
    };
  }

  const r = result as unknown as WellnessStructuredResult;

  if (r.answered === false) {
    return { level: "escalate", reasons: ["No answer to the call."] };
  }

  const reasons: string[] = [];
  const hasConcern = r.concerns_reported === true;
  const mealConcerning = r.meal_status === "somewhat_concerning";
  const conditionConcerning = conditionSoundsConcerning(r.condition_summary);

  if (hasConcern) {
    reasons.push(`Reported a concern: ${r.concerns_detail ?? "(no detail given)"}`);
  }
  if (mealConcerning) {
    reasons.push("Possible concern with meals.");
  }
  if (conditionConcerning) {
    reasons.push(`Statement suggesting a health concern: "${r.condition_summary}"`);
  }

  const conditionOrMealConcerning = mealConcerning || conditionConcerning;

  if (hasConcern && conditionOrMealConcerning) {
    return { level: "escalate", reasons };
  }
  if (hasConcern || conditionOrMealConcerning) {
    return { level: "mild_concern", reasons };
  }
  return {
    level: "ok",
    reasons: ["Condition, meals, and concerns were all reported as fine."],
  };
}
