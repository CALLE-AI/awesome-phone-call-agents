import fs from "node:fs";
import type { QuoteRequest } from "./types.js";

export class QuoteRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuoteRequestError";
  }
}

const E164_RE = /^\+[1-9]\d{7,14}$/;
const SECRET_RE = /\b(?:\d[ -]*?){13,19}\b|\b(?:password|passcode|pin|ssn|social security|card number|bank account)\b/i;

export function loadQuoteRequest(path: string): QuoteRequest {
  const parsed = JSON.parse(fs.readFileSync(path, "utf8")) as unknown;
  return assertQuoteRequest(parsed);
}

export function assertQuoteRequest(value: unknown): QuoteRequest {
  const request = value as QuoteRequest;
  if (!request || typeof request !== "object") {
    throw new QuoteRequestError("Request must be a JSON object.");
  }
  requireString(request.request_id, "request_id");
  requireString(request.buyer?.business_name, "buyer.business_name");
  requireString(request.buyer?.contact_name, "buyer.contact_name");
  requireString(request.item?.name, "item.name");
  if (!Number.isInteger(request.item?.quantity) || request.item.quantity <= 0) {
    throw new QuoteRequestError("item.quantity must be a positive integer.");
  }
  if (!Array.isArray(request.item.must_haves) || request.item.must_haves.length === 0) {
    throw new QuoteRequestError("item.must_haves must contain at least one requirement.");
  }
  if (!Array.isArray(request.vendors) || request.vendors.length === 0) {
    throw new QuoteRequestError("vendors must contain at least one vendor.");
  }
  if (request.vendors.length > 8) {
    throw new QuoteRequestError("QuoteChaser caps each run at 8 vendors.");
  }
  for (const [index, vendor] of request.vendors.entries()) {
    requireString(vendor.name, `vendors[${index}].name`);
    requireString(vendor.source, `vendors[${index}].source`);
    requireString(vendor.phone, `vendors[${index}].phone`);
    if (!E164_RE.test(vendor.phone)) {
      throw new QuoteRequestError(`vendors[${index}].phone must be E.164, for example +14155550100.`);
    }
  }
  if (!Array.isArray(request.max_disclosure) || request.max_disclosure.length === 0) {
    throw new QuoteRequestError("max_disclosure must name what the caller may say.");
  }
  requireString(request.policy?.locale, "policy.locale");
  if (typeof request.policy.allow_voicemail !== "boolean") {
    throw new QuoteRequestError("policy.allow_voicemail must be true or false.");
  }
  const serialized = JSON.stringify(request);
  if (SECRET_RE.test(serialized)) {
    throw new QuoteRequestError("Request appears to contain a secret, payment detail, password, PIN or regulated identifier.");
  }
  return request;
}

export function maskPhone(phone: string): string {
  return `${phone.slice(0, 3)}${"*".repeat(Math.max(0, phone.length - 5))}${phone.slice(-2)}`;
}

function requireString(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new QuoteRequestError(`${name} is required.`);
  }
}
