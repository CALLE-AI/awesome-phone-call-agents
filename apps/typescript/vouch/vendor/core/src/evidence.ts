/**
 * Link structured_result fields to transcript spans.
 * CALL-E returns evidence[] as natural-language justifications,
 * not offsets — scoring a field against user turns is our job.
 *
 * Source: docs/build-plan.md §2.4.
 */

export type TranscriptTurn = {
  offset_seconds?: number;
  speaker: "bot" | "user" | string;
  text: string;
};

export type LinkedField = {
  field: string;
  value: unknown;
  turn: TranscriptTurn | null;
  score: number;
  supported: boolean;
};

export type EvidenceLinkInput = {
  structuredResult: Record<string, unknown>;
  evidence?: string[];
  turns: TranscriptTurn[];
  threshold?: number;
};

const CLAIMS: Record<string, Record<string, string>> = {
  safety_status: {
    safe: "safe",
    needs_assistance: "assistance",
    medical_emergency: "breathe emergency",
  },
  evacuation: {
    sheltering_in_place: "sheltering staying",
    evacuated: "evacuated left",
    trapped: "trapped blocked",
  },
  has_power: {
    yes: "electricity",
    no: "power out",
  },
  has_water: {
    yes: "water",
    no: "no water",
  },
  medication: {
    none_needed: "nobody medication",
    running_low: "running low",
    out: "out medication",
  },
  household: {
    all_accounted: "everyone all",
    partial: "partial",
  },
  needs_human: {
    no: "okay",
    yes: "help",
  },
  employment_confirmed: {
    yes: "employed works here",
    no: "not employed never worked",
  },
  eligible_for_rehire: {
    yes: "eligible rehire",
    no: "not eligible",
    policy_no_comment: "policy comment",
  },
  verifier_authority: {
    yes: "authorized confirm employment",
    no: "third-party service can't transfer",
  },
  refusal_reason: {
    third_party_only: "third-party service",
    policy: "policy",
    wrong_department: "wrong department",
    needs_written_request: "written request",
  },
};

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1);
}

function overlapScore(claim: string, turn: string): number {
  const claimTokens = new Set(tokenize(claim));
  const turnTokens = tokenize(turn);
  if (claimTokens.size === 0 || turnTokens.length === 0) return 0;
  const hits = new Set(turnTokens.filter((token) => claimTokens.has(token)));
  return hits.size / claimTokens.size;
}

function isHonestUnknown(value: unknown): boolean {
  return value == null || value === "unknown";
}

function claimForField(field: string, value: unknown): string {
  const valueText = String(value);
  return CLAIMS[field]?.[valueText] ?? `${field.replaceAll("_", " ")} ${valueText}`;
}

export function linkEvidence(input: EvidenceLinkInput): LinkedField[] {
  const threshold = input.threshold ?? 0.49;
  const userTurns = input.turns.filter((turn) => turn.speaker === "user");
  void input.evidence;

  return Object.entries(input.structuredResult).map(([field, value]) => {
    if (isHonestUnknown(value)) {
      return { field, value, turn: null, score: 1, supported: true };
    }

    const claim = claimForField(field, value);
    let best: { turn: TranscriptTurn; score: number } | null = null;
    for (const turn of userTurns) {
      const score = overlapScore(claim, turn.text);
      if (!best || score > best.score) best = { turn, score };
    }
    const score = best?.score ?? 0;
    return {
      field,
      value,
      turn: best && score >= threshold ? best.turn : null,
      score,
      supported: score >= threshold,
    };
  });
}
