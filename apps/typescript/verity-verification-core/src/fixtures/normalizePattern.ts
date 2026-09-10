// src/fixtures/normalizePattern.ts — PII-strip transcript windows into matchers, and
// validate that nothing raw leaked (SECURITY §5, PRD §8, TESTING §4.2).
// Placeholders: <NAME> <PHONE> <DATE> <TIME>. Also derives a "skeleton" — the ordered
// list of <TIME>/<DATE>/<NAME>/<PHONE>/<CORRECTION> tokens — used for matching.

const MONTHS =
  "january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec";
const WEEKDAYS = "monday|tuesday|wednesday|thursday|friday|saturday|sunday";
const NUMWORDS = "one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve";
const STOP = new Set(
  `${WEEKDAYS}|${MONTHS}|yes|no|okay|ok|the|a|an|and|to|at|on|for|i|you|it|is|that|this|reply|confirm|change|thanks|thank|hi|hello|bye|goodbye|please|would|like|move|book|reschedule|appointment|haircut|color|trim|works|good|better`
    .split("|"),
);

export interface NormalizedPattern {
  pattern: string;
  kind: "token_sequence";
}

/** Replace PII with placeholders. Names heuristic: capitalized mid-sentence non-stopwords. */
export function normalizePattern(text: string): NormalizedPattern {
  let s = ` ${text} `;

  // phones
  s = s.replace(/\+\d{7,15}\b/g, " <PHONE> ");
  // ISO / numeric / month-name dates
  s = s.replace(/\b\d{4}-\d{2}-\d{2}\b/g, " <DATE> ");
  s = s.replace(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g, " <DATE> ");
  s = s.replace(new RegExp(`\\b(?:${MONTHS})\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?\\b`, "gi"), " <DATE> ");
  // times
  s = s.replace(/\b\d{1,2}:\d{2}\s*(?:a\.?m\.?|p\.?m\.?)?/gi, " <TIME> ");
  s = s.replace(/\b\d{1,2}\s*(?:a\.?m\.?|p\.?m\.?)\b/gi, " <TIME> ");
  s = s.replace(new RegExp(`\\b(?:${NUMWORDS}|\\d{1,2})[- ]?(?:o'?clock|thirty|fifteen|forty-?five)\\b`, "gi"), " <TIME> ");
  s = s.replace(/\b(?:at|by|make it|makes it|do|say|to)\s+(?:\d{1,2})\b(?!\s*(?:st|nd|rd|th|:))/gi, " <TIME> ");
  s = s.replace(/\bnoon\b|\bmidnight\b/gi, " <TIME> ");

  // names: capitalized words not at the start of a sentence, not stopwords/placeholders
  s = s.replace(/(^|[.!?]\s+|\s)([A-Z][a-z]+)(?=\s|[.,!?])/g, (_m, pre: string, word: string) => {
    if (STOP.has(word.toLowerCase()) || word.startsWith("<")) return `${pre}${word}`;
    return `${pre}<NAME>`;
  });
  // collapse runs
  s = s.replace(/(?:<NAME>\s*){2,}/g, "<NAME> ");
  s = s.replace(/\s+/g, " ").trim();

  return { pattern: s, kind: "token_sequence" };
}

const CORRECTION_RE = /\b(no wait|scratch that|actually|make it|sorry,? i meant|change that to)\b/gi;

/** Ordered token skeleton: <TIME>/<DATE>/<NAME>/<PHONE> plus one <CORRECTION> per cue run. */
export function skeleton(pattern: string): string[] {
  const marked = pattern.replace(CORRECTION_RE, " <CORRECTION> ");
  const toks: string[] = [];
  for (const m of marked.matchAll(/<TIME>|<DATE>|<NAME>|<PHONE>|<CORRECTION>/g)) {
    const t = m[0];
    if (t === "<CORRECTION>" && toks[toks.length - 1] === "<CORRECTION>") continue; // collapse runs
    toks.push(t);
  }
  return toks;
}

export class PatternValidationError extends Error {}

/** Reject a pattern that still contains a raw name, E.164, or calendar date (SECURITY §5). */
export function assertPatternPiiClean(pattern: string): void {
  if (/\+\d{7,15}/.test(pattern)) throw new PatternValidationError("pattern contains a raw phone number");
  if (/\b\d{4}-\d{2}-\d{2}\b/.test(pattern)) throw new PatternValidationError("pattern contains a raw ISO date");
  if (new RegExp(`\\b(?:${MONTHS})\\.?\\s+\\d{1,2}`, "i").test(pattern))
    throw new PatternValidationError("pattern contains a raw calendar date");
  // any remaining Capitalized mid-token word that is not a placeholder / stopword-ish
  for (const m of pattern.matchAll(/(?<=\s)([A-Z][a-z]{2,})(?=\s|[.,!?]|$)/g)) {
    const w = m[1]!.toLowerCase();
    if (!STOP.has(w) && !/^(reply|thursday|tuesday|wednesday|monday|friday|saturday|sunday)$/i.test(m[1]!)) {
      throw new PatternValidationError(`pattern may still contain a raw name: "${m[1]}"`);
    }
  }
}
