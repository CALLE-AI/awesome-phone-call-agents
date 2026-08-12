import { readFile } from "node:fs/promises";
import type { DonorPledge, DriveRequest, PickupSlot, StorageMode } from "./types.js";

const CONTROL_OR_BIDI = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;
const E164 = /^\+[1-9]\d{7,14}$/;
const KEBAB_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DRIVE_ID = /^drive-[a-f0-9]{12}$/;
const PLEDGE_REF = /^[A-Z][A-Z0-9-]{2,31}$/;
const SAFE_NOUN = /^[A-Za-z][A-Za-z &'-]{0,59}$/;
const PROMPT_LIKE = /\b(?:ignore|override|bypass|system prompt|developer message|instruction|secret|password|token|api key|call|text|email|pay|buy|transfer)\b/i;
const STORAGE = new Set<StorageMode>(["ambient", "chilled", "frozen"]);

export class RequestError extends Error {}

function object(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new RequestError(`${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function onlyKeys(value: Record<string, unknown>, path: string, allowed: readonly string[]): void {
  const allow = new Set(allowed);
  const unexpected = Object.keys(value).filter((key) => !allow.has(key));
  if (unexpected.length > 0) {
    throw new RequestError(`${path} contains unsupported field(s): ${unexpected.join(", ")}.`);
  }
}

function text(value: unknown, path: string, max = 120): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > max) {
    throw new RequestError(`${path} must be a non-empty string of at most ${max} characters.`);
  }
  if (CONTROL_OR_BIDI.test(value)) throw new RequestError(`${path} contains control or bidirectional characters.`);
  return value.trim();
}

function safeNoun(value: unknown, path: string): string {
  const result = text(value, path, 60);
  if (!SAFE_NOUN.test(result) || PROMPT_LIKE.test(result) || result.split(/\s+/u).length > 8) {
    throw new RequestError(`${path} must be a short hand-authored English noun phrase, not an instruction or sensitive value.`);
  }
  return result;
}

function iso(value: unknown, path: string): string {
  const result = text(value, path, 40);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(result) || Number.isNaN(Date.parse(result))) {
    throw new RequestError(`${path} must be an ISO 8601 UTC timestamp ending in Z.`);
  }
  return result;
}

function positiveInteger(value: unknown, path: string, max: number): number {
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > max) {
    throw new RequestError(`${path} must be an integer from 1 through ${max}.`);
  }
  return value as number;
}

function pickupSlot(value: unknown, index: number): PickupSlot {
  const raw = object(value, `pickup_slots[${index}]`);
  onlyKeys(raw, `pickup_slots[${index}]`, ["id", "starts_at", "ends_at"]);
  const id = text(raw.id, `pickup_slots[${index}].id`, 40);
  if (!KEBAB_ID.test(id)) throw new RequestError(`pickup_slots[${index}].id must be lowercase kebab-case.`);
  const startsAt = iso(raw.starts_at, `pickup_slots[${index}].starts_at`);
  const endsAt = iso(raw.ends_at, `pickup_slots[${index}].ends_at`);
  if (Date.parse(startsAt) >= Date.parse(endsAt) || Date.parse(endsAt) - Date.parse(startsAt) > 4 * 60 * 60 * 1000) {
    throw new RequestError(`pickup_slots[${index}] must end after it starts and last no more than four hours.`);
  }
  return { id, starts_at: startsAt, ends_at: endsAt };
}

function donor(value: unknown, index: number): DonorPledge {
  const raw = object(value, `donors[${index}]`);
  onlyKeys(raw, `donors[${index}]`, [
    "id", "display_name", "phone", "region", "locale", "pledge_ref", "food_category",
    "expected_units", "unit_name", "expected_storage_mode", "automated_call_opt_in_confirmed",
    "opt_in_recorded_at", "opt_in_valid_until",
  ]);
  const id = text(raw.id, `donors[${index}].id`, 60);
  if (!KEBAB_ID.test(id)) throw new RequestError(`donors[${index}].id must be lowercase kebab-case.`);
  const phone = text(raw.phone, `donors[${index}].phone`, 20);
  if (!E164.test(phone)) throw new RequestError(`donors[${index}].phone must be an E.164 number.`);
  const region = text(raw.region, `donors[${index}].region`, 2).toUpperCase();
  if (!/^[A-Z]{2}$/.test(region)) throw new RequestError(`donors[${index}].region must be a two-letter country code.`);
  const locale = text(raw.locale, `donors[${index}].locale`, 16);
  if (!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(locale)) throw new RequestError(`donors[${index}].locale must be a BCP 47-style language tag.`);
  const pledgeRef = text(raw.pledge_ref, `donors[${index}].pledge_ref`, 32);
  if (!PLEDGE_REF.test(pledgeRef)) throw new RequestError(`donors[${index}].pledge_ref must be a non-sensitive uppercase reference token.`);
  if (raw.automated_call_opt_in_confirmed !== true) {
    throw new RequestError(`donors[${index}].automated_call_opt_in_confirmed must be true for this specific drive.`);
  }
  const storage = text(raw.expected_storage_mode, `donors[${index}].expected_storage_mode`, 16) as StorageMode;
  if (!STORAGE.has(storage)) throw new RequestError(`donors[${index}].expected_storage_mode must be ambient, chilled, or frozen.`);
  return {
    id,
    display_name: safeNoun(raw.display_name, `donors[${index}].display_name`),
    phone,
    region,
    locale,
    pledge_ref: pledgeRef,
    food_category: safeNoun(raw.food_category, `donors[${index}].food_category`),
    expected_units: positiveInteger(raw.expected_units, `donors[${index}].expected_units`, 500),
    unit_name: safeNoun(raw.unit_name, `donors[${index}].unit_name`),
    expected_storage_mode: storage as DonorPledge["expected_storage_mode"],
    automated_call_opt_in_confirmed: true,
    opt_in_recorded_at: iso(raw.opt_in_recorded_at, `donors[${index}].opt_in_recorded_at`),
    opt_in_valid_until: iso(raw.opt_in_valid_until, `donors[${index}].opt_in_valid_until`),
  };
}

export function parseDriveRequest(value: unknown): DriveRequest {
  const root = object(value, "request");
  const policy = object(root.policy, "policy");
  onlyKeys(root, "request", ["drive_id", "operator_has_authorized_calls", "operator_authorized_at", "authorization_valid_until", "donors", "pickup_slots", "policy"]);
  onlyKeys(policy, "policy", ["max_calls", "do_not_leave_voicemail", "require_ai_disclosure", "require_human_dispatch_review", "call_window_start", "call_window_end"]);

  const driveId = text(root.drive_id, "drive_id", 40);
  if (!DRIVE_ID.test(driveId)) throw new RequestError("drive_id must be drive- followed by 12 lowercase hexadecimal characters.");
  if (root.operator_has_authorized_calls !== true) throw new RequestError("operator_has_authorized_calls must be true.");
  if (policy.do_not_leave_voicemail !== true) throw new RequestError("policy.do_not_leave_voicemail must be true.");
  if (policy.require_ai_disclosure !== true) throw new RequestError("policy.require_ai_disclosure must be true.");
  if (policy.require_human_dispatch_review !== true) throw new RequestError("policy.require_human_dispatch_review must be true.");
  if (!Array.isArray(root.donors) || root.donors.length < 1 || root.donors.length > 6) {
    throw new RequestError("donors must contain one to six opted-in recipients.");
  }
  if (!Array.isArray(root.pickup_slots) || root.pickup_slots.length < 1 || root.pickup_slots.length > 4) {
    throw new RequestError("pickup_slots must contain one to four choices.");
  }
  const donors = root.donors.map(donor);
  const pickupSlots = root.pickup_slots.map(pickupSlot);
  if (new Set(donors.map((entry) => entry.id)).size !== donors.length) throw new RequestError("donor ids must be unique.");
  if (new Set(donors.map((entry) => entry.phone)).size !== donors.length) throw new RequestError("donor phone numbers must be unique.");
  if (new Set(donors.map((entry) => entry.pledge_ref)).size !== donors.length) throw new RequestError("pledge references must be unique.");
  if (new Set(pickupSlots.map((entry) => entry.id)).size !== pickupSlots.length) throw new RequestError("pickup slot ids must be unique.");

  const operatorAuthorizedAt = iso(root.operator_authorized_at, "operator_authorized_at");
  const authorizationValidUntil = iso(root.authorization_valid_until, "authorization_valid_until");
  const callWindowStart = iso(policy.call_window_start, "policy.call_window_start");
  const callWindowEnd = iso(policy.call_window_end, "policy.call_window_end");
  if (Date.parse(callWindowStart) >= Date.parse(callWindowEnd) || Date.parse(callWindowEnd) - Date.parse(callWindowStart) > 2 * 60 * 60 * 1000) {
    throw new RequestError("The live call window must end after it starts and be no longer than two hours.");
  }
  for (const [index, slot] of pickupSlots.entries()) {
    if (Date.parse(slot.starts_at) < Date.parse(callWindowEnd)) {
      throw new RequestError(`pickup_slots[${index}] must start at or after the call window ends.`);
    }
    if (Date.parse(slot.ends_at) - Date.parse(callWindowEnd) > 7 * 24 * 60 * 60 * 1000) {
      throw new RequestError(`pickup_slots[${index}] must end within seven days of the call window.`);
    }
  }
  if (Date.parse(operatorAuthorizedAt) > Date.parse(callWindowStart) || Date.parse(callWindowEnd) - Date.parse(operatorAuthorizedAt) > 24 * 60 * 60 * 1000) {
    throw new RequestError("Operator authorization must be recorded no more than 24 hours before the call window ends.");
  }
  if (Date.parse(authorizationValidUntil) < Date.parse(callWindowEnd)) throw new RequestError("authorization_valid_until must cover the call window.");
  for (const [index, entry] of donors.entries()) {
    if (Date.parse(entry.opt_in_recorded_at) > Date.parse(callWindowStart) || Date.parse(callWindowEnd) - Date.parse(entry.opt_in_recorded_at) > 7 * 24 * 60 * 60 * 1000) {
      throw new RequestError(`donors[${index}] opt-in must be recorded no more than seven days before the call window ends.`);
    }
    if (Date.parse(entry.opt_in_valid_until) < Date.parse(callWindowEnd)) throw new RequestError(`donors[${index}] opt-in must cover the call window.`);
  }
  const maxCalls = positiveInteger(policy.max_calls, "policy.max_calls", donors.length);
  return {
    drive_id: driveId,
    operator_has_authorized_calls: true,
    operator_authorized_at: operatorAuthorizedAt,
    authorization_valid_until: authorizationValidUntil,
    donors,
    pickup_slots: pickupSlots,
    policy: {
      max_calls: maxCalls,
      do_not_leave_voicemail: true,
      require_ai_disclosure: true,
      require_human_dispatch_review: true,
      call_window_start: callWindowStart,
      call_window_end: callWindowEnd,
    },
  };
}

export function assertLiveWindow(request: DriveRequest, now = new Date()): void {
  const nowMs = now.getTime();
  const windowEnd = Date.parse(request.policy.call_window_end);
  if (nowMs < Date.parse(request.policy.call_window_start) || nowMs >= windowEnd) {
    throw new RequestError("Current time is outside the approved live call window; no call was placed.");
  }
  if (windowEnd - nowMs < 10 * 60 * 1000) throw new RequestError("At least ten minutes must remain before another call can be created.");
  if (nowMs > Date.parse(request.authorization_valid_until) || nowMs - Date.parse(request.operator_authorized_at) > 24 * 60 * 60 * 1000) {
    throw new RequestError("Operator authorization is expired or stale; no call was placed.");
  }
  for (const donor of request.donors.slice(0, request.policy.max_calls)) {
    if (nowMs > Date.parse(donor.opt_in_valid_until) || nowMs - Date.parse(donor.opt_in_recorded_at) > 7 * 24 * 60 * 60 * 1000) {
      throw new RequestError(`Recorded automated-call opt-in for ${donor.id} is expired or stale; no call was placed.`);
    }
  }
}

export async function readDriveRequest(path: string): Promise<DriveRequest> {
  return parseDriveRequest(JSON.parse(await readFile(path, "utf8")) as unknown);
}
