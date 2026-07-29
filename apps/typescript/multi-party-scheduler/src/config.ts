/**
 * Request file loading and validation.
 *
 * Nothing is inferred. A missing timezone, a phone number that is not E.164, an
 * offset that disagrees with the declared zone or a slot list too long to read
 * out loud is an error, not a default.
 */

import { readFileSync } from "node:fs";
import { MAX_SLOTS, parseSlots, SlotError } from "./slots.js";
import type {
  CoordinationRequest,
  MeetingInput,
  Party,
  PartyInput,
  Policy,
  PolicyInput,
} from "./types.js";

export class ConfigError extends Error {}

const E164 = /^\+[1-9]\d{6,14}$/;
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/;

export const POLICY_LIMITS = {
  windowMinutes: { min: 5, max: 180, default: 45 },
  perCallTimeoutSeconds: { min: 60, max: 600, default: 240 },
  maxCalls: { min: 2, max: 40, default: 12 },
  minConfidence: { min: 0, max: 1, default: 0.5 },
} as const;

export const PURPOSE_MAX = 120;
export const MIN_PARTIES = 2;
export const MAX_PARTIES = 6;

function requireString(value: unknown, field: string, max = 200): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ConfigError(`${field} must be a non-empty string.`);
  }
  const text = value.trim();
  if (text.length > max) {
    throw new ConfigError(`${field} must be ${max} characters or fewer.`);
  }
  return text;
}

function requireNumber(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new ConfigError(`${field} must be a number.`);
  }
  if (value < min || value > max) {
    throw new ConfigError(`${field} must be between ${min} and ${max}. Received ${value}.`);
  }
  return value;
}

function resolvePolicy(input: PolicyInput | undefined): Policy {
  const policy = input ?? {};
  const windowMinutes =
    policy.window_minutes === undefined
      ? POLICY_LIMITS.windowMinutes.default
      : requireNumber(policy.window_minutes, "policy.window_minutes", POLICY_LIMITS.windowMinutes.min, POLICY_LIMITS.windowMinutes.max);
  const perCallTimeoutSeconds =
    policy.per_call_timeout_seconds === undefined
      ? POLICY_LIMITS.perCallTimeoutSeconds.default
      : requireNumber(policy.per_call_timeout_seconds, "policy.per_call_timeout_seconds", POLICY_LIMITS.perCallTimeoutSeconds.min, POLICY_LIMITS.perCallTimeoutSeconds.max);
  const maxCalls =
    policy.max_calls === undefined
      ? POLICY_LIMITS.maxCalls.default
      : requireNumber(policy.max_calls, "policy.max_calls", POLICY_LIMITS.maxCalls.min, POLICY_LIMITS.maxCalls.max);
  const minConfidence =
    policy.min_confidence === undefined
      ? POLICY_LIMITS.minConfidence.default
      : requireNumber(policy.min_confidence, "policy.min_confidence", POLICY_LIMITS.minConfidence.min, POLICY_LIMITS.minConfidence.max);
  return { windowMinutes, perCallTimeoutSeconds, maxCalls, minConfidence };
}

function validateParty(value: unknown, index: number): Party {
  if (typeof value !== "object" || value === null) {
    throw new ConfigError(`parties[${index}] must be an object.`);
  }
  const raw = value as Record<string, unknown>;
  const phone = requireString(raw.phone, `parties[${index}].phone`);
  if (!E164.test(phone)) {
    throw new ConfigError(
      `parties[${index}].phone must be E.164, for example +14155550100. Received ${phone}.`,
    );
  }
  const party: Party = {
    id: requireString(raw.id, `parties[${index}].id`, 40),
    name: requireString(raw.name, `parties[${index}].name`, 60),
    phone,
    role: requireString(raw.role, `parties[${index}].role`, 60),
  };
  if (raw.region !== undefined) {
    party.region = requireString(raw.region, `parties[${index}].region`, 8);
  }
  if (raw.locale !== undefined) {
    party.locale = requireString(raw.locale, `parties[${index}].locale`, 12);
  }
  return party;
}

function validateMeeting(value: unknown): MeetingInput {
  if (typeof value !== "object" || value === null) {
    throw new ConfigError("meeting must be an object.");
  }
  const raw = value as Record<string, unknown>;
  return {
    purpose: requireString(raw.purpose, "meeting.purpose", PURPOSE_MAX),
    location: requireString(raw.location, "meeting.location", 120),
    timezone: requireString(raw.timezone, "meeting.timezone", 64),
    organizer: requireString(raw.organizer, "meeting.organizer", 60),
    duration_minutes: requireNumber(raw.duration_minutes, "meeting.duration_minutes", 5, 480),
  };
}

export function parseRequest(input: unknown): CoordinationRequest {
  if (typeof input !== "object" || input === null) {
    throw new ConfigError("The request file must contain a JSON object.");
  }
  const raw = input as Record<string, unknown>;
  const requestId = requireString(raw.request_id, "request_id", 64);
  if (!REQUEST_ID.test(requestId)) {
    throw new ConfigError(
      "request_id must be 3 to 64 characters of letters, digits, dot, dash or underscore.",
    );
  }
  const meeting = validateMeeting(raw.meeting);

  let slots;
  try {
    slots = parseSlots((raw.slots ?? []) as never, meeting.timezone);
  } catch (error) {
    if (error instanceof SlotError) {
      throw new ConfigError(error.message);
    }
    throw error;
  }

  if (!Array.isArray(raw.parties)) {
    throw new ConfigError("parties must be an array.");
  }
  if (raw.parties.length < MIN_PARTIES || raw.parties.length > MAX_PARTIES) {
    throw new ConfigError(
      `parties must list between ${MIN_PARTIES} and ${MAX_PARTIES} people. One party needs a call, not a protocol.`,
    );
  }
  const parties = (raw.parties as PartyInput[]).map((party, index) => validateParty(party, index));
  if (new Set(parties.map((party) => party.id)).size !== parties.length) {
    throw new ConfigError("parties must have unique ids.");
  }
  if (new Set(parties.map((party) => party.phone)).size !== parties.length) {
    throw new ConfigError("parties must have unique phone numbers.");
  }
  const policy = resolvePolicy(raw.policy as PolicyInput | undefined);
  const request: CoordinationRequest = {
    requestId,
    meeting,
    slots,
    // Call order is the order in the request file. Put the least flexible
    // person first: the sooner the feasible set narrows, the shorter every
    // later call is.
    parties,
    policy,
  };

  const worst = worstCaseCalls(request);
  if (worst > policy.maxCalls) {
    throw new ConfigError(
      `policy.max_calls is ${policy.maxCalls} but this request can need ${worst} calls (${parties.length} to gather, ${parties.length} to confirm, ${parties.length - 1} to release). Raise the budget or drop a party.`,
    );
  }
  return request;
}

/** Gather everyone, confirm everyone, then release everyone who had confirmed. */
export function worstCaseCalls(request: CoordinationRequest): number {
  const parties = request.parties.length;
  return parties * 2 + Math.max(parties - 1, 0);
}

export function loadRequest(path: string): CoordinationRequest {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    throw new ConfigError(`Cannot read request file ${path}: ${(error as Error).message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new ConfigError(`Request file ${path} is not valid JSON: ${(error as Error).message}`);
  }
  return parseRequest(parsed);
}

export { MAX_SLOTS };
