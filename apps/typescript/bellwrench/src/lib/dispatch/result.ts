import type {
  PriceType,
  VendorAvailability,
  VendorCallResult,
} from "./types";

const RESULT_KEYS = [
  "availability",
  "currency",
  "constraints",
  "earliest_eta",
  "price_amount",
  "price_type",
].sort();

const AVAILABILITIES = new Set<VendorAvailability>([
  "available",
  "unavailable",
  "unknown",
]);
const PRICE_TYPES = new Set<PriceType>([
  "fixed",
  "estimate",
  "quote_required",
  "not_provided",
]);
const SAFE_FAILURE_CODE = /^[A-Za-z0-9_-]{1,64}$/;

export interface ParsedVendorResult {
  availability: VendorAvailability;
  earliestEta: string | null;
  priceType: PriceType;
  priceAmount: number | null;
  currency: string | null;
  constraints: string[];
}

export interface TerminalCallInput {
  vendorId: string;
  vendorName: string;
  callId: string;
  status: string;
  taskCompleted: boolean | null;
  completionConfidence: unknown;
  summary: unknown;
  evidence: unknown;
  failureCode: unknown;
  recipientStatus: unknown;
  structuredResult: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedString(value: unknown, maximum: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized && normalized.length <= maximum ? normalized : null;
}

function normalizeEta(value: unknown): string | null | undefined {
  if (value === "unknown") return null;
  return (
    typeof value === "string" &&
    value.length <= 64 &&
    value.trim() === value &&
    Number.isFinite(Date.parse(value))
  ) ? value : undefined;
}

function validConstraints(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= 12 &&
    value.every(
      (item) =>
        typeof item === "string" &&
        item.trim() === item &&
        item.length > 0 &&
        item.length <= 240,
    )
  );
}

export function parseVendorStructuredResult(
  value: unknown,
): ParsedVendorResult | null {
  if (!isRecord(value)) return null;
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(RESULT_KEYS)) {
    return null;
  }

  const availability = value.availability;
  const priceType = value.price_type;
  const earliestEta = normalizeEta(value.earliest_eta);
  if (
    typeof availability !== "string" ||
    !AVAILABILITIES.has(availability as VendorAvailability) ||
    typeof priceType !== "string" ||
    !PRICE_TYPES.has(priceType as PriceType) ||
    earliestEta === undefined ||
    !validConstraints(value.constraints)
  ) {
    return null;
  }

  const priceAmount = value.price_amount;
  const currency = value.currency;
  const hasQuotedPrice = priceType === "fixed" || priceType === "estimate";
  let normalizedPriceAmount: number | null = null;
  let normalizedCurrency: string | null = null;
  if (hasQuotedPrice) {
    if (
      typeof priceAmount !== "string" ||
      !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(priceAmount) ||
      typeof currency !== "string" ||
      !/^[A-Z]{3}$/.test(currency)
    ) {
      return null;
    }
    normalizedPriceAmount = Number(priceAmount);
    if (!Number.isFinite(normalizedPriceAmount)) return null;
    normalizedCurrency = currency;
  } else if (priceAmount !== "unknown" || currency !== "unknown") {
    return null;
  }

  return {
    availability: availability as VendorAvailability,
    earliestEta,
    priceType: priceType as PriceType,
    priceAmount: normalizedPriceAmount,
    currency: normalizedCurrency,
    constraints: [...value.constraints],
  };
}

function confidence(value: unknown) {
  if (!isRecord(value)) return { label: null, score: null };
  const label = boundedString(value.label, 64);
  const score = value.score;
  return {
    label,
    score:
      typeof score === "number" && Number.isFinite(score) && score >= 0 && score <= 1
        ? score
        : null,
  };
}

function safeStringList(value: unknown, maximumItems: number, maximumLength: number) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => boundedString(item, maximumLength))
    .filter((item): item is string => item !== null)
    .slice(0, maximumItems);
}

function emptyFields() {
  return {
    availability: "unknown" as const,
    earliestEta: null,
    priceType: "not_provided" as const,
    priceAmount: null,
    currency: null,
    constraints: [],
  };
}

function publicFailureCode(value: unknown, fallback: string) {
  return typeof value === "string" && SAFE_FAILURE_CODE.test(value)
    ? value
    : fallback;
}

export function classifyTerminalCall(input: TerminalCallInput): VendorCallResult {
  const recipientStatus =
    typeof input.recipientStatus === "string" ? input.recipientStatus : null;
  const base = {
    vendorId: input.vendorId,
    vendorName: input.vendorName,
    callId: input.callId,
    callStatus: input.status,
    recipientStatus,
    taskCompleted: input.taskCompleted,
  };

  if (input.status === "failed" || input.status === "canceled") {
    return {
      ...base,
      status: "failed",
      ...emptyFields(),
      completionConfidence: null,
      confidenceScore: null,
      summary: null,
      evidence: [],
      failureCode: publicFailureCode(input.failureCode, "CALL_NOT_COMPLETED"),
    };
  }

  const parsed = parseVendorStructuredResult(input.structuredResult);
  const completion = confidence(input.completionConfidence);
  const summary = boundedString(input.summary, 500);
  const evidence = safeStringList(input.evidence, 12, 500);
  const verified =
    input.status === "completed" &&
    input.taskCompleted === true &&
    recipientStatus === "completed" &&
    completion.score !== null &&
    completion.score >= 0.5 &&
    parsed !== null &&
    evidence.length > 0;

  return {
    ...base,
    status: verified ? "verified" : "incomplete",
    ...(parsed ?? emptyFields()),
    completionConfidence: completion.label,
    confidenceScore: completion.score,
    summary,
    evidence,
    failureCode: verified ? null : "RESULT_INCOMPLETE",
  };
}
