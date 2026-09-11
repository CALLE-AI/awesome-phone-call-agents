import { readFile } from "node:fs/promises";
import { isIP } from "node:net";
import type { SearchLocation, SearchRequest } from "./types.js";

export class RequestError extends Error {}

const E164 = /^\+[1-9]\d{7,14}$/;
const SEARCH_ID = /^search-[a-f0-9]{12}$/;
const LOCATION_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CONTROL_OR_BIDI = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;
const SENSITIVE = [
  /\b(?:password|passcode|pin|bank account|credit card|debit card|passport|social security|national id|driver'?s license|date of birth|claim secret|proof code|callback number|home address|medical record|diagnosis|prescription|emergency)\b/i,
  /\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/,
  /\+[1-9]\d{7,14}\b/,
  /\b(?:\(?\d{2,4}\)?[ .-]*){2,}\d{2,4}\b/,
  /\b\d{3}-\d{2}-\d{4}\b/,
  /\b(?:\d[ -]*?){13,19}\b/,
];
const PROMPT_INJECTION = [
  /\b(?:ignore|disregard|override|bypass)\b.{0,48}\b(?:instructions?|prompts?|rules?|polic(?:y|ies)|system|developer)\b/i,
  /\b(?:system|developer)\s+(?:message|prompt)\b/i,
  /\b(?:jailbreak|tool call|execute command|reveal secret)\b/i,
  /^(?:please\s+)?(?:tell|ask|instruct|call|contact|claim|provide|collect|retrieve|reserve|request|disclose|share|send|pay|buy|arrange|ignore|override|bypass)\b/i,
  /\b(?:tell|ask|instruct)\b.{0,48}\b(?:desk|recipient|agent|caller)\b.{0,48}\b(?:reserve|request|disclose|send|pay|call)\b/i,
];
const OUT_OF_SCOPE_ITEM = /\b(?:weapon|firearm|gun|handgun|rifle|knife|ammunition|explosive|controlled substance|illegal drug|medicine|medication|insulin|medical device|passport|identity document|driver'?s license|credit card|debit card|bank card|cash|emergency|missing person)\b/i;
const SAFE_ITEM_PHRASE = /^[A-Za-z][A-Za-z '-]{1,79}$/;

function onlyKeys(value: Record<string, unknown>, path: string, allowed: readonly string[]): void {
  const allowedSet = new Set(allowed);
  const unexpected = Object.keys(value).filter((key) => !allowedSet.has(key));
  if (unexpected.length > 0) {
    throw new RequestError(`${path} contains unsupported field(s): ${unexpected.join(", ")}. Unknown fields are refused rather than silently ignored.`);
  }
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new RequestError(`${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function scalar(value: unknown, path: string, max = 160): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > max) {
    throw new RequestError(`${path} must be a non-empty string of at most ${max} characters.`);
  }
  if (CONTROL_OR_BIDI.test(value)) {
    throw new RequestError(`${path} contains a control, newline, or bidirectional formatting character.`);
  }
  return value.trim();
}

function prose(value: unknown, path: string, max = 160): string {
  const result = scalar(value, path, max);
  if (SENSITIVE.some((pattern) => pattern.test(result))) {
    throw new RequestError(`${path} appears to contain sensitive or out-of-scope information. Use observable item details only.`);
  }
  if (PROMPT_INJECTION.some((pattern) => pattern.test(result))) {
    throw new RequestError(`${path} looks like an instruction rather than an observable item fact.`);
  }
  return result;
}

function itemProse(value: unknown, path: string, max = 80): string {
  const result = prose(value, path, max);
  if (OUT_OF_SCOPE_ITEM.test(result)) {
    throw new RequestError(`${path} is medical, financial, identity-related, dangerous, emergency-related, or otherwise out of scope for automated calls.`);
  }
  if (!SAFE_ITEM_PHRASE.test(result) || result.split(/\s+/u).length > 12) {
    throw new RequestError(`${path} must be a short hand-authored English noun phrase using ASCII letters, spaces, apostrophes, or hyphens only.`);
  }
  return result;
}

function observableFeature(value: unknown, path: string): string {
  return itemProse(value, path, 80);
}

function iso(value: unknown, path: string): string {
  const result = scalar(value, path, 40);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(result) || Number.isNaN(Date.parse(result))) {
    throw new RequestError(`${path} must be an ISO 8601 UTC timestamp ending in Z.`);
  }
  return result;
}

function publicSource(value: unknown, path: string): string {
  const result = scalar(value, path, 300);
  let url: URL;
  try {
    url = new URL(result);
  } catch {
    throw new RequestError(`${path} must be a public HTTPS URL.`);
  }
  if (
    url.protocol !== "https:"
    || url.username !== ""
    || url.password !== ""
    || url.search !== ""
    || url.hash !== ""
    || (url.port !== "" && url.port !== "443")
  ) {
    throw new RequestError(`${path} must be a credential-free public HTTPS URL without a query or fragment.`);
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".local") || isIP(hostname) !== 0) {
    throw new RequestError(`${path} must use a public DNS hostname, not localhost, a local name, or an IP literal.`);
  }
  return url.toString();
}

function location(value: unknown, index: number): SearchLocation {
  const item = record(value, `locations[${index}]`);
  onlyKeys(item, `locations[${index}]`, ["id", "display_name", "phone", "published_source", "published_contact_confirmed", "published_contact_verified_at", "calling_hours_confirmed", "region", "locale"]);
  const id = scalar(item.id, `locations[${index}].id`, 60);
  if (!LOCATION_ID.test(id)) {
    throw new RequestError(`locations[${index}].id must be a lowercase kebab-case identifier.`);
  }
  const phone = scalar(item.phone, `locations[${index}].phone`, 20);
  if (!E164.test(phone)) {
    throw new RequestError(`locations[${index}].phone must be an E.164 phone number.`);
  }
  if (item.published_contact_confirmed !== true) {
    throw new RequestError(`locations[${index}].published_contact_confirmed must be true after a person compares the full phone number with the official source.`);
  }
  if (item.calling_hours_confirmed !== true) {
    throw new RequestError(`locations[${index}].calling_hours_confirmed must be true after a person confirms that the approved live window falls within published calling hours.`);
  }
  const region = scalar(item.region, `locations[${index}].region`, 2).toUpperCase();
  if (!/^[A-Z]{2}$/.test(region)) {
    throw new RequestError(`locations[${index}].region must be a two-letter uppercase country code.`);
  }
  const locale = scalar(item.locale, `locations[${index}].locale`, 16);
  if (!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(locale)) {
    throw new RequestError(`locations[${index}].locale must be a BCP 47-style language tag.`);
  }
  return {
    id,
    display_name: prose(item.display_name, `locations[${index}].display_name`, 100),
    phone,
    published_source: publicSource(item.published_source, `locations[${index}].published_source`),
    published_contact_confirmed: true,
    published_contact_verified_at: iso(item.published_contact_verified_at, `locations[${index}].published_contact_verified_at`),
    calling_hours_confirmed: true,
    region,
    locale,
  };
}

export function parseSearchRequest(value: unknown): SearchRequest {
  const root = record(value, "request");
  const item = record(root.item, "item");
  const policy = record(root.policy, "policy");
  onlyKeys(root, "request", ["search_id", "owner_has_authorized_search", "owner_authorized_at", "authorization_valid_until", "claim_verification_detail_withheld", "item", "locations", "policy"]);
  onlyKeys(item, "item", ["category", "color", "brand", "distinctive_features", "lost_after", "lost_before"]);
  onlyKeys(policy, "policy", ["max_calls", "do_not_leave_voicemail", "stop_after_strong_match", "call_window_start", "call_window_end"]);
  const searchId = scalar(root.search_id, "search_id", 40);
  if (!SEARCH_ID.test(searchId)) {
    throw new RequestError("search_id must be an opaque identifier in the form search- followed by 12 lowercase hexadecimal characters.");
  }
  if (root.owner_has_authorized_search !== true) {
    throw new RequestError("owner_has_authorized_search must be true before any location can be called.");
  }
  if (root.claim_verification_detail_withheld !== true) {
    throw new RequestError("claim_verification_detail_withheld must be true; keep a separate proof detail out of this request and the automated call.");
  }
  if (!Array.isArray(item.distinctive_features) || item.distinctive_features.length < 2 || item.distinctive_features.length > 5) {
    throw new RequestError("item.distinctive_features must contain two to five observable, non-secret features.");
  }
  const distinctiveFeatures = item.distinctive_features.map((entry, index) => observableFeature(entry, `item.distinctive_features[${index}]`));
  const normalizedFeatures = distinctiveFeatures.map((feature) => feature.normalize("NFKC").toLowerCase().replace(/\s+/gu, " "));
  if (new Set(normalizedFeatures).size !== normalizedFeatures.length) {
    throw new RequestError("item.distinctive_features must be meaningfully distinct; duplicates cannot count as separate evidence.");
  }
  const lostAfter = iso(item.lost_after, "item.lost_after");
  const lostBefore = iso(item.lost_before, "item.lost_before");
  if (Date.parse(lostAfter) > Date.parse(lostBefore)) {
    throw new RequestError("item.lost_after must not be later than item.lost_before.");
  }
  const category = itemProse(item.category, "item.category", 80);
  if (!Array.isArray(root.locations) || root.locations.length < 1 || root.locations.length > 6) {
    throw new RequestError("locations must contain one to six published business contacts.");
  }
  const locations = root.locations.map(location);
  if (new Set(locations.map((entry) => entry.id)).size !== locations.length) {
    throw new RequestError("location ids must be unique.");
  }
  if (new Set(locations.map((entry) => entry.phone)).size !== locations.length) {
    throw new RequestError("location phone numbers must be unique to prevent duplicate calls.");
  }
  const maxCalls = policy.max_calls;
  if (!Number.isInteger(maxCalls) || (maxCalls as number) < 1 || (maxCalls as number) > locations.length) {
    throw new RequestError("policy.max_calls must be an integer from 1 through the number of locations.");
  }
  if (policy.do_not_leave_voicemail !== true) {
    throw new RequestError("policy.do_not_leave_voicemail must be true; this workflow never leaves item details on voicemail.");
  }
  if (policy.stop_after_strong_match !== true) {
    throw new RequestError("policy.stop_after_strong_match must be true so later destinations are not called after a credible candidate is found.");
  }
  const callWindowStart = iso(policy.call_window_start, "policy.call_window_start");
  const callWindowEnd = iso(policy.call_window_end, "policy.call_window_end");
  if (Date.parse(callWindowStart) >= Date.parse(callWindowEnd) || Date.parse(callWindowEnd) - Date.parse(callWindowStart) > 60 * 60 * 1000) {
    throw new RequestError("The live call window must end after it starts and be no longer than 60 minutes.");
  }
  const authorizationValidUntil = iso(root.authorization_valid_until, "authorization_valid_until");
  const ownerAuthorizedAt = iso(root.owner_authorized_at, "owner_authorized_at");
  if (Date.parse(ownerAuthorizedAt) > Date.parse(callWindowStart)) {
    throw new RequestError("owner_authorized_at must be at or before the approved live call window.");
  }
  if (Date.parse(callWindowEnd) - Date.parse(ownerAuthorizedAt) > 24 * 60 * 60 * 1000) {
    throw new RequestError("Owner authorization must be recorded no more than 24 hours before the end of the live call window.");
  }
  if (Date.parse(callWindowEnd) > Date.parse(authorizationValidUntil)) {
    throw new RequestError("authorization_valid_until must cover the entire live call window.");
  }
  return {
    search_id: searchId,
    owner_has_authorized_search: true,
    owner_authorized_at: ownerAuthorizedAt,
    authorization_valid_until: authorizationValidUntil,
    claim_verification_detail_withheld: true,
    item: {
      category,
      color: itemProse(item.color, "item.color", 80),
      ...(item.brand === undefined ? {} : { brand: itemProse(item.brand, "item.brand", 80) }),
      distinctive_features: distinctiveFeatures,
      lost_after: lostAfter,
      lost_before: lostBefore,
    },
    locations,
    policy: {
      max_calls: maxCalls as number,
      do_not_leave_voicemail: true,
      stop_after_strong_match: true,
      call_window_start: callWindowStart,
      call_window_end: callWindowEnd,
    },
  };
}

export function assertLiveWindow(request: SearchRequest, now = new Date()): void {
  const nowMs = now.getTime();
  const ownerAuthorizedAt = Date.parse(request.owner_authorized_at);
  if (ownerAuthorizedAt > nowMs + 5 * 60 * 1000 || nowMs - ownerAuthorizedAt > 24 * 60 * 60 * 1000) {
    throw new RequestError("Owner authorization must be freshly recorded within 24 hours before live execution.");
  }
  if (nowMs > Date.parse(request.authorization_valid_until)) {
    throw new RequestError("Owner authorization has expired; create and preview a fresh request before placing any call.");
  }
  const callWindowEnd = Date.parse(request.policy.call_window_end);
  if (nowMs < Date.parse(request.policy.call_window_start) || nowMs >= callWindowEnd) {
    throw new RequestError("Current time is outside the explicitly approved live call window; no call was placed.");
  }
  if (callWindowEnd - nowMs < 10 * 60 * 1000) {
    throw new RequestError("At least 10 minutes must remain in the approved live call window before creating another task.");
  }
  for (const location of request.locations.slice(0, request.policy.max_calls)) {
    const verifiedAt = Date.parse(location.published_contact_verified_at);
    if (verifiedAt > nowMs + 5 * 60 * 1000 || nowMs - verifiedAt > 24 * 60 * 60 * 1000) {
      throw new RequestError(`${location.id} must have its published phone contact re-verified within 24 hours before live execution.`);
    }
  }
}

export async function readSearchRequest(path: string): Promise<SearchRequest> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    throw new RequestError(`Could not read request JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  return parseSearchRequest(value);
}
