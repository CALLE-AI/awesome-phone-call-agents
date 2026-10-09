/**
 * T2.7 result ingestion.
 *
 * A terminal call becomes rows in one PostgreSQL transaction. PostgREST cannot
 * hold that transaction, so this module validates the extraction, forwards it
 * to `public.ingest_call_result`, and reads the summary back. The RPC writes
 * the `ingested` timeline row in the same transaction, so a committed ingest
 * always carries its row and a second ingest never writes another.
 *
 * One unusable entry never discards the rest. This module repairs the
 * extraction entry by entry before it sends it. A commitment whose `due` is
 * free text keeps its row with a null `due`, and a retirement of an unknown
 * item is dropped. Each drop is named in `p_skipped` and lands in the
 * `ingested` row. The raw payload keeps the words the caller spoke.
 *
 * A null or unparseable result still writes the transcript and a disposition,
 * so the user never learns that extraction failed.
 *
 * CALL-E's own `result_validation_failed` status lands the run in `no_result`,
 * which is the terminal state `spec.md` section 3 names for that case, with
 * `answered_no_result` as its disposition. A call that merely completed with no
 * usable result keeps the older pair, `completed` and `answered_no_result`,
 * which the same spec section allows.
 *
 * "Invalid" covers more than `parseStructuredResult`. The RPC casts and checks
 * several fields, and a raise there rolls the whole ingest back. The CALL-E
 * payload never changes, so such a result would fail on every retry. This
 * module therefore stays stricter than the SQL on its own. Anything the RPC
 * would reject is repaired before the request leaves.
 *
 * A `slot_change_requested` is a proposal only. This module returns it and
 * never writes `slots`.
 */

import {
  loadCallFixtures,
  RESULT_VALIDATION_FAILED,
  type TranscriptTurnFixture,
} from "./fixtures.ts";
import {
  parseStructuredResult,
  type CapturedItemResult,
  type CommitmentResult,
  type RetiredItemResult,
  type StructuredCallResult,
} from "./result.ts";

export type TerminalCallSource = {
  callRunId: string;
  userId: string;
  raw: unknown;
  transcriptTurns: TranscriptTurnFixture[];
  structuredResult: unknown | null;
};

export type IngestCounts = {
  items: number;
  mentions: number;
  retirements: number;
  commitments: number;
};

export type IngestResult = {
  alreadyIngested: boolean;
  disposition: string;
  counts: IngestCounts;
  slotChangeRequested: string | null;
};

export type IngestDeps = {
  apiUrl: string;
  serviceRoleKey: string;
  fetch: typeof fetch;
};

type TerminalState = "completed" | "no_result" | "failed" | "canceled";
type Disposition = "answered_extracted" | "answered_no_result" | "not_answered" | "canceled";

type IngestSummary = {
  already_ingested: boolean;
  disposition: string;
  counts: IngestCounts;
  slot_change_requested: string | null;
};

// PostgreSQL's uuid input also takes braces and unhyphenated forms. The task
// hands ids out in canonical form, so accepting only that is strictly safer.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INT4_MIN = -2147483648;
const INT4_MAX = 2147483647;
// A strict subset of what `::timestamptz` accepts. The fraction may run to nine
// digits, the separator and the zone letter may be lowercase, and a zone may
// give hours alone. Each accepted boundary form is proven against PostgreSQL by
// case six of test-ingest.sh.
const TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})(?:[Tt ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(?:[Zz]|[+-](\d{2})(?::?(\d{2}))?)?)?$/;

function requireString(value: unknown, message: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(message);
  return value;
}

function requireObject(value: unknown, message: string): Record<string, unknown> {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new Error(message);
  }
  return value as Record<string, unknown>;
}

function requireBoolean(value: unknown, message: string): boolean {
  if (typeof value !== "boolean") throw new Error(message);
  return value;
}

function requireCount(value: unknown, message: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(message);
  }
  return value;
}

// `transcripts.turns` is jsonb, so the column stores every turn CALL-E sends,
// a null offset and a missing speaker included. Nothing here refuses a turn.
// Only the characters a jsonb cast refuses are replaced.
function requireTurns(value: unknown): TranscriptTurnFixture[] {
  if (!Array.isArray(value)) throw new Error("ingest requires transcript turns");
  return value.map(storableJson) as TranscriptTurnFixture[];
}

/** `RESULT_VALIDATION_FAILED` holds CALL-E's spellings for this case. */
function terminalState(raw: Record<string, unknown>): TerminalState {
  const status = raw.status;
  if (status === "completed" || status === "failed" || status === "canceled") return status;
  if (typeof status === "string" && (RESULT_VALIDATION_FAILED as readonly string[]).includes(status)) {
    return "no_result";
  }
  throw new Error("ingest requires a terminal call status");
}

function dispositionFor(state: TerminalState, valid: boolean): Disposition {
  if (state === "canceled") return "canceled";
  if (state === "failed") return "not_answered";
  if (state === "no_result") return "answered_no_result";
  return valid ? "answered_extracted" : "answered_no_result";
}

function apiBase(apiUrl: string): string {
  const base = apiUrl.replace(/\/+$/, "");
  if (base.includes("supabase.co")) throw new Error("must use ORMA_API_URL, not project host");
  return base;
}

function readHeaders(serviceRoleKey: string): HeadersInit {
  return { apikey: serviceRoleKey, authorization: `Bearer ${serviceRoleKey}` };
}

// jsonb refuses U+0000 and any unpaired UTF-16 surrogate. PostgREST fails the
// whole request when one reaches a jsonb argument.
function isStorableText(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code === 0) return false;
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index++;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

/**
 * Replaces each character jsonb refuses with U+FFFD. The rest of the string
 * survives, so one bad character in a payload never costs the whole row. The
 * fast path returns the same string, and almost every string arrives clean.
 */
function storableText(value: string): string {
  if (isStorableText(value)) return value;
  let clean = "";
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code === 0) {
      clean += "\uFFFD";
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        clean += value[index] + value[index + 1];
        index++;
      } else {
        clean += "\uFFFD";
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      clean += "\uFFFD";
    } else {
      clean += value[index];
    }
  }
  return clean;
}

/** Makes every string of a payload storable, keys included. */
function storableJson(value: unknown): unknown {
  if (typeof value === "string") return storableText(value);
  if (Array.isArray(value)) return value.map(storableJson);
  if (value === null || typeof value !== "object") return value;
  const copy: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) copy[storableText(key)] = storableJson(entry);
  return copy;
}

function isStorableTimestamp(value: string): boolean {
  const match = TIMESTAMP_PATTERN.exec(value);
  if (!match) return false;
  const [, year, month, day, hour, minute, second, , offsetHour, offsetMinute] = match;
  const y = Number(year);
  const m = Number(month);
  if (y < 1 || m < 1 || m > 12) return false;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  if (Number(day) < 1 || Number(day) > days) return false;
  if (hour !== undefined && (Number(hour) > 23 || Number(minute) > 59)) return false;
  if (second !== undefined && Number(second) > 59) return false;
  if (offsetHour !== undefined && (Number(offsetHour) > 15 || Number(offsetMinute) > 59)) return false;
  return true;
}

function offsetRejection(value: number, path: string): string | null {
  return value < INT4_MIN || value > INT4_MAX ? `${path} is outside the integer range` : null;
}

/** Names every item id the result references, lowercase and deduplicated. */
function referencedItemIds(result: StructuredCallResult): string[] {
  const ids = [
    ...result.retired_items.map((item) => item.item_id),
    ...(result.commitments ?? []).map((item) => item.item_id),
  ]
    .filter((id) => UUID_PATTERN.test(id))
    .map((id) => id.toLowerCase());
  return [...new Set(ids)];
}

/**
 * Reads the ids this user owns. A failed read is transient, so it throws and
 * the caller retries. An id the user does not own is dropped from the result.
 */
async function readOwnedItemIds(
  ids: string[],
  userId: string,
  deps: IngestDeps,
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const query = new URLSearchParams({
    select: "id",
    user_id: `eq.${userId}`,
    id: `in.(${ids.join(",")})`,
  });
  const response = await deps.fetch(`${apiBase(deps.apiUrl)}/rest/v1/items?${query}`, {
    method: "GET",
    headers: readHeaders(deps.serviceRoleKey),
  });
  if (!response.ok) {
    throw new Error(`item ownership lookup failed: ${await failureCause(response, deps.serviceRoleKey)}`);
  }
  const rows = await response.json();
  if (!Array.isArray(rows)) throw new Error("item ownership lookup returned no rows");
  return new Set(rows.map((row) => typeof row?.id === "string" ? row.id.toLowerCase() : ""));
}

type RepairedResult = {
  structured: StructuredCallResult;
  skipped: string[];
};

/** Mirrors the casts and the ownership check on one referenced item id. */
function itemReferenceRejection(
  item: { item_id: string; evidence_offset_seconds: number },
  path: string,
  owned: Set<string>,
): string | null {
  if (!UUID_PATTERN.test(item.item_id)) return `${path}.item_id is not a UUID`;
  if (!owned.has(item.item_id.toLowerCase())) {
    return `${path}.item_id does not name an item this user owns`;
  }
  return offsetRejection(item.evidence_offset_seconds, `${path}.evidence_offset_seconds`);
}

/**
 * Mirrors every cast and raise in `ingest_call_result`, then drops the entries
 * that would make it raise and keeps every other entry. A commitment whose
 * `due` is not a timestamp keeps its row and loses the due, because a caller
 * who says "tomorrow after work" still made a commitment. Reasons name the path
 * and never the value, because a value may hold a spoken phone number.
 */
function repairStructuredResult(result: StructuredCallResult, owned: Set<string>): RepairedResult {
  const skipped: string[] = [];

  const capturedItems: CapturedItemResult[] = [];
  for (const [index, item] of result.captured_items.entries()) {
    const path = `structured_result.captured_items[${index}]`;
    const rejection = item.text.trim() === ""
      ? `${path}.text is blank`
      : !isStorableText(item.text)
        ? `${path}.text holds characters PostgreSQL cannot store`
        : offsetRejection(item.evidence_offset_seconds, `${path}.evidence_offset_seconds`);
    if (rejection) skipped.push(rejection);
    else capturedItems.push(item);
  }

  const retiredItems: RetiredItemResult[] = [];
  for (const [index, item] of result.retired_items.entries()) {
    const rejection = itemReferenceRejection(item, `structured_result.retired_items[${index}]`, owned);
    if (rejection) skipped.push(rejection);
    else retiredItems.push(item);
  }

  const commitments: CommitmentResult[] = [];
  for (const [index, item] of (result.commitments ?? []).entries()) {
    const path = `structured_result.commitments[${index}]`;
    const rejection = itemReferenceRejection(item, path, owned);
    if (rejection) {
      skipped.push(rejection);
      continue;
    }
    if (item.due !== undefined && !isStorableTimestamp(item.due)) {
      skipped.push(`${path}.due is not a timestamp`);
      commitments.push({ item_id: item.item_id, evidence_offset_seconds: item.evidence_offset_seconds });
      continue;
    }
    commitments.push(item);
  }

  const structured: StructuredCallResult = { captured_items: capturedItems, retired_items: retiredItems };
  if (result.commitments !== undefined) structured.commitments = commitments;
  if (result.slot_change_requested !== undefined) structured.slot_change_requested = result.slot_change_requested;
  if (result.slot_change_time !== undefined) {
    if (isStorableText(result.slot_change_time)) structured.slot_change_time = result.slot_change_time;
    else skipped.push("structured_result.slot_change_time holds characters PostgreSQL cannot store");
  }
  if (result.mood !== undefined) structured.mood = result.mood;

  return { structured, skipped };
}

// A uuid and a timestamp are not phone numbers, so this module keeps the
// digits of each value it would store. A uuid always keeps them, because
// thirty two hex digits run longer than any phone. A timestamp keeps them
// only while every fragment of its run holds seven or more digits. A run
// where every fragment is that long holds a stored value beside whole
// numbers, so the module keeps the value. Every other run could be one
// number, so its fragments mask and the timestamps in it mask too.
//
// A phone number is a run of seven or more decimal digits. Two digits join
// when the gap between them holds at most four characters. A gap may hold any
// code point that is not a decimal digit, because the separator class
// excludes no category. So a space, a hyphen, an en dash, an apostrophe, a
// curly apostrophe, a modifier letter apostrophe, an okina, an Arabic
// tatweel, a bracket, a colon, a middle dot, a backslash and a letter all
// join the groups, and no code point category can break a run. The digit
// class is `\p{Nd}` and not `\d`, so fullwidth digits mask in full. What the
// pattern does not match: a run shorter than seven digits, and a group that a
// gap of five characters or more separates from the rest of its number.
//
// The pattern cannot tell a number from a count. It also masks an integer of
// seven digits or more, a version, a clock time with a fraction, decimal
// money, a plain fraction, a comma joined list of single digits, a compact
// stamp, a dotted quad, a card grouping written in fours, and a date-shaped
// run this module does not store as a timestamp. Two stored values written
// side by side mask as well, because that run holds a zero digit fragment.
// Every other digit of a run masks, one fragment at a time, and what survives
// is a stored value plus the separators around it.
//
// The widest gap that still joins two groups of one number.
const PHONE_GAP = 4;
const UUID_SCAN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const TIMESTAMP_SCAN =
  /\d{4}-\d{2}-\d{2}(?:[Tt ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:[Zz]|[+-]\d{2}:?\d{2})?)?/g;
const PHONE_SCAN = new RegExp(
  `[+\\uFF0B]?\\p{Nd}(?:[^\\p{Nd}]{0,${PHONE_GAP}}\\p{Nd}){6,}`,
  "gu",
);
const DIGIT_SCAN = /\p{Nd}/gu;

type ValueKind = "uuid" | "timestamp";

/** A value this module would store, and where the text holds it. */
type ValueSpan = { start: number; end: number; kind: ValueKind };

/** A value inside one run, with its offset measured from the run's start. */
type RunSpan = { start: number; end: number; kind: ValueKind };

/** Every uuid and every stored timestamp of the text, in order. */
function valueSpans(text: string): ValueSpan[] {
  const spans: ValueSpan[] = [];
  for (const match of text.matchAll(UUID_SCAN)) {
    const start = match.index ?? 0;
    spans.push({ start, end: start + match[0].length, kind: "uuid" });
  }
  for (const match of text.matchAll(TIMESTAMP_SCAN)) {
    if (!isStorableTimestamp(match[0])) continue;
    const start = match.index ?? 0;
    spans.push({ start, end: start + match[0].length, kind: "timestamp" });
  }
  return spans.sort((left, right) => left.start - right.start);
}

function digitCount(fragment: string): number {
  return fragment.match(DIGIT_SCAN)?.length ?? 0;
}

/** Replaces the digits of one fragment with the mask, keeping its separators. */
function maskFragment(fragment: string): string {
  const digits = [...fragment.matchAll(DIGIT_SCAN)];
  if (digits.length === 0) return fragment;
  const start = digits[0].index ?? 0;
  const last = digits[digits.length - 1];
  const end = (last.index ?? 0) + last[0].length;
  return `${fragment.slice(0, start)}[masked number]${fragment.slice(end)}`;
}

/**
 * Masks one phone-shaped run. A uuid always keeps its digits. A timestamp
 * keeps them only while every fragment of the run holds seven or more digits,
 * so a date followed by a short remainder masks together with the number. A
 * run of two stored values with only separators between them holds a zero
 * digit fragment, which is too short, so a timestamp in that run masks too.
 */
function maskRun(run: string, start: number, values: ValueSpan[]): string {
  const end = start + run.length;
  const inside: RunSpan[] = values
    .filter((value) => value.start < end && value.end > start)
    .map((value) => ({
      kind: value.kind,
      start: Math.max(value.start, start) - start,
      end: Math.min(value.end, end) - start,
    }));
  if (inside.length === 0) return "[masked number]";

  const fragments: number[] = [];
  let cursor = 0;
  for (const value of inside) {
    if (value.start > cursor) fragments.push(digitCount(run.slice(cursor, value.start)));
    cursor = Math.max(cursor, value.end);
  }
  if (cursor < run.length) fragments.push(digitCount(run.slice(cursor)));
  const ambiguous = fragments.some((digits) => digits < 7);

  const kept: RunSpan[] = [];
  for (const value of inside) {
    if (value.kind === "timestamp" && ambiguous) continue;
    if (kept.length > 0 && value.start < kept[kept.length - 1].end) continue;
    kept.push(value);
  }
  if (kept.length === 0) return "[masked number]";

  let masked = "";
  let at = 0;
  for (const value of kept) {
    masked += maskFragment(run.slice(at, value.start)) + run.slice(value.start, value.end);
    at = value.end;
  }
  return masked + maskFragment(run.slice(at));
}

/** Masks every phone-shaped run of the text, keeping the value digits in it. */
function maskPhones(text: string): string {
  const values = valueSpans(text);
  let masked = "";
  let cursor = 0;
  for (const match of text.matchAll(PHONE_SCAN)) {
    const start = match.index ?? 0;
    masked += text.slice(cursor, start) + maskRun(match[0], start, values);
    cursor = start + match[0].length;
  }
  return masked + text.slice(cursor);
}

/** Removes keys and masks phone-shaped digit runs. `maskRun` says what keeps its digits. */
function scrub(text: string, serviceRoleKey: string): string {
  let clean = serviceRoleKey ? text.split(serviceRoleKey).join("[redacted key]") : text;
  clean = clean
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, "[redacted key]")
    .replace(/sb_(?:secret|publishable)_[\w-]+/g, "[redacted key]");
  return maskPhones(clean);
}

/** Names the PostgREST cause of a failed request, safe to log or throw. */
async function failureCause(response: Response, serviceRoleKey: string): Promise<string> {
  let body = "";
  try {
    body = await response.text();
  } catch {
    body = "";
  }
  let parts = [body.trim()];
  try {
    const parsed = JSON.parse(body);
    if (parsed !== null && typeof parsed === "object") {
      parts = [parsed.code, parsed.message, parsed.details, parsed.hint];
    }
  } catch {
    // A non-JSON body is kept as text.
  }
  // The caller reads one string, so the parts are joined before they are
  // scrubbed. Digits from two fields then mask as one run instead of meeting
  // in the returned text. The status is ours, three digits that no response
  // changes, so the module appends it after the masker has run.
  const detail = scrub(
    parts.filter((part): part is string => typeof part === "string" && part !== "").join(" "),
    serviceRoleKey,
  );
  return (detail ? `HTTP ${response.status} ${detail}` : `HTTP ${response.status}`).slice(0, 500);
}

function readSummary(value: unknown): IngestSummary {
  const record = requireObject(value, "ingest returned no summary");
  const counts = requireObject(record.counts, "ingest summary requires counts");
  return {
    already_ingested: requireBoolean(record.already_ingested, "ingest summary requires an already_ingested flag"),
    disposition: requireString(record.disposition, "ingest summary requires a disposition"),
    counts: {
      items: requireCount(counts.items, "ingest summary requires an item count"),
      mentions: requireCount(counts.mentions, "ingest summary requires a mention count"),
      retirements: requireCount(counts.retirements, "ingest summary requires a retirement count"),
      commitments: requireCount(counts.commitments, "ingest summary requires a commitment count"),
    },
    slot_change_requested: typeof record.slot_change_requested === "string"
      ? record.slot_change_requested
      : null,
  };
}


export function depsFromEnv(
  getEnv: (name: string) => string | undefined = (name) => Deno.env.get(name),
  fetchImpl: typeof fetch = fetch,
): IngestDeps {
  const apiUrl = getEnv("ORMA_API_URL");
  const serviceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!apiUrl) throw new Error("missing ORMA_API_URL");
  if (!serviceRoleKey) throw new Error("missing SUPABASE_SERVICE_ROLE_KEY");
  return { apiUrl, serviceRoleKey, fetch: fetchImpl };
}

/**
 * Ingests one terminal call. The caller supplies the authoritative payload
 * plus the transcript turns and structured result it extracted from that
 * payload, so this module never dials CALL-E. Environment is reached only
 * through `ORMA_API_URL`.
 */
export async function ingestTerminalRun(
  source: TerminalCallSource,
  deps: IngestDeps,
): Promise<IngestResult> {
  const input = requireObject(source, "ingest requires a terminal call source");
  const runId = requireString(input.callRunId, "ingest requires a call run id");
  const userId = requireString(input.userId, "ingest requires a user id");
  const raw = requireObject(input.raw, "ingest requires a terminal call payload");
  // The turns are sanitised by `requireTurns`. The raw payload is the whole
  // CALL-E call, and jsonb refuses U+0000 and unpaired surrogates, so one bad
  // character inside it would poison every later retry. Replace those, never
  // the field.
  const turns = requireTurns(input.transcriptTurns);
  const state = terminalState(raw);
  const storableRaw = storableJson(raw);

  const parsed = parseStructuredResult(input.structuredResult ?? null);
  let structured = parsed.result;
  const reason = parsed.reason;
  let skipped: string[] = [];
  if (structured !== null) {
    const owned = await readOwnedItemIds(referencedItemIds(structured), userId, deps);
    const repaired = repairStructuredResult(structured, owned);
    structured = repaired.structured;
    skipped = repaired.skipped;
  }
  const valid = structured !== null;
  const disposition = dispositionFor(state, valid);

  // The RPC casts this to timestamptz. An unparseable provider timestamp falls
  // back to the RPC's now() instead of failing the ingest forever.
  const completedAt = typeof raw.completed_at === "string" && isStorableTimestamp(raw.completed_at)
    ? raw.completed_at
    : null;

  const response = await deps.fetch(`${apiBase(deps.apiUrl)}/rest/v1/rpc/ingest_call_result`, {
    method: "POST",
    headers: {
      ...readHeaders(deps.serviceRoleKey),
      "content-type": "application/json",
    },
    body: JSON.stringify({
      p_call_run_id: runId,
      p_user_id: userId,
      p_transcript_turns: turns,
      p_raw: storableRaw,
      p_structured: structured,
      p_result_valid: valid,
      p_result_error: reason,
      p_state: state,
      p_disposition: disposition,
      p_mood: structured?.mood ?? null,
      p_completed_at: completedAt,
      p_skipped: skipped,
    }),
  });
  if (!response.ok) {
    throw new Error(`call result ingestion failed: ${await failureCause(response, deps.serviceRoleKey)}`);
  }

  const summary = readSummary(await response.json());

  return {
    alreadyIngested: summary.already_ingested,
    disposition: summary.disposition,
    counts: summary.counts,
    slotChangeRequested: summary.slot_change_requested,
  };
}

const testFn =
  (Deno as { test?: (name: string, fn: () => void | Promise<void>) => void })
    .test;

if (typeof testFn === "function") {
  const baseUrl = "https://orma-api.nryn.dev";
  const runId = "11111111-1111-4111-8111-111111111111";
  const userId = "33333333-3333-4333-8333-333333333333";
  const itemId = "22222222-2222-4222-8222-222222222222";
  const zeroCounts: IngestCounts = { items: 0, mentions: 0, retirements: 0, commitments: 0 };

  const deps = (fetchImpl: typeof fetch): IngestDeps => ({
    apiUrl: baseUrl,
    serviceRoleKey: "service-key",
    fetch: fetchImpl,
  });

  type MockState = {
    rpcBodies: Record<string, unknown>[];
    summary: () => IngestSummary;
    ownedItems?: string[];
    itemLookups?: URL[];
    rpcFailure?: () => Response | null;
  };

  // Every mock branches on URL and method. Anything else throws, so a stray
  // request fails the test instead of passing silently. Ingestion posts no
  // timeline row of its own now, and a retry reads no run row, so both paths
  // are deliberately unreachable here.
  const mock = (state: MockState): typeof fetch =>
  (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.pathname === "/rest/v1/rpc/ingest_call_result") {
      if (request.method !== "POST") throw new Error(`unexpected ${request.method} ${request.url}`);
      return request.json().then((body) => {
        state.rpcBodies.push(body as Record<string, unknown>);
        return state.rpcFailure?.() ?? Response.json(state.summary());
      });
    }
    if (url.pathname === "/rest/v1/items") {
      if (request.method !== "GET" || !state.ownedItems) throw new Error(`unexpected ${request.method} ${request.url}`);
      state.itemLookups?.push(url);
      return Promise.resolve(Response.json(state.ownedItems.map((id) => ({ id }))));
    }
    throw new Error(`unexpected request ${request.method} ${request.url}`);
  };

  testFn("the completed fixture produces items, mentions, retirements and commitments", async () => {
    const { completed } = await loadCallFixtures();
    const attempt = completed.recipients[0].attempts[0];
    // The recorded call retired nothing and promised nothing. This test adds
    // one of each so those branches still run against the recorded payload.
    const structuredResult = {
      ...(completed.structured_result as Record<string, unknown>),
      retired_items: [{ item_id: itemId, evidence_offset_seconds: 62 }],
      commitments: [{ item_id: itemId, due: "2026-09-12T03:00:00.000Z", evidence_offset_seconds: 80 }],
    };
    const state: MockState = {
      rpcBodies: [],
      ownedItems: [itemId],
      itemLookups: [],
      summary: () => ({
        already_ingested: false,
        disposition: "answered_extracted",
        counts: { items: 1, mentions: 3, retirements: 1, commitments: 1 },
        slot_change_requested: "no",
      }),
    };

    const result = await ingestTerminalRun({
      callRunId: runId,
      userId,
      raw: completed,
      transcriptTurns: attempt.transcript_turns,
      structuredResult,
    }, deps(mock(state)));

    if (state.itemLookups?.length !== 1) throw new Error("the referenced item ids must be checked once");
    const lookup = state.itemLookups[0].searchParams;
    if (lookup.get("user_id") !== `eq.${userId}` || lookup.get("id") !== `in.(${itemId})`) {
      throw new Error("the ownership lookup must filter by user and item");
    }
    if (state.rpcBodies.length !== 1) throw new Error("the completed fixture must ingest through one RPC");
    const body = state.rpcBodies[0];
    if (body.p_call_run_id !== runId || body.p_user_id !== userId) {
      throw new Error("the RPC lost the run or the user");
    }
    if (body.p_state !== "completed" || body.p_disposition !== "answered_extracted") {
      throw new Error("the completed call did not become an answered extraction");
    }
    if (body.p_result_valid !== true || body.p_result_error !== null || body.p_mood !== "unknown") {
      throw new Error("the valid result was not forwarded intact");
    }
    if (body.p_completed_at !== completed.completed_at) {
      throw new Error("a well-formed completed_at must be forwarded");
    }
    if (JSON.stringify(body.p_raw) !== JSON.stringify(completed)) {
      throw new Error("the raw provider payload was not preserved");
    }
    if (JSON.stringify(body.p_transcript_turns) !== JSON.stringify(attempt.transcript_turns)) {
      throw new Error("the transcript turns were not preserved");
    }
    const structured = body.p_structured as Record<string, unknown>;
    if (JSON.stringify(structured.captured_items) !== JSON.stringify([{ text: "Continental", evidence_offset_seconds: 44 }])) {
      throw new Error("the captured item did not survive extraction");
    }
    const retired = structured.retired_items as Record<string, unknown>[];
    const commitments = structured.commitments as Record<string, unknown>[];
    if (retired[0]?.evidence_offset_seconds !== 62 || commitments[0]?.due !== "2026-09-12T03:00:00.000Z") {
      throw new Error("the retirement or commitment lost its evidence");
    }

    if (result.alreadyIngested !== false || result.disposition !== "answered_extracted") {
      throw new Error("the RPC summary was not surfaced");
    }
    if (result.counts.items !== 1 || result.counts.mentions !== 3 || result.counts.retirements !== 1 || result.counts.commitments !== 1) {
      throw new Error("the RPC counts were not surfaced");
    }
    if (result.slotChangeRequested !== "no") throw new Error("the slot proposal was not surfaced");

    // The RPC writes the timeline row inside its own transaction. The mock
    // throws on any call_events request, so a post-commit write fails here.
    if (JSON.stringify(body.p_skipped) !== "[]") {
      throw new Error("a clean extraction skipped nothing, so it must report nothing");
    }
  });

  testFn("the invalid fixture writes a transcript and a disposition with no partial state", async () => {
    const raw = await Deno.readTextFile(
      new URL("../../../testdata/calle/webhook-result-validation-failed.documented.json", import.meta.url),
    );
    const fixture = JSON.parse(raw) as { body: { id: string; data: { id: string } } };
    const state: MockState = {
      rpcBodies: [],
      summary: () => ({
        already_ingested: false,
        disposition: "answered_no_result",
        counts: zeroCounts,
        slot_change_requested: null,
      }),
    };

    const result = await ingestTerminalRun({
      callRunId: runId,
      userId,
      raw: {
        id: fixture.body.data.id,
        status: "completed",
        structured_result: null,
        completed_at: "2026-09-13T12:00:30.000Z",
      },
      transcriptTurns: [],
      structuredResult: fixture.body,
    }, deps(mock(state)));

    if (state.rpcBodies.length !== 1) throw new Error("the invalid fixture must still reach the RPC");
    const body = state.rpcBodies[0];
    if (body.p_structured !== null || body.p_result_valid !== false) {
      throw new Error("an invalid result must not be persisted as structured");
    }
    if (typeof body.p_result_error !== "string" || body.p_result_error.length === 0) {
      throw new Error("an invalid result must carry its failure reason");
    }
    if (body.p_disposition !== "answered_no_result" || body.p_state !== "completed") {
      throw new Error("an answered call with no result must be answered_no_result");
    }
    if (JSON.stringify(body.p_transcript_turns) !== "[]") {
      throw new Error("the transcript must still be written on an invalid result");
    }
    if (result.disposition !== "answered_no_result" || result.counts.items !== 0 || result.counts.mentions !== 0) {
      throw new Error("an invalid result must leave no partial state");
    }
    if (JSON.stringify(state.rpcBodies[0].p_skipped) !== "[]") {
      throw new Error("an invalid result skips nothing, because it carries nothing");
    }
  });

  testFn("a retirement without an evidence offset is rejected", async () => {
    const state: MockState = {
      rpcBodies: [],
      summary: () => ({
        already_ingested: false,
        disposition: "answered_no_result",
        counts: zeroCounts,
        slot_change_requested: null,
      }),
    };

    const result = await ingestTerminalRun({
      callRunId: runId,
      userId,
      raw: { id: "call_unoffset_retirement", status: "completed" },
      transcriptTurns: [],
      structuredResult: { captured_items: [], retired_items: [{ item_id: itemId }] },
    }, deps(mock(state)));

    if (state.rpcBodies.length !== 1) throw new Error("the rejected result must reach the RPC as invalid");
    const body = state.rpcBodies[0];
    if (body.p_structured !== null || body.p_result_valid !== false) {
      throw new Error("a retirement without an evidence offset must be rejected, never written");
    }
    if (typeof body.p_result_error !== "string" || body.p_result_error.length === 0) {
      throw new Error("the rejected retirement must carry a reason");
    }
    if (result.disposition !== "answered_no_result") {
      throw new Error("a rejected extraction must fall back to answered_no_result");
    }
  });

  const countOf = (structured: Record<string, unknown>, key: string): number =>
    Array.isArray(structured[key]) ? (structured[key] as unknown[]).length : 0;

  // One unusable entry never discards the rest. Each case parses cleanly and
  // holds one entry `ingest_call_result` would raise on. Every other entry
  // still reaches the RPC, and the drop is named in `p_skipped`. Case seven of
  // test-ingest.sh proves the same values raise when nothing repairs them.
  const repaired: {
    name: string;
    result: Record<string, unknown>;
    owned?: string[];
    skipped: string[];
    expect: (structured: Record<string, unknown>) => void;
  }[] = [
    {
      name: "a free-text due",
      result: {
        captured_items: [
          { text: "renew the passport", evidence_offset_seconds: 44 },
          { text: "book the dentist", evidence_offset_seconds: 62 },
        ],
        retired_items: [{ item_id: itemId, evidence_offset_seconds: 70 }],
        commitments: [{ item_id: itemId, due: "next Tuesday after work", evidence_offset_seconds: 80 }],
      },
      skipped: ["structured_result.commitments[0].due is not a timestamp"],
      expect: (structured) => {
        const commitments = structured.commitments as Record<string, unknown>[];
        if (countOf(structured, "captured_items") !== 2 || countOf(structured, "retired_items") !== 1) {
          throw new Error("a free-text due discarded the rest of the extraction");
        }
        if (commitments.length !== 1 || "due" in commitments[0]) {
          throw new Error("a free-text due must keep its commitment with no due");
        }
        if (commitments[0].evidence_offset_seconds !== 80) {
          throw new Error("a repaired commitment must keep its evidence offset");
        }
      },
    },
    {
      name: "a year-only due",
      result: {
        captured_items: [{ text: "book the dentist", evidence_offset_seconds: 62 }],
        retired_items: [],
        commitments: [{ item_id: itemId, due: "2026", evidence_offset_seconds: 80 }],
      },
      skipped: ["structured_result.commitments[0].due is not a timestamp"],
      expect: (structured) => {
        const commitments = structured.commitments as Record<string, unknown>[];
        if (countOf(structured, "captured_items") !== 1 || commitments.length !== 1 || "due" in commitments[0]) {
          throw new Error("a year-only due must keep its commitment and the captured item");
        }
      },
    },
    {
      name: "an empty due",
      result: {
        captured_items: [{ text: "book the dentist", evidence_offset_seconds: 62 }],
        retired_items: [],
        commitments: [{ item_id: itemId, due: "", evidence_offset_seconds: 80 }],
      },
      skipped: ["structured_result.commitments[0].due is not a timestamp"],
      expect: (structured) => {
        const commitments = structured.commitments as Record<string, unknown>[];
        if (countOf(structured, "captured_items") !== 1 || commitments.length !== 1 || "due" in commitments[0]) {
          throw new Error("an empty due must keep its commitment and the captured item");
        }
      },
    },
    {
      name: "an impossible calendar due",
      result: {
        captured_items: [{ text: "book the dentist", evidence_offset_seconds: 62 }],
        retired_items: [],
        commitments: [{ item_id: itemId, due: "2026-02-30T10:00:00Z", evidence_offset_seconds: 80 }],
      },
      skipped: ["structured_result.commitments[0].due is not a timestamp"],
      expect: (structured) => {
        const commitments = structured.commitments as Record<string, unknown>[];
        if (countOf(structured, "captured_items") !== 1 || commitments.length !== 1 || "due" in commitments[0]) {
          throw new Error("an impossible calendar due must keep its commitment and the captured item");
        }
      },
    },
    {
      name: "a due in year zero",
      result: {
        captured_items: [{ text: "book the dentist", evidence_offset_seconds: 62 }],
        retired_items: [],
        commitments: [{ item_id: itemId, due: "0000-09-15T10:00:00Z", evidence_offset_seconds: 80 }],
      },
      skipped: ["structured_result.commitments[0].due is not a timestamp"],
      expect: (structured) => {
        const commitments = structured.commitments as Record<string, unknown>[];
        if (countOf(structured, "captured_items") !== 1 || commitments.length !== 1 || "due" in commitments[0]) {
          throw new Error("a due in year zero must keep its commitment and the captured item");
        }
      },
    },
    {
      name: "a due with an out-of-range zone",
      result: {
        captured_items: [{ text: "book the dentist", evidence_offset_seconds: 62 }],
        retired_items: [],
        commitments: [{ item_id: itemId, due: "2026-09-15T10:00:00+16:00", evidence_offset_seconds: 80 }],
      },
      skipped: ["structured_result.commitments[0].due is not a timestamp"],
      expect: (structured) => {
        const commitments = structured.commitments as Record<string, unknown>[];
        if (countOf(structured, "captured_items") !== 1 || commitments.length !== 1 || "due" in commitments[0]) {
          throw new Error("an out-of-range zone must keep its commitment and the captured item");
        }
      },
    },
    {
      name: "a paraphrased retired item id",
      result: {
        captured_items: [{ text: "book the dentist", evidence_offset_seconds: 62 }],
        retired_items: [{ item_id: "the museum one", evidence_offset_seconds: 80 }],
      },
      skipped: ["structured_result.retired_items[0].item_id is not a UUID"],
      expect: (structured) => {
        if (countOf(structured, "captured_items") !== 1 || countOf(structured, "retired_items") !== 0) {
          throw new Error("a paraphrased retired id must drop that retirement alone");
        }
      },
    },
    {
      name: "a paraphrased commitment item id",
      result: {
        captured_items: [{ text: "book the dentist", evidence_offset_seconds: 62 }],
        retired_items: [],
        commitments: [{ item_id: "passport", evidence_offset_seconds: 80 }],
      },
      skipped: ["structured_result.commitments[0].item_id is not a UUID"],
      expect: (structured) => {
        if (countOf(structured, "captured_items") !== 1 || countOf(structured, "commitments") !== 0) {
          throw new Error("a paraphrased commitment id must drop that commitment alone");
        }
      },
    },
    {
      name: "a blank captured text",
      result: {
        captured_items: [
          { text: "   ", evidence_offset_seconds: 44 },
          { text: "book the dentist", evidence_offset_seconds: 62 },
        ],
        retired_items: [],
      },
      skipped: ["structured_result.captured_items[0].text is blank"],
      expect: (structured) => {
        const captured = structured.captured_items as Record<string, unknown>[];
        if (captured.length !== 1 || captured[0].text !== "book the dentist") {
          throw new Error("a blank captured text must drop that item alone");
        }
      },
    },
    {
      name: "an empty captured text",
      result: {
        captured_items: [
          { text: "", evidence_offset_seconds: 44 },
          { text: "book the dentist", evidence_offset_seconds: 62 },
        ],
        retired_items: [],
      },
      skipped: ["structured_result.captured_items[0].text is blank"],
      expect: (structured) => {
        const captured = structured.captured_items as Record<string, unknown>[];
        if (captured.length !== 1 || captured[0].text !== "book the dentist") {
          throw new Error("an empty captured text must drop that item alone");
        }
      },
    },
    {
      name: "a captured text holding U+0000",
      result: {
        captured_items: [
          { text: "pass\u0000port", evidence_offset_seconds: 44 },
          { text: "book the dentist", evidence_offset_seconds: 62 },
        ],
        retired_items: [],
      },
      skipped: ["structured_result.captured_items[0].text holds characters PostgreSQL cannot store"],
      expect: (structured) => {
        const captured = structured.captured_items as Record<string, unknown>[];
        if (captured.length !== 1 || captured[0].text !== "book the dentist") {
          throw new Error("an unstorable captured text must drop that item alone");
        }
      },
    },
    {
      name: "a captured text holding a lone surrogate",
      result: {
        captured_items: [
          { text: "pass\ud800port", evidence_offset_seconds: 44 },
          { text: "book the dentist", evidence_offset_seconds: 62 },
        ],
        retired_items: [],
      },
      skipped: ["structured_result.captured_items[0].text holds characters PostgreSQL cannot store"],
      expect: (structured) => {
        const captured = structured.captured_items as Record<string, unknown>[];
        if (captured.length !== 1 || captured[0].text !== "book the dentist") {
          throw new Error("a lone surrogate must drop that item alone");
        }
      },
    },
    {
      name: "a slot change time holding U+0000",
      result: {
        captured_items: [],
        retired_items: [],
        slot_change_requested: "yes",
        slot_change_time: "7\u0000am",
      },
      skipped: ["structured_result.slot_change_time holds characters PostgreSQL cannot store"],
      expect: (structured) => {
        if (structured.slot_change_requested !== "yes" || "slot_change_time" in structured) {
          throw new Error("an unstorable slot change time must never cost the proposal");
        }
      },
    },
    {
      name: "a captured offset above the integer range",
      result: {
        captured_items: [
          { text: "Continental", evidence_offset_seconds: 2147483648 },
          { text: "book the dentist", evidence_offset_seconds: 62 },
        ],
        retired_items: [],
      },
      skipped: ["structured_result.captured_items[0].evidence_offset_seconds is outside the integer range"],
      expect: (structured) => {
        const captured = structured.captured_items as Record<string, unknown>[];
        if (captured.length !== 1 || captured[0].text !== "book the dentist") {
          throw new Error("an out-of-range offset must drop that item alone");
        }
      },
    },
    {
      name: "a retired offset written as 1e21",
      result: {
        captured_items: [{ text: "book the dentist", evidence_offset_seconds: 62 }],
        retired_items: [{ item_id: itemId, evidence_offset_seconds: 1e21 }],
      },
      skipped: ["structured_result.retired_items[0].evidence_offset_seconds is outside the integer range"],
      expect: (structured) => {
        if (countOf(structured, "captured_items") !== 1 || countOf(structured, "retired_items") !== 0) {
          throw new Error("an out-of-range retired offset must drop that retirement alone");
        }
      },
    },
    {
      name: "a commitment offset below the integer range",
      result: {
        captured_items: [{ text: "book the dentist", evidence_offset_seconds: 62 }],
        retired_items: [],
        commitments: [{ item_id: itemId, evidence_offset_seconds: -2147483649 }],
      },
      skipped: ["structured_result.commitments[0].evidence_offset_seconds is outside the integer range"],
      expect: (structured) => {
        if (countOf(structured, "captured_items") !== 1 || countOf(structured, "commitments") !== 0) {
          throw new Error("an out-of-range commitment offset must drop that commitment alone");
        }
      },
    },
    {
      name: "a retirement of an item the user does not own",
      result: {
        captured_items: [{ text: "book the dentist", evidence_offset_seconds: 62 }],
        retired_items: [{ item_id: itemId, evidence_offset_seconds: 80 }],
      },
      owned: [],
      skipped: ["structured_result.retired_items[0].item_id does not name an item this user owns"],
      expect: (structured) => {
        if (countOf(structured, "captured_items") !== 1 || countOf(structured, "retired_items") !== 0) {
          throw new Error("a foreign retirement must drop that retirement alone");
        }
      },
    },
    {
      name: "a commitment on an item the user does not own",
      result: {
        captured_items: [{ text: "book the dentist", evidence_offset_seconds: 62 }],
        retired_items: [],
        commitments: [{ item_id: "44444444-4444-4444-8444-444444444444", evidence_offset_seconds: 80 }],
      },
      owned: [itemId],
      skipped: ["structured_result.commitments[0].item_id does not name an item this user owns"],
      expect: (structured) => {
        if (countOf(structured, "captured_items") !== 1 || countOf(structured, "commitments") !== 0) {
          throw new Error("a foreign commitment must drop that commitment alone");
        }
      },
    },
  ];

  testFn("one bad entry never discards the rest of the extraction", async () => {
    for (const testCase of repaired) {
      if (parseStructuredResult(testCase.result).result === null) {
        throw new Error(`${testCase.name} must pass the parser, or the case proves nothing`);
      }
      const state: MockState = {
        rpcBodies: [],
        ownedItems: testCase.owned ?? [itemId],
        summary: () => ({
          already_ingested: false,
          disposition: "answered_extracted",
          counts: zeroCounts,
          slot_change_requested: null,
        }),
      };
      await ingestTerminalRun({
        callRunId: runId,
        userId,
        raw: { id: "call_repaired", status: "completed" },
        transcriptTurns: [{ offset_seconds: 0, speaker: "agent", text: "Hello" }],
        structuredResult: testCase.result,
      }, deps(mock(state)));

      const body = state.rpcBodies[0];
      if (body?.p_result_valid !== true || body.p_structured === null || body.p_mood !== null) {
        throw new Error(`${testCase.name} did not reach the RPC as a valid result`);
      }
      if (body.p_result_error !== null) {
        throw new Error(`${testCase.name} carried the reason ${String(body.p_result_error)}`);
      }
      if (body.p_disposition !== "answered_extracted") {
        throw new Error(`${testCase.name} lost its disposition`);
      }
      if (JSON.stringify(body.p_skipped) !== JSON.stringify(testCase.skipped)) {
        throw new Error(`${testCase.name} reported ${JSON.stringify(body.p_skipped)}`);
      }
      testCase.expect(body.p_structured as Record<string, unknown>);
    }
  });

  testFn("boundary values that PostgreSQL accepts stay valid", async () => {
    // The same values commit in case six of test-ingest.sh.
    const upper = itemId.toUpperCase();
    const dues = [
      "2026-09-15",
      "2026-09-15T10:00Z",
      "2026-09-15 10:00:00.123456+15:59",
      "2028-02-29T23:59:59-0530",
      "0001-01-01T00:00:00Z",
      "2026-09-15T10:00:00.123456789Z",
      "2026-09-15t10:00:00z",
      "2026-09-15T10:00+05",
      "2026-09-15 10:00:00+0530",
    ];
    const state: MockState = {
      rpcBodies: [],
      ownedItems: [itemId],
      summary: () => ({
        already_ingested: false,
        disposition: "answered_extracted",
        counts: zeroCounts,
        slot_change_requested: null,
      }),
    };
    await ingestTerminalRun({
      callRunId: runId,
      userId,
      raw: { id: "call_boundary", status: "completed", completed_at: "sometime after lunch" },
      transcriptTurns: [],
      structuredResult: {
        captured_items: [
          { text: " x", evidence_offset_seconds: -2147483648 },
          { text: "café 😀", evidence_offset_seconds: 2147483647 },
        ],
        retired_items: [{ item_id: upper, evidence_offset_seconds: 0 }],
        commitments: dues.map((due) => ({ item_id: itemId, due, evidence_offset_seconds: 1 })),
      },
    }, deps(mock(state)));
    const body = state.rpcBodies[0];
    if (body.p_result_valid !== true || body.p_result_error !== null) {
      throw new Error(`a PostgreSQL-storable result was rejected: ${String(body.p_result_error)}`);
    }
    if (body.p_completed_at !== null) {
      throw new Error("an unparseable completed_at must fall back to null, never reach the cast");
    }
    if (JSON.stringify(body.p_skipped) !== "[]") {
      throw new Error("a storable result must repair nothing");
    }
    const commitments = (body.p_structured as Record<string, unknown>).commitments as Record<string, unknown>[];
    if (JSON.stringify(commitments.map((entry) => entry.due)) !== JSON.stringify(dues)) {
      throw new Error("a due PostgreSQL accepts was repaired away");
    }
  });

  testFn("re-ingesting the same run twice changes nothing", async () => {
    const { completed } = await loadCallFixtures();
    const attempt = completed.recipients[0].attempts[0];
    let ingests = 0;
    const state: MockState = {
      rpcBodies: [],
      summary: () => ingests++ === 0
        ? {
          already_ingested: false,
          disposition: "answered_extracted",
          counts: { items: 1, mentions: 1, retirements: 0, commitments: 0 },
          slot_change_requested: "no",
        }
        : {
          already_ingested: true,
          disposition: "answered_extracted",
          counts: zeroCounts,
          slot_change_requested: "no",
        },
    };
    const source: TerminalCallSource = {
      callRunId: runId,
      userId,
      raw: completed,
      transcriptTurns: attempt.transcript_turns,
      structuredResult: completed.structured_result,
    };

    const first = await ingestTerminalRun(source, deps(mock(state)));
    const second = await ingestTerminalRun(source, deps(mock(state)));

    if (state.rpcBodies.length !== 2) throw new Error("both ingests must still check the transaction in SQL");
    if (first.alreadyIngested !== false || second.alreadyIngested !== true) {
      throw new Error("the second ingest must be marked already_ingested");
    }
    if (second.counts.items !== 0 || second.counts.mentions !== 0 || second.counts.commitments !== 0) {
      throw new Error("a re-ingest must not report new rows");
    }
    if (JSON.stringify(state.rpcBodies[0]) !== JSON.stringify(state.rpcBodies[1])) {
      throw new Error("a re-ingest must send the same request and let the RPC decide");
    }
  });

  testFn("a character jsonb refuses never stops the request", async () => {
    const state: MockState = {
      rpcBodies: [],
      summary: () => ({
        already_ingested: false,
        disposition: "answered_no_result",
        counts: zeroCounts,
        slot_change_requested: null,
      }),
    };
    await ingestTerminalRun({
      callRunId: runId,
      userId,
      raw: {
        id: "call_poison",
        status: "completed",
        structured_result: {
          captured_items: [{ text: "Conti\u0000nental", evidence_offset_seconds: 44 }],
          retired_items: [],
          summary: "café \ud800 and 😀",
        },
      },
      transcriptTurns: [
        { offset_seconds: 0, speaker: "agent", text: "" },
        { offset_seconds: 3.5, speaker: "caller", text: "Conti\u0000nental" },
      ],
      structuredResult: null,
    }, deps(mock(state)));

    // The wire body is the measurement. JSON.stringify escapes U+0000 and an
    // unpaired surrogate, so their absence proves the RPC never sees them. The
    // old code sent both, and PostgREST answered 22P05 on every retry.
    const wire = JSON.stringify(state.rpcBodies[0]);
    if (wire.includes("\\u0000")) throw new Error("a U+0000 reached the request body");
    if (wire.includes("\\ud800")) throw new Error("a lone surrogate reached the request body");

    const sentRaw = state.rpcBodies[0].p_raw as Record<string, unknown>;
    const sentStructured = sentRaw.structured_result as Record<string, unknown>;
    if (sentStructured.summary !== "café \uFFFD and 😀") {
      throw new Error(`the raw payload lost its shape: ${String(sentStructured.summary)}`);
    }
    const turns = state.rpcBodies[0].p_transcript_turns as Record<string, unknown>[];
    if (turns.length !== 2 || turns[0].text !== "" || turns[0].offset_seconds !== 0) {
      throw new Error("a turn with empty text must still reach the RPC");
    }
    if (turns[1].offset_seconds !== 3.5 || turns[1].text !== "Conti\uFFFDnental") {
      throw new Error("a fractional offset or a poisoned text must survive the request");
    }
  });

  // `transcripts.turns` is jsonb, so the column stores every one of these five
  // shapes. Refusing one strands the run forever, because the payload never
  // changes and every retry would throw the same way.
  testFn("a turn shape the column stores reaches the RPC", async () => {
    const shapes = [
      { offset_seconds: null, speaker: "agent", text: "Hello" },
      { speaker: "agent", text: "Hello" },
      { offset_seconds: "3", speaker: "agent", text: "Hello" },
      { offset_seconds: 0, text: "Hello" },
      { offset_seconds: 0, speaker: "agent", text: null },
    ];
    const state: MockState = {
      rpcBodies: [],
      summary: () => ({
        already_ingested: false,
        disposition: "answered_no_result",
        counts: zeroCounts,
        slot_change_requested: null,
      }),
    };

    await ingestTerminalRun({
      callRunId: runId,
      userId,
      raw: { id: "call_turn_shapes", status: "completed" },
      transcriptTurns: shapes as unknown as TranscriptTurnFixture[],
      structuredResult: null,
    }, deps(mock(state)));

    const turns = state.rpcBodies[0].p_transcript_turns as unknown[];
    if (turns.length !== shapes.length) throw new Error("a turn shape the column stores was dropped");
    for (const [index, shape] of shapes.entries()) {
      if (JSON.stringify(turns[index]) !== JSON.stringify(shape)) {
        throw new Error(`turn ${index} reached the RPC as ${JSON.stringify(turns[index])}`);
      }
    }
  });

  // Every spelling a person writes for one number must be masked. The wire text
  // is the measurement, and only the digits this test put in a status, a uuid
  // or a timestamp may survive. Five of the eight original spellings leaked
  // before the round-2 fix, the two comma spellings before the round-3 fix,
  // every separator and fullwidth spelling before the round-4 fix, every phone
  // whose first eight digits spell a real date before the round-5 fix, and a
  // phone whose gap held a letter before the round-6 fix.
  const phoneForms = [
    { text: "2026-09-12 4155550127", kept: "20260912" },
    { text: "415/555/0127", kept: "" },
    { text: "415\u00a0555\u00a00127", kept: "" },
    { text: "415_555_0127", kept: "" },
    { text: "4155 55 0127", kept: "" },
    { text: "+1 415 555 0127", kept: "" },
    { text: "415,555,0127", kept: "" },
    { text: "415, 555 0127", kept: "" },
    { text: "415\u2013555\u20130127", kept: "" },
    { text: "415\u2014555\u20140127", kept: "" },
    { text: "415\u200b555\u200b0127", kept: "" },
    { text: "415\u00ad555\u00ad0127", kept: "" },
    { text: "415\u2019555\u20190127", kept: "" },
    { text: "415'555'0127", kept: "" },
    { text: "415\\555\\0127", kept: "" },
    { text: "415: 555: 0127", kept: "" },
    { text: "415\u00b7555\u00b70127", kept: "" },
    { text: "\uff14\uff11\uff15\uff15\uff15\uff15\uff10\uff11\uff12\uff17", kept: "" },
    { text: "\uff08\uff14\uff11\uff15\uff09\uff15\uff15\uff15\uff10\uff11\uff12\uff17", kept: "" },
    // A grouping whose first eight digits spell a real date is a phone number,
    // not a timestamp. The lift spared it whole before the round-5 fix, so its
    // last digits never reached the seven digit minimum.
    { text: "4155-12-0127", kept: "" },
    { text: "2026-09-1241", kept: "" },
    { text: "2026-09-12 41", kept: "" },
    { text: "+4155-12-0127", kept: "" },
    { text: "4155-12-01-27", kept: "" },
    // A real date keeps its digits only while every fragment of its run holds
    // seven or more digits, as the comment above `maskRun` states.
    { text: "2026-09-12-415-555-0127", kept: "20260912" },
    { text: "2026-09-12T03:00:004155550127", kept: "20260912030000" },
    // A gap may hold any code point that is not a decimal digit, so a letter
    // joins the groups. The nine letter code points below are the ones people
    // write for an apostrophe or a joiner, and each one broke the run before
    // the round-6 fix. The two punctuation apostrophes above are the controls.
    { text: "415\u02b9555\u02b90127", kept: "" },
    { text: "415\u02bb555\u02bb0127", kept: "" },
    { text: "415\u02bc555\u02bc0127", kept: "" },
    { text: "415\u02bd555\u02bd0127", kept: "" },
    { text: "415\u02be555\u02be0127", kept: "" },
    { text: "415\u02bf555\u02bf0127", kept: "" },
    { text: "415\u0640555\u06400127", kept: "" },
    { text: "415\ua78c555\ua78c0127", kept: "" },
    { text: "415\u3031555\u30310127", kept: "" },
    { text: "415a555b0127", kept: "" },
    // A gap of four characters still joins, which is the stated bound.
    { text: "415 - 555 - 0127", kept: "" },
    { text: "415    555    0127", kept: "" },
  ];

  testFn("an RPC failure names its cause without a phone number or a key", async () => {
    const key = "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.c2lnbmF0dXJl";
    const ownDigits = (spared: string) => `40022007${spared}${runId.replace(/\D/g, "")}20260912030000`;
    for (const { text: phone, kept } of phoneForms) {
      const keptDigits = ownDigits(kept);
      const state: MockState = {
        rpcBodies: [],
        summary: () => { throw new Error("the failed RPC must not be summarised"); },
        rpcFailure: () =>
          Response.json({
            code: "22007",
            message: `invalid input syntax for type uuid: ${phone} for call run ${runId}`,
            details: `key ${key} due 2026-09-12T03:00:00`,
            hint: null,
          }, { status: 400 }),
      };
      const message = await ingestTerminalRun({
        callRunId: runId,
        userId,
        raw: { id: "call_rpc_failure", status: "completed" },
        transcriptTurns: [],
        structuredResult: null,
      }, { apiUrl: baseUrl, serviceRoleKey: key, fetch: mock(state) }).then(
        () => { throw new Error(`a failed RPC was accepted for ${phone}`); },
        (error: Error) => error.message,
      );
      for (
        const expected of [
          "call result ingestion failed",
          "HTTP 400",
          "22007",
          "invalid input syntax for type uuid",
          runId,
          "2026-09-12T03:00:00",
        ]
      ) {
        if (!message.includes(expected)) throw new Error(`${phone} lost ${expected}: ${message}`);
      }
      if (message.includes(key) || message.includes("eyJ")) {
        throw new Error(`the thrown cause leaked a key for ${phone}: ${message}`);
      }
      if (!message.includes("[masked number]")) throw new Error(`${phone} was not masked: ${message}`);
      const digits = message.replace(/\D/g, "");
      if (digits !== keptDigits) {
        throw new Error(`${phone} left the digits ${digits} in the cause: ${message}`);
      }
    }
  });

  // The caller reads the joined cause, so the join is what the masker must see.
  // The reviewer split a number across the message and the details fields, and
  // the per part scrub let both halves through.
  testFn("a number split across two response fields still masks", async () => {
    const state: MockState = {
      rpcBodies: [],
      summary: () => { throw new Error("the failed RPC must not be summarised"); },
      rpcFailure: () =>
        Response.json({
          code: "22007",
          message: "invalid input syntax for type uuid: 415-555",
          details: `0127" for call run ${runId}`,
          hint: null,
        }, { status: 400 }),
    };
    const message = await ingestTerminalRun({
      callRunId: runId,
      userId,
      raw: { id: "call_split_fields", status: "completed" },
      transcriptTurns: [],
      structuredResult: null,
    }, deps(mock(state))).then(
      () => { throw new Error("a failed RPC was accepted"); },
      (error: Error) => error.message,
    );
    if (!message.includes("[masked number]")) {
      throw new Error(`a number split across two fields reached the cause: ${message}`);
    }
    const digits = message.replace(/\D/g, "");
    if (digits !== `40022007${runId.replace(/\D/g, "")}`) {
      throw new Error(`the split number left the digits ${digits} in the cause: ${message}`);
    }
  });

  // The masker cannot tell a number from a count. The comment above
  // `PHONE_SCAN` names every shape it eats, and this test measures each one.
  // The second half measures the other direction, which is that a value this
  // module would store keeps its digits while the digits beside it mask.
  const causeOf = async (shape: string): Promise<string> => {
    const state: MockState = {
      rpcBodies: [],
      summary: () => { throw new Error("the failed RPC must not be summarised"); },
      rpcFailure: () =>
        Response.json({ code: "22007", message: shape, details: null, hint: null }, { status: 400 }),
    };
    return await ingestTerminalRun({
      callRunId: runId,
      userId,
      raw: { id: "call_over_match", status: "completed" },
      transcriptTurns: [],
      structuredResult: null,
    }, deps(mock(state))).then(
      () => { throw new Error(`a failed RPC was accepted for ${shape}`); },
      (error: Error) => error.message,
    );
  };

  const overMatched = [
    "value 2147483648 is out of range for type integer",
    "deno 1.2.3.4.5.6.7",
    "at 10:00:00.123456 the run started",
    "paid 1,234,567.89 today",
    "pi is 3.1415926535 exactly",
    "scores 1, 2, 3, 4, 5, 6, 7 today",
    "the id 20260912030000 is stored",
    "due 2026-13-45 and nothing else",
    "due 2026-9-12 with 415-555-0127",
  ];

  testFn("every shape the masker over-matches masks, and a stored value keeps its digits", async () => {
    for (const shape of overMatched) {
      const message = await causeOf(shape);
      if (!message.includes("[masked number]")) {
        throw new Error(`an over-matched shape kept its digits: ${message}`);
      }
    }
    const timestamp = await causeOf("due 2026-09-12T03:00:00 and 415-555-0127 beside it");
    if (!timestamp.includes("2026-09-12T03:00:00")) {
      throw new Error(`a stored timestamp lost its digits: ${timestamp}`);
    }
    if (timestamp.replace(/\D/g, "").includes("4155550127")) {
      throw new Error(`the number beside the timestamp kept its digits: ${timestamp}`);
    }
    const uuid = await causeOf(`run ${runId} 4155550127 beside it`);
    if (uuid.replace(/\D/g, "") !== `40022007${runId.replace(/\D/g, "")}`) {
      throw new Error(`a uuid beside a number did not keep its digits alone: ${uuid}`);
    }
    // The gap bound keeps two unrelated numbers apart. The comment states four
    // characters as the widest gap that joins, so the space separated `has`
    // never joins the count to the id beside it.
    const bounded = await causeOf("the id 20260912030000 has 5 items");
    if (bounded.replace(/\D/g, "") !== "400220075") {
      throw new Error(`the gap bound joined two unrelated numbers: ${bounded}`);
    }
  });

  // The comment above `maskRun` states that a timestamp keeps its digits only
  // while every fragment of its run holds seven or more digits. Two stored
  // values written side by side leave a zero digit fragment, which is too
  // short, so that whole run masks. Before the round-6 fix both values came
  // back whole and no digit of the run masked.
  const storedPairs = [
    "due 2026-09-12:2026-09-12",
    "due 2026-09-12-2026-09-12",
    "due 2026-09-12T03:00:00 2026-09-12T03:00:00",
  ];

  testFn("a run of two stored values masks whole", async () => {
    for (const shape of storedPairs) {
      const message = await causeOf(shape);
      if (message.replace(/\D/g, "") !== "40022007") {
        throw new Error(`a run of two stored values kept digits: ${message}`);
      }
    }
  });

  // The specification gives four dispositions, and this module is their only
  // writer for a run ingestion finalises. A failed run and a canceled run each
  // take their own, with a result and without one, because the terminal state
  // decides before the result does. The completed pair is already driven by the
  // fixtures above, which write `answered_extracted` and `answered_no_result`.
  testFn("every terminal state takes its own disposition", async () => {
    const captured = {
      captured_items: [{ text: "Continental", evidence_offset_seconds: 44 }],
      retired_items: [],
    };
    const cases: [string, unknown, string][] = [
      ["failed", captured, "not_answered"],
      ["failed", null, "not_answered"],
      ["canceled", captured, "canceled"],
      ["canceled", null, "canceled"],
    ];
    for (const [status, result, expected] of cases) {
      const state: MockState = {
        rpcBodies: [],
        summary: () => ({
          already_ingested: false,
          disposition: expected,
          counts: zeroCounts,
          slot_change_requested: null,
        }),
      };
      const answer = await ingestTerminalRun({
        callRunId: runId,
        userId,
        raw: { id: `call_${status}`, status },
        transcriptTurns: [],
        structuredResult: result,
      }, deps(mock(state)));
      const body = state.rpcBodies[0];
      if (body.p_state !== status || body.p_disposition !== expected) {
        throw new Error(`a ${status} call was stored as ${String(body.p_state)} ${String(body.p_disposition)}`);
      }
      if (answer.disposition !== expected) {
        throw new Error(`a ${status} call reported the disposition ${answer.disposition}`);
      }
    }
  });

  // A validation failure is terminal under CALL-E's own status name. The run
  // takes the `no_result` state and the disposition the spec gives that case.
  testFn("a failed result validation lands as no_result", async () => {
    for (const status of ["result_validation_failed", "call.result_validation_failed"]) {
      const state: MockState = {
        rpcBodies: [],
        summary: () => ({
          already_ingested: false,
          disposition: "answered_no_result",
          counts: zeroCounts,
          slot_change_requested: null,
        }),
      };
      await ingestTerminalRun({
        callRunId: runId,
        userId,
        raw: { id: "call_t2_10_validation_failed", status },
        transcriptTurns: [],
        structuredResult: null,
      }, deps(mock(state)));
      const body = state.rpcBodies[0];
      if (body.p_state !== "no_result" || body.p_disposition !== "answered_no_result") {
        throw new Error(`a ${status} call was stored as ${String(body.p_state)} ${String(body.p_disposition)}`);
      }
    }
  });

  testFn("rejects an unparseable source before any write", async () => {
    for (const [callRunId, user, expected] of [
      ["", userId, "call run id"],
      [runId, "", "user id"],
    ]) {
      let called = false;
      await ingestTerminalRun({
        callRunId,
        userId: user,
        raw: { status: "completed" },
        transcriptTurns: [],
        structuredResult: null,
      }, deps(() => {
        called = true;
        throw new Error("fetch must not run for an unparseable source");
      })).then(() => {
        throw new Error(`${expected} was accepted`);
      }, (error) => {
        if (!(error instanceof Error) || !error.message.includes(expected)) throw error;
      });
      if (called) throw new Error("an unparseable source reached the database");
    }
  });
}
