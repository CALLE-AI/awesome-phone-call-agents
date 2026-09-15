import type { BusinessConfig } from "../config/schema";
import type { LeadAnswer } from "./schema";

export interface ScoredAnswers {
  answers: LeadAnswer[];
  score: number;
}

/**
 * Weighted rubric score (0-100): each question contributes its configured weight when the
 * answer matches `qualifyingAnswers`; with no qualifying-answer rule configured, any non-empty
 * answer counts as a positive signal.
 */
export function scoreAnswers(
  config: BusinessConfig,
  structuredResult: Record<string, unknown>,
): ScoredAnswers {
  let earned = 0;
  let total = 0;
  const answers: LeadAnswer[] = [];

  for (const q of config.questions) {
    total += q.weight;
    const raw = structuredResult[q.id];
    const value = stringifyAnswer(raw);
    answers.push({ questionId: q.id, value });

    const hasRule = q.qualifyingAnswers && q.qualifyingAnswers.length > 0;
    if (hasRule) {
      if (q.qualifyingAnswers!.includes(value)) earned += q.weight;
    } else if (value !== "") {
      earned += q.weight;
    }
  }

  const score = total > 0 ? Math.round((earned / total) * 100) : 0;
  return { answers, score };
}

function stringifyAnswer(raw: unknown): string {
  if (raw === undefined || raw === null) return "";
  if (typeof raw === "boolean") return raw ? "true" : "false";
  return String(raw);
}
