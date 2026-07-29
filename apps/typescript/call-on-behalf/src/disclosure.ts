/**
 * The disclosure budget.
 *
 * A person delegating a phone call is handing over the right to say things about
 * themselves. This module makes that grant explicit and then checks both ends of
 * it: the script is checked before the call for a detail nobody authorized, and
 * what the caller actually said is checked after the call for the same thing.
 *
 * Detection is pattern based, so it is a safety net and not a proof. It catches
 * the realistic mistakes: a date of birth pasted into a question, an account
 * number left in a note, a caller that volunteers an identifier it was given for
 * a different field. It cannot catch a detail that looks like ordinary prose.
 */

import type { DisclosureFinding, DisclosureItem } from "./types.js";

interface Detector {
  kind: string;
  pattern: RegExp;
  /** `block` refuses the call. `warn` is reported and left to the person. */
  severity: "block" | "warn";
}

/**
 * Specific detectors run first. A token is claimed by the first detector that
 * matches it, so `123-45-6789` is a national identifier rather than a long
 * number and `2026-08-12` is a date rather than either.
 */
const DETECTORS: Detector[] = [
  { kind: "email address", severity: "block", pattern: /[\w.+-]+@[\w-]+\.[\w.]{2,}/g },
  { kind: "national identifier", severity: "block", pattern: /\b\d{3}-\d{2}-\d{4}\b/g },
  { kind: "identifier", severity: "block", pattern: /\b[A-Z]{2,4}-?\d{4,}\b/g },
  {
    kind: "street address",
    severity: "block",
    pattern:
      /\b\d{1,5}\s+[A-Z][A-Za-z]*(?:\s+[A-Z][A-Za-z]*)*\s+(?:Street|St|Avenue|Ave|Road|Rd|Lane|Ln|Drive|Dr|Boulevard|Blvd|Court|Ct|Way)\b/g,
  },
  { kind: "date", severity: "warn", pattern: /\b\d{4}-\d{2}-\d{2}\b/g },
  { kind: "date", severity: "warn", pattern: /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g },
  { kind: "long number", severity: "block", pattern: /\b\d[\d\s-]{5,}\d\b/g },
];

/** Digits and letters only, so "PT 88213" and "pt-88213" compare equal. */
function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function mask(token: string): string {
  const trimmed = token.trim();
  if (trimmed.length <= 2) {
    return "**";
  }
  return `${trimmed.slice(0, 2)}${"*".repeat(Math.min(trimmed.length - 2, 8))}`;
}

/**
 * Details this app will not read out loud whatever the request file says.
 *
 * A payment card, a card verification value, a password or a national identifier
 * has no place in a delegated errand. Refusing them in code is worth more than
 * documenting that you should not put them there.
 */
const FORBIDDEN_KEYS = [
  "card",
  "cvv",
  "cvc",
  "pin",
  "password",
  "passcode",
  "secret",
  "ssn",
  "social security",
  "sort code",
  "routing",
  "iban",
  "account number",
];

function luhnValid(digits: string): boolean {
  if (digits.length < 13 || digits.length > 19) {
    return false;
  }
  let sum = 0;
  let double = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let value = Number(digits[index]);
    if (double) {
      value *= 2;
      if (value > 9) {
        value -= 9;
      }
    }
    sum += value;
    double = !double;
  }
  return sum % 10 === 0;
}

/** Why an item must not be disclosed or null when it is fine. */
export function forbiddenDisclosure(item: DisclosureItem): string | null {
  const haystack = `${item.key} ${item.label}`.toLowerCase();
  for (const term of FORBIDDEN_KEYS) {
    if (haystack.includes(term)) {
      return `${item.key} looks like a ${term}. This app will not read that out on a call.`;
    }
  }
  if (luhnValid(item.value.replace(/\D/g, ""))) {
    return `${item.key} looks like a payment card number. This app will not read that out on a call.`;
  }
  return null;
}

/**
 * Whether the budget covers a token.
 *
 * A token inside an authorized value is covered, so "88213" out of "PT 88213" is
 * fine. An authorized value inside a longer token is covered only when it makes
 * up most of that token, so a name does not quietly authorize an email address
 * built from it.
 */
function covered(token: string, authorized: string[]): boolean {
  return authorized.some(
    (value) =>
      value.includes(token) || (token.includes(value) && value.length >= Math.ceil(token.length * 0.6)),
  );
}

/** Everything in the text that looks like a personal detail the budget does not cover. */
export function unauthorizedFindings(
  text: string,
  budget: DisclosureItem[],
  where: string,
): DisclosureFinding[] {
  const authorized = budget.map((item) => normalize(item.value)).filter((value) => value.length > 0);
  const findings: DisclosureFinding[] = [];
  const claimed: [number, number][] = [];
  const seen = new Set<string>();

  for (const detector of DETECTORS) {
    for (const match of text.matchAll(detector.pattern)) {
      const token = match[0];
      const start = match.index ?? 0;
      const end = start + token.length;
      if (claimed.some(([from, to]) => start < to && end > from)) {
        continue;
      }
      const normalized = normalize(token);
      if (normalized.length === 0) {
        continue;
      }
      claimed.push([start, end]);
      if (covered(normalized, authorized)) {
        continue;
      }
      const key = `${detector.kind}:${normalized}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      findings.push({ kind: detector.kind, masked: mask(token), where, severity: detector.severity });
    }
  }
  return findings;
}

/** Findings that stop a call. A bare date is reported, an identifier is refused. */
export function blocking(findings: DisclosureFinding[]): DisclosureFinding[] {
  return findings.filter((finding) => finding.severity === "block");
}

/** Which budget items were actually spoken by the caller, by label. */
export function spokenItems(botText: string, budget: DisclosureItem[]): DisclosureItem[] {
  const spoken = normalize(botText);
  return budget.filter((item) => {
    const value = normalize(item.value);
    return value.length > 0 && spoken.includes(value);
  });
}

/**
 * A phone number is not a disclosure finding when it is the number being called
 * or a number the person put in the budget, so the checks strip those first. The
 * national form is stripped too, because that is how people say a number out loud.
 */
export function withoutKnownNumbers(text: string, numbers: string[]): string {
  let output = text;
  const candidates = new Set<string>();
  for (const number of numbers) {
    const digits = number.replace(/\D/g, "");
    for (const candidate of [digits, digits.slice(-10), digits.slice(-7)]) {
      if (candidate.length >= 7) {
        candidates.add(candidate);
      }
    }
  }
  for (const candidate of [...candidates].sort((left, right) => right.length - left.length)) {
    const loose = candidate.split("").join("[^0-9]{0,2}");
    output = output.replace(new RegExp(`\\+?${loose}`, "g"), "[known number]");
  }
  return output;
}
