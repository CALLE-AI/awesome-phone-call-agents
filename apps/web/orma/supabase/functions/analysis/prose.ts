/**
 * T7.2 pattern report prose. Gemini phrases the weekly report from the T7.1
 * facts object alone. It receives no transcripts and no ability to count.
 * Every numeric token in the prose is machine-checked against the facts
 * before the prose may be returned. Invalid prose is regenerated, never
 * warned about and never stored.
 *
 * Pin with:
 * `deno test --allow-read --allow-env supabase/functions/analysis/prose.ts supabase/functions/analysis/prose_tests.ts`
 */
import {
  extractCandidateText,
  vertexGenerate,
  type VertexGenerateDeps,
} from "../_shared/vertex.ts";

export type PatternProseDeps = VertexGenerateDeps;

const maxAttempts = 3;

// One alternative per token class, tried in order. An ISO date counts as one
// token, a clock time counts as one token, and the last alternative covers
// integers, decimals and thousands-separated numbers.
const numericToken = /\d{4}-\d{2}-\d{2}|\d{1,2}:\d{2}|\d[\d,]*(?:\.\d+)?/g;

const isoDateToken = /^\d{4}-\d{2}-\d{2}$/;
const clockTimeToken = /^\d{1,2}:\d{2}$/;

type FactsAllowlist = {
  dates: Set<string>;
  times: Set<string>;
  numbers: Set<number>;
  texts: Set<string>;
};

export function patternProseDepsFromEnv(
  getEnv: (key: string) => string | undefined = (key) => Deno.env.get(key),
  fetchImpl: typeof fetch = fetch,
): PatternProseDeps {
  return {
    project: requireNamedEnv("GOOGLE_VERTEX_PROJECT", getEnv),
    location: requireNamedEnv("GOOGLE_VERTEX_LOCATION", getEnv),
    model: requireNamedEnv("GEMINI_MODEL", getEnv),
    credentialsJson: requireNamedEnv("GOOGLE_APPLICATION_CREDENTIALS_JSON", getEnv),
    fetch: fetchImpl,
  };
}

function requireNamedEnv(
  name: string,
  getEnv: (key: string) => string | undefined,
): string {
  const value = getEnv(name);
  if (!value) throw new Error(`missing ${name}`);
  return value;
}

/**
 * Return every numeric token in the prose that no fact value explains. The
 * allowlist takes numeric fact values, the period boundaries and slot local
 * times. A digit run from item text explains a token only while the complete
 * source text appears in the prose, so a text number cannot float free as a
 * quantity. Identifier digits never join it, so a uuid echoed into the
 * prose reads as invented.
 */
export function numbersOutsideFacts(prose: string, facts: unknown): string[] {
  const allowlist = allowlistFromFacts(facts);
  const normalizedProse = normalizeText(prose);
  const outside: string[] = [];
  for (const match of prose.matchAll(numericToken)) {
    if (!tokenAllowed(match[0], allowlist, normalizedProse)) outside.push(match[0]);
  }
  return outside;
}

function tokenAllowed(
  token: string,
  allowlist: FactsAllowlist,
  normalizedProse: string,
): boolean {
  if (isoDateToken.test(token)) return allowlist.dates.has(token);
  if (clockTimeToken.test(token)) return allowlist.times.has(token);
  if (allowlist.numbers.has(Number(token.replace(/,/g, "")))) return true;
  return textRunAllowed(token, allowlist, normalizedProse);
}

// A text digit run explains a prose token only while the complete source
// text appears in the prose. Matching folds case and collapses whitespace,
// and the digits stay part of the comparison.
function textRunAllowed(
  token: string,
  allowlist: FactsAllowlist,
  normalizedProse: string,
): boolean {
  for (const text of allowlist.texts) {
    if (!normalizedProse.includes(text)) continue;
    for (const run of text.matchAll(/\d+/g)) {
      if (run[0] === token) return true;
    }
  }
  return false;
}

// Fold case and collapse whitespace for source text matching. Digits are
// never stripped.
function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function allowlistFromFacts(facts: unknown): FactsAllowlist {
  const allowlist: FactsAllowlist = {
    dates: new Set<string>(),
    times: new Set<string>(),
    numbers: new Set<number>(),
    texts: new Set<string>(),
  };
  collectFactValue(facts, undefined, allowlist);
  return allowlist;
}

function collectFactValue(
  value: unknown,
  key: string | undefined,
  into: FactsAllowlist,
): void {
  if (typeof value === "number") {
    if (Number.isFinite(value)) into.numbers.add(value);
    return;
  }
  if (typeof value === "string") {
    if (key === "period_start" || key === "period_end") into.dates.add(value);
    else if (key === "local_time") into.times.add(value);
    else if (key === "text") into.texts.add(normalizeText(value));
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectFactValue(item, key, into);
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [childKey, childValue] of Object.entries(value)) {
      collectFactValue(childValue, childKey, into);
    }
  }
}

/**
 * Phrase the report from the facts alone. Every candidate that carries an
 * invented number, or no text at all, consumes one of three attempts. An
 * exhausted run throws instead of returning unvalidated prose.
 */
export async function generatePatternProse(
  facts: unknown,
  deps: PatternProseDeps,
): Promise<string> {
  const prompt = buildProsePrompt(facts);
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const response = await vertexGenerate(deps, {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0 },
    });
    const prose = extractCandidateText(response).trim();
    if (prose === "") continue;
    if (numbersOutsideFacts(prose, facts).length === 0) return prose;
  }
  throw new Error("pattern prose failed number validation");
}

function buildProsePrompt(facts: unknown): string {
  return [
    "Write a short weekly pattern report from the JSON facts object below.",
    "The facts are the only source of truth.",
    "Rules:",
    "1. Write every number as a numeral copied from the facts object.",
    "2. Never compute, convert, round or infer a number. Leave out any number the facts do not carry.",
    "3. Never mention transcripts, phone calls or recordings.",
    "4. Keep the report short enough to finish reading in one minute.",
    "Facts:",
    JSON.stringify(facts),
  ].join("\n");
}
