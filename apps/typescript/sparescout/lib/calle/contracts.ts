import type { Call, CallStatus, JsonObject } from "@call-e/calle";
import { getSupportedMarket, supportsMarketLocale } from "../markets.ts";

export type SourcingSupplier = {
  id: string;
  name: string;
  phone: string;
  area?: string;
};

export type SourcingRequest = {
  executionMode: "fixture" | "live";
  recipientConsentConfirmed: boolean;
  authorizedCallWindow: string;
  vehicle: string;
  part: string;
  fitmentReference: string;
  budgetAmount: number;
  currency: string;
  deliveryLocation: string;
  neededBy: string;
  countryCode: string;
  locale: string;
  suppliers: SourcingSupplier[];
};

export type SourcingCallPlan = {
  id: string;
  createdAt: string;
  expiresAt: string;
  request: SourcingRequest;
  task: string;
  aggregateResultSchema: JsonObject;
  recipientResultSchema: JsonObject;
};

export type NormalizedQuote = {
  supplierId: string;
  supplierName: string;
  status: string;
  result: JsonObject | null;
  summary: string | null;
  evidence: string[];
};

export type SourcingExecution = {
  mode: "fixture" | "live";
  callId: string;
  status: CallStatus | "completed";
  taskCompleted: boolean | null;
  completionConfidence: { score: number; label: string } | null;
  summary: string | null;
  evidence: string[];
  quotes: NormalizedQuote[];
  createdAt: string;
  completedAt: string | null;
};

export function isTerminalExecution(execution: SourcingExecution): boolean {
  return execution.status === "completed" || execution.status === "failed" || execution.status === "canceled";
}

const E164_PATTERN = /^\+[1-9]\d{7,14}$/;
const COUNTRY_PATTERN = /^[A-Z]{2}$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const LOCALE_PATTERN = /^[a-z]{2,3}(?:-[A-Z]{2})?$/;

function requiredText(value: unknown, field: string, maxLength = 180): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} is required.`);
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw new Error(`${field} must be ${maxLength} characters or fewer.`);
  }
  return normalized;
}

export function parseSourcingRequest(value: unknown): SourcingRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("A sourcing request is required.");
  }

  const input = value as Record<string, unknown>;
  if (input.executionMode !== "fixture" && input.executionMode !== "live") {
    throw new Error("executionMode must be fixture or live.");
  }
  const isLive = input.executionMode === "live";
  const recipientConsentConfirmed = input.recipientConsentConfirmed === true;
  if (isLive && !recipientConsentConfirmed) {
    throw new Error("Confirm that every listed business directly consented to this live pilot call.");
  }
  const authorizedCallWindow = isLive
    ? requiredText(input.authorizedCallWindow, "authorizedCallWindow", 120)
    : "No live call — fixture";
  const budgetAmount = Number(input.budgetAmount);
  if (!Number.isFinite(budgetAmount) || budgetAmount <= 0) {
    throw new Error("budgetAmount must be greater than zero.");
  }

  const countryCode = requiredText(input.countryCode, "countryCode", 2).toUpperCase();
  if (!COUNTRY_PATTERN.test(countryCode)) {
    throw new Error("countryCode must be a two-letter country code.");
  }

  const currency = requiredText(input.currency, "currency", 3).toUpperCase();
  if (!CURRENCY_PATTERN.test(currency)) {
    throw new Error("currency must be a three-letter currency code.");
  }

  const locale = requiredText(input.locale, "locale", 12);
  if (!LOCALE_PATTERN.test(locale)) {
    throw new Error("locale must look like en or en-KE.");
  }
  const market = getSupportedMarket(countryCode);
  if (!market) {
    throw new Error(`${countryCode} is not currently supported for CALL-E calling.`);
  }
  if (!supportsMarketLocale(countryCode, locale)) {
    throw new Error(`${locale} is not a supported CALL-E language for ${market.countryName}.`);
  }

  if (!Array.isArray(input.suppliers) || input.suppliers.length < 1 || input.suppliers.length > 10) {
    throw new Error("Choose between 1 and 10 suppliers.");
  }

  const suppliers = input.suppliers.map((candidate, index) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw new Error(`supplier ${index + 1} is invalid.`);
    }
    const supplier = candidate as Record<string, unknown>;
    const phone = requiredText(supplier.phone, `supplier ${index + 1} phone`, 16);
    if (!E164_PATTERN.test(phone)) {
      throw new Error(`supplier ${index + 1} phone must use E.164 format.`);
    }
    const parsed: SourcingSupplier = {
      id: requiredText(supplier.id, `supplier ${index + 1} id`, 80),
      name: requiredText(supplier.name, `supplier ${index + 1} name`, 120),
      phone,
    };
    if (typeof supplier.area === "string" && supplier.area.trim()) {
      parsed.area = supplier.area.trim().slice(0, 120);
    }
    return parsed;
  });

  if (new Set(suppliers.map((supplier) => supplier.id)).size !== suppliers.length) {
    throw new Error("Supplier ids must be unique.");
  }
  if (new Set(suppliers.map((supplier) => supplier.phone)).size !== suppliers.length) {
    throw new Error("Supplier phone numbers must be unique.");
  }

  return {
    executionMode: input.executionMode,
    recipientConsentConfirmed: isLive && recipientConsentConfirmed,
    authorizedCallWindow,
    vehicle: requiredText(input.vehicle, "vehicle"),
    part: requiredText(input.part, "part"),
    fitmentReference: requiredText(input.fitmentReference, "fitmentReference"),
    budgetAmount,
    currency,
    deliveryLocation: requiredText(input.deliveryLocation, "deliveryLocation"),
    neededBy: requiredText(input.neededBy, "neededBy", 80),
    countryCode,
    locale,
    suppliers,
  };
}

export function buildCallTask(request: SourcingRequest): string {
  const instructions = [
    "You are SpareScout, an AI calling assistant sourcing a vehicle part on the buyer's behalf.",
    "At the start of each conversation, clearly disclose that you are an AI assistant calling for a buyer to collect a quote.",
    `Ask whether a ${request.part} fits a ${request.vehicle} using fitment reference ${request.fitmentReference}.`,
    `Collect the exact brand, condition, price in ${request.currency}, available quantity, delivery availability to ${request.deliveryLocation}, and delivery timing for ${request.neededBy}.`,
    `The buyer's budget ceiling is ${request.currency} ${request.budgetAmount}. Do not negotiate beyond gathering the quoted terms.`,
    "Ask whether the item could be held after a separate confirmation, but do not reserve, order, purchase, pay for, or commit to anything.",
    "Do not accept a substitute part. Record unknown information as unknown instead of inferring it.",
    "This workflow is only for vehicle-part sourcing. Do not provide or solicit medical, legal, financial, or emergency advice. If an urgent safety issue is raised, end the sourcing task and direct the person to appropriate local help.",
  ];
  if (request.executionMode === "live") {
    instructions.push(
      `The operator attested that every listed business directly consented to this AI-assisted pilot call for the authorized window: ${request.authorizedCallWindow}.`,
      "If the recipient withdraws consent, asks not to be called, or says this is not an appropriate time, apologize, end the conversation promptly, and record the outcome without continuing the sourcing questions.",
    );
  }
  return instructions.join(" ");
}

export function buildAggregateResultSchema(): JsonObject {
  return {
    type: "object",
    additionalProperties: false,
    required: ["suppliers_contacted", "quotes_received", "compatible_quotes"],
    properties: {
      suppliers_contacted: { type: "integer", minimum: 0 },
      quotes_received: { type: "integer", minimum: 0 },
      compatible_quotes: { type: "integer", minimum: 0 },
    },
  };
}

export function buildRecipientResultSchema(currency: string): JsonObject {
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "part_found",
      "compatibility",
      "brand",
      "condition",
      "price_amount",
      "currency",
      "available_quantity",
      "delivery_available",
      "delivery_eta",
      "reservation_possible",
      "evidence",
      "notes",
    ],
    properties: {
      part_found: { type: "boolean" },
      compatibility: { type: "string", enum: ["confirmed", "rejected", "unknown"] },
      brand: { type: "string" },
      condition: { type: "string", enum: ["new", "used", "remanufactured", "unknown"] },
      price_amount: { type: "number", minimum: 0 },
      currency: { type: "string", enum: [currency] },
      available_quantity: { type: "integer", minimum: 0 },
      delivery_available: { type: "string", enum: ["yes", "no", "unknown"] },
      delivery_eta: { type: "string" },
      reservation_possible: { type: "string", enum: ["yes", "no", "unknown"] },
      evidence: { type: "array", items: { type: "string" }, maxItems: 8 },
      notes: { type: "string" },
    },
  };
}

export function createSourcingCallPlan(request: SourcingRequest, now = new Date()): SourcingCallPlan {
  const expiresAt = new Date(now.getTime() + 15 * 60 * 1000);
  return {
    id: crypto.randomUUID(),
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    request,
    task: buildCallTask(request),
    aggregateResultSchema: buildAggregateResultSchema(),
    recipientResultSchema: buildRecipientResultSchema(request.currency),
  };
}

export function maskPhone(phone: string): string {
  if (phone.length < 7) return "••••";
  return `${phone.slice(0, 4)} ${"•".repeat(Math.max(3, phone.length - 7))} ${phone.slice(-3)}`;
}

export function normalizeCall(call: Call, suppliers: SourcingSupplier[]): SourcingExecution {
  return {
    mode: "live",
    callId: call.id,
    status: call.status,
    taskCompleted: call.taskCompleted,
    completionConfidence: call.completionConfidence,
    summary: call.summary,
    evidence: call.evidence,
    quotes: call.recipients.map((recipient, index) => ({
      supplierId: suppliers[index]?.id ?? recipient.id,
      supplierName: suppliers[index]?.name ?? `Supplier ${index + 1}`,
      status: recipient.status,
      result: recipient.structuredResult,
      summary: recipient.summary,
      evidence: Array.isArray(recipient.structuredResult?.evidence)
        ? recipient.structuredResult.evidence.filter((item): item is string => typeof item === "string")
        : [],
    })),
    createdAt: call.createdAt,
    completedAt: call.completedAt,
  };
}
