import crypto from "node:crypto";
import type { QuoteRequest, Vendor } from "./types.js";

export function buildTask(request: QuoteRequest, vendor: Vendor): string {
  const requirements = request.item.must_haves.map((item) => `- ${item}`).join("\n");
  return [
    `Call ${vendor.phone} for ${request.buyer.business_name}.`,
    "Start by saying you are an automated assistant calling with permission for a business purchasing task.",
    `Ask ${vendor.name} for a quote for ${request.item.quantity} ${request.item.name}.`,
    "Requirements:",
    requirements,
    "Collect unit price, total price, currency, availability, lead time, minimum order, and whether a human callback is needed.",
    request.policy.allow_voicemail
      ? "If voicemail answers, leave only the business name, item, quantity, and a request to call back. Do not include private details."
      : "If voicemail answers, do not leave a detailed message; mark callback_needed.",
  ].join("\n");
}

export function resultSchema(): Record<string, unknown> {
  return {
    type: "object",
    required: [
      "outcome",
      "unit_price",
      "total_price",
      "currency",
      "availability",
      "lead_time",
      "minimum_order",
      "callback_required"
    ],
    properties: {
      outcome: {
        type: "string",
        enum: ["quote_received", "not_available", "callback_needed", "unreachable", "outcome_unknown"]
      },
      unit_price: { type: ["number", "null"] },
      total_price: { type: ["number", "null"] },
      currency: { type: ["string", "null"] },
      availability: { type: "string" },
      lead_time: { type: "string" },
      minimum_order: { type: "string" },
      callback_required: { type: "boolean" }
    }
  };
}

export function previewText(request: QuoteRequest): string {
  const vendors = request.vendors
    .map((vendor, index) => `${index + 1}. ${vendor.name} ${vendor.phone} (${vendor.source})`)
    .join("\n");
  return [
    `QuoteChaser preview for ${request.request_id}`,
    "",
    `Buyer: ${request.buyer.business_name} (${request.buyer.contact_name})`,
    `Item: ${request.item.quantity} ${request.item.name}`,
    "Must haves:",
    ...request.item.must_haves.map((item) => `- ${item}`),
    "",
    "Vendors:",
    vendors,
    "",
    "Allowed disclosure:",
    ...request.max_disclosure.map((item) => `- ${item}`),
    "",
    `Voicemail: ${request.policy.allow_voicemail ? "limited callback message allowed" : "no detailed voicemail"}`,
    `Receipt: ${previewReceipt(request)}`
  ].join("\n");
}

export function previewReceipt(request: QuoteRequest): string {
  return crypto.createHash("sha256").update(JSON.stringify(request)).digest("hex");
}
