/**
 * The scan that runs over the whole claim file before anything is dialled.
 *
 * Two of the three refusals live here.
 *
 * Nothing the caller asked for is ever repeated, so the file is searched for the
 * things a scam wants read out loud: card numbers, account numbers, one time
 * codes, PINs, passwords, dates of birth and national identifiers. A hit refuses
 * the whole run and names the field, because the customer is the only person who
 * can take it out.
 *
 * The app never claims to be the customer, so the file is also searched for an
 * instruction to do it. A field that sets a persona is refused by name and an
 * instruction buried in prose is refused by the words it used.
 *
 * Two rules keep the scan honest.
 *
 * It looks for values, not for subject matter. Somebody writing down what a scam
 * asked them for has to be able to say "they wanted my card number" without this
 * app refusing to help. "They wanted 4111 1111 1111 1111" is the one that refuses.
 *
 * Detection is pattern based, so it is a safety net rather than a proof. It
 * catches the realistic mistakes: a number pasted in from a text message, a code
 * copied out of an app, a persona written into a field. It cannot catch a secret
 * that looks like ordinary prose.
 */

import type { ScanFinding } from "./types.js";

export interface ScanContext {
  /** Numbers the file is allowed to carry: the trusted one and the one shown. */
  knownNumbers?: string[];
}

/**
 * Field names that are a place to put a secret, whatever they happen to hold.
 *
 * The claim file has no field for any of these, so a key that matches is somebody
 * adding one. Refusing on the name as well as the value means an empty
 * `card_number` field is still a refusal: the next edit fills it in.
 */
const SECRET_KEYS: { kind: string; pattern: RegExp }[] = [
  { kind: "card number", pattern: /card|(?:^|_)pan(?:_|$)|cvv|cvc/i },
  { kind: "PIN", pattern: /(?:^|_)pins?(?:_|$)/i },
  { kind: "password", pattern: /pass(?:word|phrase)|(?:^|_)secret(?:_|$)|credential/i },
  { kind: "one time code", pattern: /one[_-]?time|(?:^|_)otps?(?:_|$)|passcode|(?:^|_)codes?(?:_|$)|verification/i },
  { kind: "account or card number", pattern: /account|iban|sort[_-]?code|routing|(?:^|_)bsb(?:_|$)/i },
  { kind: "date of birth", pattern: /birth|(?:^|_)dob(?:_|$)/i },
  { kind: "national identifier", pattern: /ssn|social[_-]?security|national[_-]?id|passport|(?:^|_)nino(?:_|$)/i },
];

/** Digits only, so "PT 88213" and "pt-88213" compare equal. */
function digitsOf(text: string): string {
  return text.replace(/\D/g, "");
}

function mask(token: string): string {
  const trimmed = token.trim();
  if (trimmed.length <= 2) {
    return "**";
  }
  return `${trimmed.slice(0, 2)}${"*".repeat(Math.min(trimmed.length - 2, 8))}`;
}

/** Payment card check digit, ISO/IEC 7812 Annex B. */
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

/**
 * Remove the numbers the file is entitled to carry.
 *
 * The trusted number and the number that was shown are both in the claim file on
 * purpose, so neither is a finding. The national form goes too, because that is
 * how people write a number down. The idea is lifted from the disclosure budget in
 * `apps/typescript/call-on-behalf`.
 */
export function withoutKnownNumbers(text: string, numbers: string[]): string {
  let output = text;
  const candidates = new Set<string>();
  for (const number of numbers) {
    const digits = digitsOf(number);
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

/** A timestamp is not an account number, so it is taken out before digits are read. */
export function withoutTimestamps(text: string): string {
  return text.replace(
    /\d{4}-\d{2}-\d{2}(?:[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?/g,
    "[timestamp]",
  );
}

/** Detectors that read a value, most specific first. */
const VALUE_DETECTORS: { kind: string; pattern: RegExp }[] = [
  { kind: "national identifier", pattern: /\b\d{3}-\d{2}-\d{4}\b/g },
  {
    kind: "date of birth",
    pattern:
      /\b(?:born|date of birth|d\.?o\.?b\.?)\b[^.]{0,24}?(?:\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}\s+[A-Za-z]+\s+\d{4})/gi,
  },
  {
    kind: "one time code",
    pattern:
      /\b(?:one[\s-]?time (?:code|passcode|password)|otp|verification code|security code|passcode|code)\b[^0-9]{0,24}\d{4,8}\b/gi,
  },
  { kind: "PIN", pattern: /\bpins?\b[^0-9]{0,24}\d{3,8}\b/gi },
];

/** A token that follows the word password and looks like one rather than like prose. */
const PASSWORD_VALUE = /\bpass(?:word|phrase|code)\b\s*(?:is|was|=|:)?\s*(\S{4,})/gi;
const CREDENTIAL_LOOKING = /^(?=.*[A-Za-z])(?=.*\d)[\w!@#$%^&*+.-]{6,}$/;

/** Instructions that ask this app to be the customer rather than to call for them. */
const IMPERSONATION: { pattern: RegExp; note: string }[] = [
  { pattern: /\b(?:say|tell (?:them|him|her)|claim|state)\b[^.]{0,24}\byou (?:are|were)\b/i, note: "say you are" },
  { pattern: /\bpretend(?:ing)? (?:to be|you are)\b/i, note: "pretend to be" },
  { pattern: /\bact(?:ing)? as\b/i, note: "act as" },
  { pattern: /\bauthenticat(?:e|ing)\b[^.]{0,24}\bas\b/i, note: "authenticate as" },
  { pattern: /\bpass (?:the )?security\b/i, note: "pass security" },
  { pattern: /\bimpersonat(?:e|ing|ion)\b/i, note: "impersonate" },
  { pattern: /\byou are (?:me|the (?:customer|account holder|cardholder|member|patient))\b/i, note: "you are the customer" },
  { pattern: /\bverify (?:my|the customer'?s) identity\b/i, note: "verify my identity" },
];

/**
 * Field names that only make sense as a persona.
 *
 * Matched on the exact name, so a field this app has never heard of falls to the
 * loader's own refusal instead of being guessed at here.
 */
const PERSONA_KEYS = new Set([
  "persona",
  "caller_persona",
  "voice_persona",
  "speak_as",
  "identify_as",
  "identity",
  "caller_identity",
  "caller_name",
  "pretend_to_be",
  "claim_to_be",
  "impersonate",
  "act_as",
  "authenticate_as",
  "voice",
]);

export function isPersonaKey(key: string): boolean {
  return PERSONA_KEYS.has(key.toLowerCase());
}

type KeyVisitor = (path: string, key: string) => void;
type ValueVisitor = (path: string, value: string) => void;

/** Every key and every scalar in the file, by path. Numbers count: a card number pasted as JSON is still one. */
function walk(value: unknown, path: string, onKey: KeyVisitor, onValue: ValueVisitor): void {
  if (typeof value === "string") {
    onValue(path, value);
    return;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    onValue(path, String(value));
    return;
  }
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      walk(item, `${path}[${index}]`, onKey, onValue);
    }
    return;
  }
  if (typeof value === "object" && value !== null) {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      const next = path.length === 0 ? key : `${path}.${key}`;
      onKey(next, key);
      walk(item, next, onKey, onValue);
    }
  }
}

/** Everything in the file that looks like a secret somebody was asked to read out. */
export function secretFindings(claim: unknown, context: ScanContext = {}): ScanFinding[] {
  const findings: ScanFinding[] = [];
  const known = context.knownNumbers ?? [];
  walk(
    claim,
    "",
    (path, key) => {
      for (const detector of SECRET_KEYS) {
        if (detector.pattern.test(key)) {
          findings.push({ field: path, kind: detector.kind, masked: "**" });
          return;
        }
      }
    },
    (path, value) => {
      for (const detector of VALUE_DETECTORS) {
        const match = new RegExp(detector.pattern.source, detector.pattern.flags).exec(value);
        if (match !== null) {
          findings.push({ field: path, kind: detector.kind, masked: mask(match[0]) });
          return;
        }
      }
      for (const match of value.matchAll(PASSWORD_VALUE)) {
        const token = match[1] ?? "";
        const explicit = /\b(?:is|was|=|:)\s*$/.test(match[0].slice(0, match[0].length - token.length));
        if (explicit || CREDENTIAL_LOOKING.test(token)) {
          findings.push({ field: path, kind: "password", masked: mask(token) });
          return;
        }
      }
      // Numbers last, because a national identifier, a code or a PIN is a better
      // description of the same digits than "a long number" is.
      const digits = withoutTimestamps(withoutKnownNumbers(value, known));
      for (const run of digits.match(/\+?\d[\d\s().-]{5,}\d/g) ?? []) {
        const bare = digitsOf(run);
        if (luhnValid(bare)) {
          findings.push({ field: path, kind: "card number", masked: mask(bare) });
          return;
        }
        if (bare.length >= 7) {
          findings.push({ field: path, kind: "account or card number", masked: mask(bare) });
          return;
        }
      }
    },
  );
  return findings;
}

/** Anything in the file that asks this app to be the customer. */
export function impersonationFindings(claim: unknown): ScanFinding[] {
  const findings: ScanFinding[] = [];
  walk(
    claim,
    "",
    (path, key) => {
      if (isPersonaKey(key)) {
        findings.push({ field: path, kind: "a persona for the caller", masked: "**" });
      }
    },
    (path, value) => {
      for (const rule of IMPERSONATION) {
        if (rule.pattern.test(value)) {
          findings.push({ field: path, kind: `an instruction to impersonate ("${rule.note}")`, masked: "**" });
          return;
        }
      }
    },
  );
  return findings;
}
