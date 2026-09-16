/**
 * Guardrails enforced in code, not just prompted.
 *
 * The analyzer is asked to obey these rules, but obeying them is checked here —
 * a clarification that fails is dropped, never softened.
 */
import type { ApplicationInput, Clarification, ClarificationSource } from "./types";

export const MAX_CLARIFICATIONS = 3;

/**
 * Personal attributes that are never legitimate call material, whether they
 * appear in the candidate's own words or in a question we would ask.
 */
const ALWAYS_SENSITIVE: RegExp[] = [
  /\bage\b/i,
  /\bhow old\b/i,
  /\byears? old\b/i,
  /\bdate of birth\b/i,
  /\bbirth ?day\b/i,
  /\bnationality\b/i,
  /\bcitizenship\b/i,
  /\bcitizen of\b/i,
  /\bcountry of origin\b/i,
  /\bimmigration\b/i,
  /\bgreen card\b/i,
  /\bvisa\b/i,
  /\bwork (?:permit|authorization)\b/i,
  /\bmarital status\b/i,
  /\bmarried\b/i,
  /\bspouse\b/i,
  /\bpregnan\w*/i,
  /\bmaternity\b/i,
  /\bpaternity\b/i,
  /\bsexual orientation\b/i,
  /\bethnicity\b/i,
  /\bracial\b/i,
  /\bcriminal record\b/i,
];

/**
 * Words that are protected attributes when we ask about them, but ordinary
 * domain vocabulary when a candidate writes them ("health tech", "family of
 * products", "gender-inclusive design"). Screened on the question and probes
 * only — the side Clarity actually speaks aloud.
 */
const ASK_ONLY_SENSITIVE: RegExp[] = [
  /\bhealth\b/i,
  /\bmedical\b/i,
  /\bdisabilit\w*/i,
  /\bdisabled\b/i,
  /\billness\b/i,
  /\breligio\w*/i,
  /\bchurch\b/i,
  /\bgender\b/i,
  /\bethnic\b/i,
  /\bfamily\b/i,
  /\bchildren\b/i,
  /\bkids\b/i,
  /\bpolitical\b/i,
  /\bsponsorship\b/i,
];

/** Returns the matched pattern's source when an item is off-limits. */
export function findSensitive(item: {
  claim: string;
  question: string;
  probes: string[];
}): string | null {
  const asked = [item.question, ...item.probes].join(" ");
  const everything = `${item.claim} ${asked}`;

  for (const re of ALWAYS_SENSITIVE) {
    if (re.test(everything)) return re.source;
  }
  for (const re of ASK_ONLY_SENSITIVE) {
    if (re.test(asked)) return re.source;
  }
  return null;
}

/**
 * Locates `claim` inside the submitted text, tolerating whitespace and
 * quote-character drift, and returns the ORIGINAL span so the UI shows exactly
 * what the candidate wrote. Null when the claim was not actually written.
 */
export function findVerbatim(
  claim: string,
  application: ApplicationInput,
): { source: ClarificationSource; text: string } | null {
  const sources: Array<[ClarificationSource, string]> = [
    ["resume", application.resume],
    ["answers", application.answers],
  ];

  const pattern = verbatimPattern(claim);
  if (!pattern) return null;

  for (const [source, text] of sources) {
    const match = normalizeQuotes(text).match(pattern);
    if (match && match.index !== undefined) {
      // Slice from the ORIGINAL text: quote normalization is 1:1 on length.
      return { source, text: text.slice(match.index, match.index + match[0].length) };
    }
  }
  return null;
}

/** Whitespace-tolerant literal matcher for the claim. */
function verbatimPattern(claim: string): RegExp | null {
  const trimmed = normalizeQuotes(claim).trim();
  if (trimmed.length < 8) return null; // too short to be a meaningful anchor
  const body = trimmed
    .split(/\s+/)
    .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s+");
  return new RegExp(body, "i");
}

/** Curly quotes and dashes to their ASCII equivalents, preserving length. */
function normalizeQuotes(text: string): string {
  return text
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-");
}

export type GuardrailOutcome = {
  kept: Clarification[];
  rejected: Array<{ claim: string; reason: "not-verbatim" | "sensitive-attribute" | "over-cap" }>;
};

/** Applies every guardrail in order and reports what was dropped and why. */
export function applyGuardrails(
  proposed: Array<Omit<Clarification, "id" | "source"> & { id?: string; source?: ClarificationSource }>,
  application: ApplicationInput,
): GuardrailOutcome {
  const kept: Clarification[] = [];
  const rejected: GuardrailOutcome["rejected"] = [];

  for (const item of proposed) {
    const sensitive = findSensitive(item);
    if (sensitive) {
      rejected.push({ claim: item.claim, reason: "sensitive-attribute" });
      continue;
    }

    const anchored = findVerbatim(item.claim, application);
    if (!anchored) {
      rejected.push({ claim: item.claim, reason: "not-verbatim" });
      continue;
    }

    if (kept.length >= MAX_CLARIFICATIONS) {
      rejected.push({ claim: item.claim, reason: "over-cap" });
      continue;
    }

    kept.push({
      id: `c${kept.length + 1}`,
      claim: anchored.text,
      topic: item.topic,
      need: item.need,
      source: anchored.source,
      whyItMatters: item.whyItMatters,
      question: item.question,
      probes: item.probes.slice(0, 3),
      extract: item.extract.slice(0, 5),
    });
  }

  return { kept, rejected };
}
