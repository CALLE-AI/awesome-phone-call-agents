import { countryCode } from "./phone.ts";
import { holdResultSchema, quoteResultSchema } from "./schema.ts";

export interface Vendor {
  id: string;
  name: string;
  phone: string;
  region: string;
  /** Why this business may call them, e.g. "Existing approved supplier relationship". */
  authorizationNote: string;
}

export interface QuoteRequest {
  id: string;
  item: string;
  specification: string;
  /** "<number> <unit>", e.g. "20 kg"; the ranking compares quotes in this unit. */
  quantity: string;
  deadline: string;
  substitutes: boolean;
  buyerBusiness: string;
  buyerName: string;
  /** IANA zone the supplier's times are interpreted in. */
  timeZone: string;
  vendors: Vendor[];
}

/** Stable per request, vendor and purpose, so a retried dispatch returns the original call. */
export const idempotencyKey = (requestId: string, vendorId: string, purpose: "quote" | "hold") =>
  `procurepulse:${requestId}:${vendorId}:${purpose}:v1`;

const today = (timeZone: string) => new Intl.DateTimeFormat("en-US", { dateStyle: "full", timeZone }).format(new Date());

function recipients(vendor: Vendor) {
  return [{ phones: [vendor.phone], locale: "en-US", region: countryCode(vendor.region) }];
}

/**
 * The quote call. The task identifies the agent as AI and the business it represents in its
 * first sentence, asks outcome-focused questions every supplier hears identically, and
 * forbids anything that could become a commitment. The phone number is never in the task.
 */
export function quoteCallBody(request: QuoteRequest, vendor: Vendor, webhookUrl: string | null) {
  const substitutions = request.substitutes
    ? "A close substitute is acceptable only if they name it exactly."
    : "No substitutes are acceptable.";
  const task = `You are ProcurePulse, an AI assistant calling ${vendor.name} on behalf of ${request.buyerBusiness} (buyer: ${request.buyerName}). In your first sentence say you are an AI assistant calling for ${request.buyerBusiness}, an existing customer.

Ask whether they can supply ${request.quantity} of ${request.item} (${request.specification}) by ${request.deadline}. ${substitutions} Today is ${today(request.timeZone)}; times are in ${request.timeZone}.

Collect, in a natural conversation: how much they can supply and in what unit, the firm price per unit, any delivery or other fees, pickup or delivery, when it would be ready, how long the price holds, any conditions, and the name of the person quoting. If an answer is vague, ask once for a firm figure; if they still cannot give one, accept it and move on.

Rules: this is a quote request only. Never place an order, ask for a hold, accept terms, give or ask for payment details, or imply a purchase commitment. Thank them and end the call politely.`;
  return {
    task,
    recipients: recipients(vendor),
    recipient_result_schema: quoteResultSchema,
    metadata: { request_id: request.id, vendor_id: vendor.id, purpose: "supplier_quote" },
    ...(webhookUrl ? { webhook_url: webhookUrl } : {}),
  };
}

/** The hold call exists only after an internal approval plus a second explicit confirmation. */
export function holdCallBody(request: QuoteRequest, vendor: Vendor, webhookUrl: string | null) {
  const task = `You are ProcurePulse, an AI assistant calling ${vendor.name} on behalf of ${request.buyerBusiness} (buyer: ${request.buyerName}). In your first sentence say you are an AI assistant calling for ${request.buyerBusiness} about the quote they gave earlier today.

The buyer has explicitly approved asking for a temporary hold of ${request.quantity} of ${request.item}. Ask whether they can set it aside without a purchase, and until what time. Say clearly that this is not an order, not a payment authorization, and not acceptance of any terms. Today is ${today(request.timeZone)}; times are in ${request.timeZone}.

Never give or ask for payment details. Thank them and end the call politely.`;
  return {
    task,
    recipients: recipients(vendor),
    recipient_result_schema: holdResultSchema,
    metadata: { request_id: request.id, vendor_id: vendor.id, purpose: "hold_request", human_approved: "true" },
    ...(webhookUrl ? { webhook_url: webhookUrl } : {}),
  };
}

export type CreateCallBody = ReturnType<typeof quoteCallBody> | ReturnType<typeof holdCallBody>;
