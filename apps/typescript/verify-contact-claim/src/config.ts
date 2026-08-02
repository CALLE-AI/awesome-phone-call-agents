/**
 * Claim file loading and validation.
 *
 * The order of the checks is part of the design.
 *
 * The trusted number is checked first, before anything else in the file is read.
 * It is the whole trust anchor: the number printed on the customer's own card or
 * bill. A file that carries no trusted number has nothing this app can verify
 * against. Neither does one that puts the number which contacted them in that
 * field, so it refuses there rather than getting as far as a call. Neither does one
 * where the number to dial turns up in a field describing the contact. Neither does
 * one whose `printed_on` says it was read off the message. Both of those mean the
 * number came from the thing being checked.
 *
 * Then the file is scanned for a secret somebody was asked to read out and for an
 * instruction to impersonate the customer. Both refuse.
 *
 * Then the fields are validated. A field this app does not know is refused rather
 * than ignored, because a persona under a name nobody has seen would otherwise
 * ride along quietly.
 */

import { readFileSync } from "node:fs";
import { impersonationFindings, isPersonaKey, secretFindings, withoutTimestamps } from "./scan.js";
import type { Claim, ClaimContact, ContactChannel, Policy, PolicyInput, TrustedNumber } from "./types.js";

export class ClaimError extends Error {}

const E164 = /^\+[1-9]\d{6,14}$/;
const CLAIM_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/;
const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})$/;
const LANGUAGE = /^[a-z]{2}(?:-[A-Za-z0-9]{2,8})*$/;

export const POLICY_LIMITS = {
  perCallTimeoutSeconds: { min: 60, max: 600, default: 240 },
  /**
   * The window the one question asks about. A contact event is worth checking
   * while it is fresh: four hours is the ceiling, because past that an institution
   * is answering about its whole morning rather than about one call.
   */
  recentWindowMinutes: { min: 15, max: 240, default: 60 },
  minConfidence: { min: 0, max: 1, default: 0.5 },
} as const;

export const NAME_MAX = 80;
export const SUBJECT_MAX = 80;
export const ASKED_FOR_MAX = 300;
export const SOURCE_MAX = 120;

const CHANNELS: ContactChannel[] = ["voicemail", "text_message", "missed_call", "answered_call"];

const CLAIM_KEYS = ["claim_id", "customer", "contact", "trusted_number", "policy"];
const CUSTOMER_KEYS = ["name", "callback_number"];
const CONTACT_KEYS = [
  "claimed_to_be",
  "channel",
  "arrived_at",
  "claimed_about",
  "number_shown",
  "asked_for",
];
const TRUSTED_KEYS = ["phone", "printed_on", "region"];
const POLICY_KEYS = ["per_call_timeout_seconds", "recent_window_minutes", "language", "min_confidence"];

/** Digits only, so a number written any of the ways a person writes one compares equal. */
export function digitsOf(text: string): string {
  return text.replace(/\D/g, "");
}

/**
 * Whether two numbers are the same handset.
 *
 * Somebody copying a number off a screen writes it the way it appeared, so the
 * comparison is on digits and it also compares the national form. Two spellings of
 * one number would otherwise walk straight past the first refusal.
 */
export function sameNumber(left: string, right: string): boolean {
  const one = digitsOf(left);
  const two = digitsOf(right);
  if (one.length < 7 || two.length < 7) {
    return false;
  }
  if (one === two) {
    return true;
  }
  const tail = Math.min(one.length, two.length, 10);
  return one.slice(-tail) === two.slice(-tail);
}

/**
 * Where the anchor may not have come from.
 *
 * `trusted_number.printed_on` is the only provenance this app has for the number it
 * dials. It is read back to the customer in every one of the five answers, so a file
 * that names the suspect contact as the source turns each of those answers into
 * advice to ring whoever sent the message. A search result is the same mistake by
 * another route: it is something an attacker can buy.
 *
 * This is a pattern net over one short prose field rather than a proof of
 * independence. It errs towards refusing. A note that mentions the message in
 * passing is refused too. The refusal says to write down where the number was read,
 * so the cost of being wrong here is one edit.
 */
const CONTACT_SOURCES: { pattern: RegExp; note: string }[] = [
  { pattern: /\bvoice ?mails?\b|\banswer ?phones?\b/i, note: "a voicemail" },
  { pattern: /\btexts?\b|\bsms\b|\bwhats ?app\b/i, note: "a text message" },
  { pattern: /\be-?mails?\b/i, note: "an email" },
  { pattern: /\bmessages?\b|\bnotifications?\b|\balerts?\b/i, note: "the message being checked" },
  {
    pattern:
      /\bmissed calls?\b|\bcallers? ?id\b|\bthe calls?\b|\bthe number that (?:called|rang|contacted|texted)\b|\bthe screen\b|\bthe handset\b/i,
    note: "the contact itself",
  },
  {
    pattern: /\bgoogle\b|\bsearch(?:ed|ing|es)?\b|\blinks?\b/i,
    note: "a search result or a link, which is something an attacker can buy",
  },
];

/** Digit runs long enough to be a phone number, read out of ordinary prose. */
function numbersIn(text: string): string[] {
  return withoutTimestamps(text).match(/\+?\d[\d\s().-]{5,}\d/g) ?? [];
}

/**
 * Whatever says the number about to be dialled came out of the contact being checked.
 * Null when nothing does.
 *
 * Comparing the trusted number with `contact.number_shown` catches one version of
 * that mistake and misses the commoner one. A voicemail says "ring us straight back
 * on this other number". The customer writes that number into
 * `trusted_number.phone` and the caller id into `contact.number_shown`, so the two
 * differ, the comparison passes and the app dials the scammer's callback line.
 * Wherever the number to dial also appears in a field describing the contact, the
 * file itself says where it came from, so this reads every one of those fields on
 * digits. Then `printed_on` is read, because the customer may simply have written it
 * down.
 *
 * It runs at load and again on the claim the call is about to be built from.
 */
export function sourceProblem(contact: unknown, trusted: TrustedNumber): string | null {
  const fields =
    typeof contact === "object" && contact !== null && !Array.isArray(contact)
      ? (contact as Record<string, unknown>)
      : {};
  for (const [key, value] of Object.entries(fields)) {
    if (typeof value !== "string" && typeof value !== "number") {
      continue;
    }
    for (const run of numbersIn(String(value))) {
      if (sameNumber(run, trusted.phone)) {
        return `contact.${key} carries the same number as trusted_number.phone, so the number this app would dial came out of the contact rather than off the customer's own card. A number the message supplied verifies nothing: whoever controls that line will confirm whatever is put to them. Read the number printed on the card or the bill by hand, put that in trusted_number.phone, then run this again. No call was placed.`;
      }
    }
  }
  const source = CONTACT_SOURCES.find((candidate) => candidate.pattern.test(trusted.printed_on));
  if (source !== undefined) {
    return `trusted_number.printed_on says the number was read off ${source.note}, which is the contact being checked rather than something independent of it. Checking a message by ringing a number that message supplied proves nothing. Read the number printed on the customer's own card, statement or bill, write down where it was read, then run this again. No call was placed.`;
  }
  return null;
}

function requireString(value: unknown, field: string, max = 200): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ClaimError(`${field} must be a non-empty string.`);
  }
  const text = value.trim();
  if (text.length > max) {
    throw new ClaimError(`${field} must be ${max} characters or fewer.`);
  }
  return text;
}

function requireObject(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ClaimError(`${field} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requireNumber(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ClaimError(`${field} must be a number.`);
  }
  if (value < min || value > max) {
    throw new ClaimError(`${field} must be between ${min} and ${max}. Received ${value}.`);
  }
  return value;
}

/** A field this app does not read is refused, so nothing can ride along unnoticed. */
function requireKnownKeys(value: Record<string, unknown>, allowed: string[], prefix: string): void {
  for (const key of Object.keys(value)) {
    if (allowed.includes(key)) {
      continue;
    }
    const path = prefix.length === 0 ? key : `${prefix}.${key}`;
    if (isPersonaKey(key)) {
      throw new ClaimError(
        `${path} is not a field this app reads. This app never claims to be the customer: every call opens by saying it is an automated assistant calling on behalf of a named person, so there is no persona to set. No call was placed.`,
      );
    }
    throw new ClaimError(
      `${path} is not a field this app reads. The claim file carries claim_id, customer, contact, trusted_number and policy. Nothing else is sent anywhere. No call was placed.`,
    );
  }
}

/**
 * The first refusal, run before the rest of the file is read.
 *
 * The only number this app dials is the one the customer read off their own card
 * or bill. Without it there is nothing to verify against. When the number that
 * contacted them is that same number the anchor is gone: a scam spoofing the
 * printed number would end up verifying itself.
 */
function requireTrustedNumber(raw: Record<string, unknown>): TrustedNumber {
  // A file with no trusted number at all gets the same message as one with an
  // empty number, because it is the same mistake: whoever wrote it was expecting
  // this app to work out who to call.
  const trusted = raw.trusted_number === undefined ? {} : requireObject(raw.trusted_number, "trusted_number");
  if (typeof trusted.phone !== "string" || trusted.phone.trim().length === 0) {
    throw new ClaimError(
      "trusted_number.phone must be a non-empty string. The only number this app dials is the one printed on the customer's own card or bill, so there is nothing to call without it. No call was placed.",
    );
  }
  const phone = trusted.phone.trim();
  if (!E164.test(phone)) {
    throw new ClaimError(
      `trusted_number.phone must be E.164, for example +14155550100. Received ${phone}. No call was placed.`,
    );
  }
  const contact = raw.contact;
  const shown =
    typeof contact === "object" && contact !== null
      ? (contact as Record<string, unknown>).number_shown
      : undefined;
  if (typeof shown === "string" && sameNumber(shown, phone)) {
    throw new ClaimError(
      `The number that contacted the customer is the same number as trusted_number.phone, so there is nothing left to verify against: a message spoofing the printed number would be checked by calling itself. Read the number printed on the card or the bill by hand, put that in trusted_number.phone, then run this again. No call was placed.`,
    );
  }
  const anchor: TrustedNumber = {
    phone,
    printed_on: requireString(trusted.printed_on, "trusted_number.printed_on", SOURCE_MAX),
    ...(trusted.region === undefined ? {} : { region: requireString(trusted.region, "trusted_number.region", 8) }),
  };
  // The same number written another way is the loudest case and it has its own
  // message above. This is every other way the file can say the number came out of
  // the contact rather than off the card.
  const source = sourceProblem(contact, anchor);
  if (source !== null) {
    throw new ClaimError(source);
  }
  return anchor;
}

/** The second refusal and the third, both read off the whole file. */
function refuseSecretsAndPersonas(raw: Record<string, unknown>, knownNumbers: string[]): void {
  const secret = secretFindings(raw, { knownNumbers })[0];
  if (secret !== undefined) {
    throw new ClaimError(
      `${secret.field} carries what looks like a ${secret.kind} (${secret.masked}). This app never repeats what the caller asked for: the call says who the customer is, who the message claimed to be from and what it was about, nothing else. Take it out of the claim file and keep it to yourself. No call was placed.`,
    );
  }
  const persona = impersonationFindings(raw)[0];
  if (persona !== undefined) {
    if (persona.masked === "**" && persona.kind === "a persona for the caller") {
      throw new ClaimError(
        `${persona.field} is not a field this app reads. This app never claims to be the customer: every call opens by saying it is an automated assistant calling on behalf of a named person, so there is no persona to set. No call was placed.`,
      );
    }
    throw new ClaimError(
      `${persona.field} carries ${persona.kind}. It never claims to be the customer: every call opens by saying it is an automated assistant calling on behalf of a named person, it cannot answer security questions and it says so on the line. No call was placed.`,
    );
  }
}

function resolvePolicy(input: unknown): Policy {
  const policy = input === undefined ? {} : (requireObject(input, "policy") as PolicyInput);
  requireKnownKeys(policy as Record<string, unknown>, POLICY_KEYS, "policy");
  const language = policy.language === undefined ? "en-US" : requireString(policy.language, "policy.language", 12);
  if (!LANGUAGE.test(language)) {
    throw new ClaimError(`policy.language must be a BCP 47 tag such as en-US. Received ${language}.`);
  }
  return {
    perCallTimeoutSeconds:
      policy.per_call_timeout_seconds === undefined
        ? POLICY_LIMITS.perCallTimeoutSeconds.default
        : requireNumber(
            policy.per_call_timeout_seconds,
            "policy.per_call_timeout_seconds",
            POLICY_LIMITS.perCallTimeoutSeconds.min,
            POLICY_LIMITS.perCallTimeoutSeconds.max,
          ),
    recentWindowMinutes:
      policy.recent_window_minutes === undefined
        ? POLICY_LIMITS.recentWindowMinutes.default
        : requireNumber(
            policy.recent_window_minutes,
            "policy.recent_window_minutes",
            POLICY_LIMITS.recentWindowMinutes.min,
            POLICY_LIMITS.recentWindowMinutes.max,
          ),
    language,
    minConfidence:
      policy.min_confidence === undefined
        ? POLICY_LIMITS.minConfidence.default
        : requireNumber(
            policy.min_confidence,
            "policy.min_confidence",
            POLICY_LIMITS.minConfidence.min,
            POLICY_LIMITS.minConfidence.max,
          ),
  };
}

function validateContact(value: unknown): ClaimContact {
  const raw = requireObject(value, "contact");
  requireKnownKeys(raw, CONTACT_KEYS, "contact");
  const channel = raw.channel;
  if (typeof channel !== "string" || !CHANNELS.includes(channel as ContactChannel)) {
    throw new ClaimError(
      `contact.channel must be one of ${CHANNELS.join(", ")}. Received ${String(channel)}.`,
    );
  }
  const arrivedAt = requireString(raw.arrived_at, "contact.arrived_at", 40);
  if (!ISO_WITH_OFFSET.test(arrivedAt) || !Number.isFinite(Date.parse(arrivedAt))) {
    throw new ClaimError(
      `contact.arrived_at must be ISO 8601 with an offset, for example 2026-07-31T09:12:00-07:00. Received ${arrivedAt}.`,
    );
  }
  const numberShown = requireString(raw.number_shown, "contact.number_shown", 40);
  if (digitsOf(numberShown).length < 7) {
    throw new ClaimError(
      `contact.number_shown must hold the digits the handset showed, at least seven of them. Received ${numberShown}.`,
    );
  }
  return {
    claimed_to_be: requireString(raw.claimed_to_be, "contact.claimed_to_be", NAME_MAX),
    channel: channel as ContactChannel,
    arrived_at: arrivedAt,
    claimed_about: requireString(raw.claimed_about, "contact.claimed_about", SUBJECT_MAX),
    number_shown: numberShown,
    asked_for: requireString(raw.asked_for, "contact.asked_for", ASKED_FOR_MAX),
  };
}

export function parseClaim(input: unknown): Claim {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new ClaimError("The claim file must contain a JSON object.");
  }
  const raw = input as Record<string, unknown>;

  // First, because it is the trust anchor. Then the two scans, because they read
  // the whole file. Only then the fields.
  const trustedNumber = requireTrustedNumber(raw);
  const contactRaw = typeof raw.contact === "object" && raw.contact !== null ? (raw.contact as Record<string, unknown>) : {};
  const shown = typeof contactRaw.number_shown === "string" ? contactRaw.number_shown : "";
  const customerRaw = typeof raw.customer === "object" && raw.customer !== null ? (raw.customer as Record<string, unknown>) : {};
  // The customer's own number is theirs, given out on the call so the institution
  // can reach a person rather than this machine, so it is not a secret to refuse.
  const callback = typeof customerRaw.callback_number === "string" ? customerRaw.callback_number : "";
  refuseSecretsAndPersonas(raw, [trustedNumber.phone, shown, callback].filter((value) => value.length > 0));

  requireKnownKeys(raw, CLAIM_KEYS, "");
  const claimId = requireString(raw.claim_id, "claim_id", 64);
  if (!CLAIM_ID.test(claimId)) {
    throw new ClaimError(
      "claim_id must be 3 to 64 characters of letters, digits, dot, dash or underscore. It travels into the provider idempotency key.",
    );
  }
  const customer = requireObject(raw.customer, "customer");
  requireKnownKeys(customer, CUSTOMER_KEYS, "customer");
  if (customer.callback_number !== undefined) {
    const callbackNumber = requireString(customer.callback_number, "customer.callback_number", 20);
    if (!E164.test(callbackNumber)) {
      throw new ClaimError(
        `customer.callback_number must be E.164, for example +14155550199. Received ${callbackNumber}.`,
      );
    }
  }
  const trusted = requireObject(raw.trusted_number, "trusted_number");
  requireKnownKeys(trusted, TRUSTED_KEYS, "trusted_number");

  return {
    claimId,
    customer: {
      name: requireString(customer.name, "customer.name", NAME_MAX),
      ...(customer.callback_number === undefined
        ? {}
        : { callback_number: String(customer.callback_number).trim() }),
    },
    contact: validateContact(raw.contact),
    trustedNumber,
    policy: resolvePolicy(raw.policy),
  };
}

export function loadClaim(path: string): Claim {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    throw new ClaimError(`Cannot read claim file ${path}: ${(error as Error).message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new ClaimError(`Claim file ${path} is not valid JSON: ${(error as Error).message}`);
  }
  return parseClaim(parsed);
}
