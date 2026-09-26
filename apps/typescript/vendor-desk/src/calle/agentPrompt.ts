import { CalleResultSchema, VendorTask } from "../types";

/**
 * CALL-E's Phase 1 API/SDK takes a single natural-language `task` string
 * rather than a separate system prompt + turn-by-turn script. There is no
 * `recipient` field on POST /v1/calls (sending one 422s with extra_forbidden),
 * so the phone number is embedded directly in the task text instead.
 */
export function buildVendorTaskPrompt(task: VendorTask): string {
  return `Call ${task.phoneNumber}. You are calling ${task.vendorName} on behalf of a procurement buyer to get a quote.

Goal: find out whether they can supply ${task.targetQuantity} units of "${task.item}", and at what price.

Conversation order:
1. Introduce yourself briefly as calling to check stock and pricing for a bulk order.
2. Ask if they currently have "${task.item}" in stock, in a quantity of at least ${task.targetQuantity} units.
3. Ask for the unit price (per item), not just a total.
4. If they don't have it in stock or can't meet the quantity, ask what closest alternative they'd recommend.
5. Ask whether delivery is available for an order this size, or if it's pickup-only.
6. Before ending the call, get the first name of the person you spoke with.

Be courteous, concise, and don't repeat questions the rep has already answered. If you reach voicemail or an automated system, do not leave a message with pricing details — just end the call and report that no one was reached.`;
}

export const VENDOR_QUOTE_RESULT_SCHEMA: CalleResultSchema = {
  type: "object",
  required: ["in_stock"],
  properties: {
    in_stock: { type: "boolean" },
    unit_price: { type: "number" },
    alternative_offered: { type: "string" },
    delivery_available: { type: "boolean" },
    representative_name: { type: "string" },
    notes: { type: "string" },
  },
  additionalProperties: false,
};
