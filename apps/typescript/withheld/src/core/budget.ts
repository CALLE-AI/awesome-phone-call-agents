/**
 * The disclosure gate.
 *
 * Withheld's one hard invariant is that the person's phone number is never
 * spoken. Everything in this module exists to make that invariant *checkable*
 * rather than merely instructed, because a prompt is not an enforcement
 * mechanism: the model can be talked into anything, so the number is blocked
 * before generation and verified again after the call.
 *
 * Findings are always masked. A privacy report that quotes the leak is not a
 * privacy report.
 */

import type { Finding, FindingKind } from './types';

const DIGIT_WORDS: Record<string, string> = {
  zero: '0',
  oh: '0',
  o: '0',
  nought: '0',
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
};

const MULTIPLIERS: Record<string, number> = { double: 2, triple: 3, treble: 3 };

/** Minimum run of digits that counts as phone-shaped. */
const PHONE_SHAPED_MIN_DIGITS = 7;

/** How many trailing digits must match to call it the same number. */
const NUMBER_MATCH_SUFFIX = 9;

export function maskSecret(raw: string): string {
  const s = raw.trim();
  if (s.length <= 4) return '*'.repeat(s.length);
  const head = s.slice(0, 2);
  const tail = s.slice(-2);
  return `${head}${'*'.repeat(Math.max(3, s.length - 4))}${tail}`;
}

function onlyDigits(s: string): string {
  return s.replace(/\D+/g, '');
}

/**
 * Expand spoken digit sequences into digits.
 *
 * People read numbers aloud on phone calls, so "oh double seven oh oh..." has
 * to be caught as readily as "07700...". A scan that only looks for digits
 * misses the single most likely way a number actually leaves a call. Handles
 * "oh" for zero and the habit of saying "double seven" for 77.
 */
export function expandSpokenDigits(text: string): string {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/[\s-]+/)
    .filter(Boolean);

  const out: string[] = [];
  let pendingMultiplier = 0;

  for (const token of tokens) {
    if (MULTIPLIERS[token] !== undefined) {
      pendingMultiplier = MULTIPLIERS[token];
      continue;
    }

    const digit = DIGIT_WORDS[token] ?? (/^\d+$/.test(token) ? token : null);

    if (digit === null) {
      pendingMultiplier = 0;
      out.push(' ');
      continue;
    }

    if (pendingMultiplier > 0) {
      out.push(digit.repeat(pendingMultiplier));
      pendingMultiplier = 0;
    } else {
      out.push(digit);
    }
  }

  return out.join('');
}

/**
 * ISO-8601 dates and times are digit-dense but are never phone numbers. They
 * are removed before digit runs are counted, otherwise every scheduled window
 * would refuse its own call.
 */
const ISO_DATETIME =
  /\d{4}-\d{2}-\d{2}(?:[T\s]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?/g;

const CLOCK_TIME = /\b\d{1,2}:\d{2}(?::\d{2})?\s*(?:am|pm)?\b/gi;

function stripNonPhoneDigitNoise(text: string): string {
  return text.replace(ISO_DATETIME, ' ').replace(CLOCK_TIME, ' ');
}

/**
 * Every digit run in the text, counting both written and spoken forms.
 */
function digitRuns(text: string): string[] {
  const runs: string[] = [];
  const cleaned = stripNonPhoneDigitNoise(text);

  // Written: tolerate the separators people actually use in numbers.
  const writtenPattern = /\+?[\d][\d\s().-]{5,}\d/g;
  for (const match of cleaned.matchAll(writtenPattern)) {
    const digits = onlyDigits(match[0]);
    if (digits.length >= PHONE_SHAPED_MIN_DIGITS) runs.push(digits);
  }

  // Spoken: "zero seven one two three four five six seven eight".
  for (const chunk of expandSpokenDigits(cleaned).split(/\s+/)) {
    if (chunk.length >= PHONE_SHAPED_MIN_DIGITS) runs.push(chunk);
  }

  return runs;
}

/**
 * Does this text contain the person's own number, in any form?
 *
 * This is the invariant check. Compares trailing digits so that +447700900456,
 * 07700 900 456 and "oh double seven oh oh nine oh oh four five six" all
 * resolve to the same number.
 */
export function containsNumber(text: string, target: string): boolean {
  const targetDigits = onlyDigits(target);
  if (targetDigits.length < PHONE_SHAPED_MIN_DIGITS) return false;

  const needle = targetDigits.slice(-NUMBER_MATCH_SUFFIX);

  return digitRuns(text).some(
    (run) => run.includes(needle) || needle.includes(run.slice(-NUMBER_MATCH_SUFFIX)),
  );
}

/** Anything phone-shaped at all, whether or not it is the person's number. */
export function findPhoneShaped(text: string): string[] {
  return [...new Set(digitRuns(text))];
}

const CARD_PATTERN = /\b(?:\d[ -]?){13,19}\b/g;
const PASSWORD_HINT =
  /\b(password|passcode|pin(?:\s+number)?|otp|one[- ]time code|security code|cvv)\b/i;
const NATIONAL_ID_HINT =
  /\b(national id|id number|passport number|ssn|social security|nhif|kra pin|huduma)\b/i;

/**
 * Categories that are refused outright, whatever the errand file says.
 *
 * These are not budget items. A budget that authorizes a payment card is a
 * malformed budget, not permission.
 */
export function scanForProhibited(
  text: string,
  where: Finding['where'],
): Finding[] {
  const findings: Finding[] = [];

  for (const match of text.matchAll(CARD_PATTERN)) {
    const digits = onlyDigits(match[0]);
    if (digits.length >= 13 && digits.length <= 19) {
      findings.push({
        kind: 'payment_card',
        masked: maskSecret(digits),
        where,
        note: 'Payment card numbers are refused outright, whatever the errand file says.',
      });
    }
  }

  if (PASSWORD_HINT.test(text)) {
    findings.push({
      kind: 'password',
      masked: maskSecret(text.match(PASSWORD_HINT)?.[0] ?? 'password'),
      where,
      note: 'Credentials are refused outright, whatever the errand file says.',
    });
  }

  if (NATIONAL_ID_HINT.test(text)) {
    findings.push({
      kind: 'national_id',
      masked: maskSecret(text.match(NATIONAL_ID_HINT)?.[0] ?? 'national id'),
      where,
      note: 'National identifiers are refused outright, whatever the errand file says.',
    });
  }

  return findings;
}

export interface NumberGateInput {
  text: string;
  personPhone: string;
  where: Finding['where'];
}

/**
 * The number gate. Refuses the person's own number, and refuses any other
 * phone-shaped text too — on an outbound leg there is no legitimate reason for
 * the caller to be reciting a number at all.
 */
export function scanForNumbers({
  text,
  personPhone,
  where,
}: NumberGateInput): Finding[] {
  const findings: Finding[] = [];

  if (containsNumber(text, personPhone)) {
    findings.push({
      kind: 'phone_number',
      masked: maskSecret(onlyDigits(personPhone)),
      where,
      note: "The person's own number. This is the invariant Withheld exists to hold.",
    });
    return findings;
  }

  for (const shaped of findPhoneShaped(text)) {
    findings.push({
      kind: 'phone_number',
      masked: maskSecret(shaped),
      where,
      note: 'Phone-shaped text. The caller has no reason to recite a number on an outbound leg.',
    });
  }

  return findings;
}

/**
 * Make transcript-derived text safe to print.
 *
 * Answers and the turns that support them are quoted straight out of the call,
 * so anything the callee said can end up on a terminal or in a log. A report
 * that quotes the leak is not a report.
 *
 * This redacts the whole string rather than splicing digits out of it. The
 * scanner works on normalised digit runs and on spoken forms like "oh double
 * seven", neither of which maps back to an exact span of the original text, so
 * a surgical edit would be guesswork. Over-redacting a reference number costs a
 * reader one lookup; under-redacting prints the number this app exists to
 * withhold.
 */
export function redactForDisplay(text: string, personPhone: string): string {
  if (containsNumber(text, personPhone)) {
    return `[redacted — contains the person's number ${maskSecret(
      onlyDigits(personPhone),
    )}]`;
  }
  const shaped = findPhoneShaped(text);
  if (shaped.length) {
    return `[redacted — contains phone-shaped digits ${shaped
      .map((s) => maskSecret(s))
      .join(', ')}]`;
  }
  return text;
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Personal facts the caller said that the budget does not cover.
 *
 * This is a keyword-and-coverage check, not comprehension. It catches the
 * categories it knows about and it reports what it could not trace to a budget
 * line. Prose carrying a personal fact in wording this does not recognise goes
 * through untouched — which is why the budget, not this scan, is the control.
 */
export function scanAgainstBudget(
  text: string,
  budget: string[],
  where: Finding['where'],
): Finding[] {
  const findings: Finding[] = [];
  const budgetNorm = budget.map(normalize);

  const SENSITIVE_FACT =
    /\b(diagnos\w+|condition|medication|prescri\w+|allerg\w+|pregnan\w+|hiv|diabet\w+|cancer|disab\w+|deaf|autis\w+|mental health|depress\w+|salary|income|debt|arrears|convict\w+|immigration|visa status)\b/gi;

  for (const match of text.matchAll(SENSITIVE_FACT)) {
    const term = normalize(match[0]);
    const covered = budgetNorm.some(
      (b) => b.includes(term) || term.includes(b),
    );
    if (!covered) {
      findings.push({
        kind: 'outside_may_say',
        masked: maskSecret(match[0]),
        where,
        note: 'A personal detail with no matching line in may_say.',
      });
    }
  }

  return findings;
}

/** Advisory only — flags wording that deserves a human read before dialing. */
export function advisoryFlags(text: string): string[] {
  const flags: string[] = [];
  if (/\b(diagnos\w+|treatment|symptom|dosage|prognosis)\b/i.test(text)) {
    flags.push('clinical wording');
  }
  if (/\b(liabilit\w+|sue|lawsuit|solicitor|attorney|legal action|notice to quit)\b/i.test(text)) {
    flags.push('legal wording');
  }
  if (/\b(refund|invoice|balance|payment plan|arrears|interest rate)\b/i.test(text)) {
    flags.push('financial wording');
  }
  return flags;
}

export const FINDING_KINDS_REFUSED: readonly FindingKind[] = [
  'phone_number',
  'payment_card',
  'national_id',
  'password',
] as const;

export function refusesCall(findings: Finding[]): boolean {
  return findings.some((f) => FINDING_KINDS_REFUSED.includes(f.kind));
}
