export const SCORE_CRITERIA_OPTIONS = [
  { id: "education", label: "Education explained clearly (degree, college, year)" },
  { id: "projects", label: "Projects explained — what they personally built" },
  { id: "internship", label: "Internship / work: their actual tasks" },
  { id: "technical", label: "Technical depth for this job role" },
  { id: "communication", label: "Clear, specific answers (not vague)" },
  { id: "role_fit", label: "Fit for this job role" },
] as const;

export type ScoreCriteriaId = (typeof SCORE_CRITERIA_OPTIONS)[number]["id"];

export type ScoreConfig = {
  passScore: number;
  selected: ScoreCriteriaId[];
  notes: string;
  autoDecision: boolean;
};

export const DEFAULT_SCORE_CONFIG: ScoreConfig = {
  passScore: 7,
  selected: ["education", "projects", "communication", "role_fit"],
  notes: "",
  autoDecision: false,
};

export function parseScoreConfig(value: unknown): ScoreConfig {
  let raw: Record<string, unknown> = {};
  if (typeof value === "string" && value.trim()) {
    try {
      raw = JSON.parse(value) as Record<string, unknown>;
    } catch {
      raw = { notes: value };
    }
  } else if (value && typeof value === "object") {
    raw = value as Record<string, unknown>;
  }
  const allowed = new Set(SCORE_CRITERIA_OPTIONS.map((row) => row.id));
  const selected = Array.isArray(raw.selected)
    ? raw.selected.filter((id): id is ScoreCriteriaId => typeof id === "string" && allowed.has(id as ScoreCriteriaId))
    : DEFAULT_SCORE_CONFIG.selected;
  const pass = Math.round(Number(raw.passScore ?? DEFAULT_SCORE_CONFIG.passScore));
  return {
    passScore: Number.isFinite(pass) ? Math.min(10, Math.max(1, pass)) : DEFAULT_SCORE_CONFIG.passScore,
    selected: selected.length ? selected : DEFAULT_SCORE_CONFIG.selected,
    notes: typeof raw.notes === "string" ? raw.notes.trim() : "",
    autoDecision: raw.autoDecision === true,
  };
}

export function scoreCriteriaLines(config: ScoreConfig) {
  const labels: string[] = SCORE_CRITERIA_OPTIONS.filter((row) => config.selected.includes(row.id)).map(
    (row) => row.label,
  );
  if (config.notes) labels.push(config.notes);
  return labels;
}

export type RecruiterDecisionMark = "" | "call_again" | "next_round" | "rejected";

export function decisionFromScore(
  endReason: string,
  score: number,
  pass: number,
): RecruiterDecisionMark {
  if (endReason === "no_answer" || endReason === "failed") return "call_again";
  if (endReason === "declined" || endReason === "wrong_person") return "rejected";
  return score >= pass ? "next_round" : "rejected";
}
