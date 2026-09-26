import type {
  DispatchApiResponse,
  DispatchRequest,
  VendorCallResult,
} from "./types";
import { isDispatchRequest } from "./validation";

export const PENDING_DISPATCH_KEY = "bellwrench.pending-dispatch.v1";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface PendingDispatchIntent {
  version: 1;
  phase: "preview" | "review";
  request: DispatchRequest;
  response: DispatchApiResponse | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nullableString(value: unknown) {
  return value === null || typeof value === "string";
}

function stringArray(value: unknown) {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isVendorCallResult(value: unknown): value is VendorCallResult {
  if (!isRecord(value)) return false;
  return (
    typeof value.vendorId === "string" &&
    typeof value.vendorName === "string" &&
    ["verified", "incomplete", "failed", "unknown"].includes(
      String(value.status),
    ) &&
    nullableString(value.callId) &&
    nullableString(value.callStatus) &&
    nullableString(value.recipientStatus) &&
    (value.taskCompleted === null || typeof value.taskCompleted === "boolean") &&
    ["available", "unavailable", "unknown"].includes(
      String(value.availability),
    ) &&
    nullableString(value.earliestEta) &&
    ["fixed", "estimate", "quote_required", "not_provided"].includes(
      String(value.priceType),
    ) &&
    (value.priceAmount === null || typeof value.priceAmount === "number") &&
    nullableString(value.currency) &&
    stringArray(value.constraints) &&
    nullableString(value.completionConfidence) &&
    (value.confidenceScore === null ||
      typeof value.confidenceScore === "number") &&
    nullableString(value.summary) &&
    stringArray(value.evidence) &&
    nullableString(value.failureCode)
  );
}

function isDispatchApiResponse(value: unknown): value is DispatchApiResponse {
  if (!isRecord(value) || typeof value.message !== "string") return false;
  if (
    value.status !== undefined &&
    !["completed", "partial", "failed", "unresolved"].includes(
      String(value.status),
    )
  ) {
    return false;
  }
  if (value.code !== undefined && typeof value.code !== "string") return false;
  if (
    value.results !== undefined &&
    (!Array.isArray(value.results) ||
      !value.results.every(isVendorCallResult))
  ) {
    return false;
  }
  if (
    value.errors !== undefined &&
    (!Array.isArray(value.errors) ||
      !value.errors.every(
        (error) =>
          isRecord(error) &&
          typeof error.field === "string" &&
          typeof error.message === "string",
      ))
  ) {
    return false;
  }
  return true;
}

function isPendingDispatchIntent(value: unknown): value is PendingDispatchIntent {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    (value.phase !== "preview" && value.phase !== "review") ||
    !isDispatchRequest(value.request)
  ) {
    return false;
  }
  if (value.phase === "preview") return value.response === null;
  return (
    isDispatchApiResponse(value.response) &&
    Array.isArray(value.response.results) &&
    value.response.results.length > 0
  );
}

function withoutConfirmation(request: DispatchRequest): DispatchRequest {
  return { ...request, confirmedRealCalls: false };
}

export function savePendingIntent(
  storage: StorageLike,
  intent: PendingDispatchIntent,
) {
  storage.setItem(
    PENDING_DISPATCH_KEY,
    JSON.stringify({
      ...intent,
      request: withoutConfirmation(intent.request),
    }),
  );
}

export function loadPendingIntent(
  storage: StorageLike,
): PendingDispatchIntent | null {
  const raw = storage.getItem(PENDING_DISPATCH_KEY);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isPendingDispatchIntent(parsed)) return null;
    return {
      ...parsed,
      request: withoutConfirmation(parsed.request),
    };
  } catch {
    return null;
  }
}

export function clearPendingIntent(storage: StorageLike) {
  storage.removeItem(PENDING_DISPATCH_KEY);
}
