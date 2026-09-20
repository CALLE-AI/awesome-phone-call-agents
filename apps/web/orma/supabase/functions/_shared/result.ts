/** Strict parser for the CALL-E result_schema in docs/calle-call.md. */

export type Mood = "ok" | "low" | "stressed" | "energised" | "unknown";
export type SlotChangeRequested = "yes" | "no" | "unknown";

export interface CapturedItemResult {
  text: string;
  evidence_offset_seconds: number;
}

export interface RetiredItemResult {
  item_id: string;
  evidence_offset_seconds: number;
}

export interface CommitmentResult {
  item_id: string;
  due?: string;
  evidence_offset_seconds: number;
}

export interface StructuredCallResult {
  captured_items: CapturedItemResult[];
  retired_items: RetiredItemResult[];
  commitments?: CommitmentResult[];
  slot_change_requested?: SlotChangeRequested;
  slot_change_time?: string;
  mood?: Mood;
}

export interface ParsedStructuredResult {
  result: StructuredCallResult | null;
  reason: string | null;
}

const moods = new Set<Mood>(["ok", "low", "stressed", "energised", "unknown"]);
const slotChangeRequests = new Set<SlotChangeRequested>(["yes", "no", "unknown"]);

function failure(reason: string): ParsedStructuredResult {
  return { result: null, reason };
}

function object(value: unknown, path: string): Record<string, unknown> | string {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    return `${path} must be an object`;
  }

  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  path: string,
  allowed: readonly string[],
  required: readonly string[],
): string | null {
  for (const key of required) {
    if (!(key in value)) return `${path}.${key} is required`;
  }

  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) return `${path}.${key} is not allowed`;
  }

  return null;
}

function evidenceOffset(value: unknown, path: string): number | string {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return `${path} must be an integer`;
  }

  return value;
}

function string(value: unknown, path: string): string | string[] {
  return typeof value === "string" ? value : [`${path} must be a string`];
}

function parseCapturedItem(value: unknown, path: string): CapturedItemResult | string {
  const candidate = object(value, path);
  if (typeof candidate === "string") return candidate;

  const keyError = exactKeys(candidate, path, ["text", "evidence_offset_seconds"], [
    "text",
    "evidence_offset_seconds",
  ]);
  if (keyError) return keyError;

  const text = string(candidate.text, `${path}.text`);
  if (Array.isArray(text)) return text[0];
  const offset = evidenceOffset(candidate.evidence_offset_seconds, `${path}.evidence_offset_seconds`);
  if (typeof offset === "string") return offset;

  return { text, evidence_offset_seconds: offset };
}

function parseRetiredItem(value: unknown, path: string): RetiredItemResult | string {
  const candidate = object(value, path);
  if (typeof candidate === "string") return candidate;

  const keyError = exactKeys(candidate, path, ["item_id", "evidence_offset_seconds"], [
    "item_id",
    "evidence_offset_seconds",
  ]);
  if (keyError) return keyError;

  const itemId = string(candidate.item_id, `${path}.item_id`);
  if (Array.isArray(itemId)) return itemId[0];
  const offset = evidenceOffset(candidate.evidence_offset_seconds, `${path}.evidence_offset_seconds`);
  if (typeof offset === "string") return offset;

  return { item_id: itemId, evidence_offset_seconds: offset };
}

function parseCommitment(value: unknown, path: string): CommitmentResult | string {
  const candidate = object(value, path);
  if (typeof candidate === "string") return candidate;

  const keyError = exactKeys(candidate, path, ["item_id", "due", "evidence_offset_seconds"], [
    "item_id",
    "evidence_offset_seconds",
  ]);
  if (keyError) return keyError;

  const itemId = string(candidate.item_id, `${path}.item_id`);
  if (Array.isArray(itemId)) return itemId[0];
  const offset = evidenceOffset(candidate.evidence_offset_seconds, `${path}.evidence_offset_seconds`);
  if (typeof offset === "string") return offset;

  if ("due" in candidate) {
    const due = string(candidate.due, `${path}.due`);
    if (Array.isArray(due)) return due[0];
    return { item_id: itemId, due, evidence_offset_seconds: offset };
  }

  return { item_id: itemId, evidence_offset_seconds: offset };
}

function parseArray<T>(
  value: unknown,
  path: string,
  parser: (value: unknown, path: string) => T | string,
): T[] | string {
  if (!Array.isArray(value)) return `${path} must be an array`;

  const parsed: T[] = [];
  for (const [index, item] of value.entries()) {
    const parsedItem = parser(item, `${path}[${index}]`);
    if (typeof parsedItem === "string") return parsedItem;
    parsed.push(parsedItem);
  }

  return parsed;
}

/**
 * Returns the complete validated object, or null with a durable failure reason.
 * Callers must persist only a non-null result.
 */
export function parseStructuredResult(value: unknown): ParsedStructuredResult {
  const candidate = object(value, "structured_result");
  if (typeof candidate === "string") return failure(candidate);

  const keyError = exactKeys(
    candidate,
    "structured_result",
    [
      "captured_items",
      "retired_items",
      "commitments",
      "slot_change_requested",
      "slot_change_time",
      "mood",
    ],
    ["captured_items", "retired_items"],
  );
  if (keyError) return failure(keyError);

  const capturedItems = parseArray(candidate.captured_items, "structured_result.captured_items", parseCapturedItem);
  if (typeof capturedItems === "string") return failure(capturedItems);

  const retiredItems = parseArray(candidate.retired_items, "structured_result.retired_items", parseRetiredItem);
  if (typeof retiredItems === "string") return failure(retiredItems);

  const result: StructuredCallResult = {
    captured_items: capturedItems,
    retired_items: retiredItems,
  };

  if ("commitments" in candidate) {
    const commitments = parseArray(candidate.commitments, "structured_result.commitments", parseCommitment);
    if (typeof commitments === "string") return failure(commitments);
    result.commitments = commitments;
  }

  if ("slot_change_requested" in candidate) {
    const slotChangeRequested = candidate.slot_change_requested;
    if (typeof slotChangeRequested !== "string" || !slotChangeRequests.has(slotChangeRequested as SlotChangeRequested)) {
      return failure("structured_result.slot_change_requested must be yes, no, or unknown");
    }
    result.slot_change_requested = slotChangeRequested as SlotChangeRequested;
  }

  if ("slot_change_time" in candidate) {
    const slotChangeTime = string(candidate.slot_change_time, "structured_result.slot_change_time");
    if (Array.isArray(slotChangeTime)) return failure(slotChangeTime[0]);
    result.slot_change_time = slotChangeTime;
  }

  if ("mood" in candidate) {
    const mood = candidate.mood;
    if (typeof mood !== "string" || !moods.has(mood as Mood)) {
      return failure("structured_result.mood has an invalid value");
    }
    result.mood = mood as Mood;
  }

  return { result, reason: null };
}
