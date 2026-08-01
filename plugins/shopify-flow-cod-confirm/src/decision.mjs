/**
 * Pure decision core for the cash-on-delivery confirmation gate.
 *
 * Nothing in this file performs I/O. Every function takes plain data and returns
 * plain data so the ship / hold decision can be tested, replayed and audited
 * without Shopify, without CALL-E and without placing a phone call.
 */

/**
 * Prepended to every task string before it reaches CALL-E. A merchant-authored
 * confirmation script must not be able to turn the call into advice-giving.
 */
export const SAFETY_INSTRUCTION = [
  "You are confirming a retail delivery. Do not give medical, legal, financial",
  "or emergency advice. Do not take payment details. Do not ask for government",
  "identifiers. If the person asks for anything outside confirming this",
  "delivery, tell them to contact the merchant and end the call politely.",
].join(" ");

/** Terminal CALL-E statuses. Anything else means the call is still in flight. */
export const TERMINAL_STATUSES = new Set([
  "completed",
  "failed",
  "no_answer",
  "busy",
  "canceled",
  "cancelled",
  "voicemail",
]);

/** Statuses that mean CALL-E reached the recipient and produced a result. */
export const ANSWERED_STATUSES = new Set(["completed"]);

export const DECISION_SHIP = "ship";
export const DECISION_HOLD = "hold";
export const DECISION_RETRY = "retry";

const E164 = /^\+[1-9]\d{7,14}$/;

export function isE164(value) {
  return typeof value === "string" && E164.test(value.trim());
}

/**
 * Mask a phone number for logs, tags and summaries: keep the country prefix and
 * the last two digits only. Non-strings and short strings collapse to "***".
 */
export function maskPhone(value) {
  const text = String(value ?? "").trim();
  if (text.length < 6) return "***";
  const lead = text.startsWith("+") ? text.slice(0, 4) : text.slice(0, 3);
  return `${lead}${"*".repeat(Math.max(0, text.length - lead.length - 2))}${text.slice(-2)}`;
}

/** Recursively mask any phone-looking value inside an object before logging. */
export function maskDeep(value) {
  if (typeof value === "string") {
    return value.replace(/\+[1-9]\d{7,14}/g, (m) => maskPhone(m));
  }
  if (Array.isArray(value)) return value.map(maskDeep);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, maskDeep(v)]));
  }
  return value;
}

/**
 * Is this Shopify order actually cash-on-delivery?
 *
 * Shopify exposes COD as a gateway named "Cash on Delivery (COD)" on the
 * manual payment gateway, so match defensively across the fields that carry it.
 */
export function isCashOnDelivery(order) {
  const haystack = [
    order?.gateway,
    order?.payment_gateway_names,
    order?.processing_method,
    ...(Array.isArray(order?.payment_gateway_names) ? order.payment_gateway_names : []),
  ]
    .flat()
    .filter((v) => typeof v === "string")
    .join(" ")
    .toLowerCase();
  return haystack.includes("cash on delivery") || haystack.includes("cod") || haystack.includes("manual");
}

/**
 * A stable idempotency key for one (shop, order, attempt) triple.
 *
 * Shopify retries webhooks. Without this a retry means a second phone call to a
 * real customer, which is the single worst failure mode this gate can have.
 */
export function buildIdempotencyKey({ shopDomain, orderId, attempt = 1 }) {
  if (!shopDomain || !orderId) {
    throw new Error("buildIdempotencyKey requires shopDomain and orderId.");
  }
  return `cod-confirm:${shopDomain}:${orderId}:${attempt}`;
}

/** The structured result we ask CALL-E to fill in during the call. */
export const RESULT_SCHEMA = {
  type: "object",
  properties: {
    order_confirmed: {
      type: "boolean",
      description: "True only if the person explicitly confirmed they placed this order and still want it.",
    },
    address_correct: {
      type: "boolean",
      description: "True only if the person confirmed the delivery address read to them is correct.",
    },
    corrected_address: {
      type: "string",
      description: "The corrected delivery address if the person gave one, otherwise an empty string.",
    },
    preferred_delivery_window: {
      type: "string",
      description: "A delivery window the person asked for, otherwise an empty string.",
    },
    cancel_requested: {
      type: "boolean",
      description: "True if the person asked to cancel the order.",
    },
  },
  required: ["order_confirmed", "address_correct", "cancel_requested"],
};

/**
 * Render the confirmation script for one order.
 *
 * The script never states the order total before the person has confirmed who
 * they are, so a wrong number does not learn what someone bought.
 */
export function buildTask({ order, merchantName }) {
  const name = order?.customer?.first_name || "there";
  const items = (order?.line_items || [])
    .map((li) => `${li.quantity} x ${li.title}`)
    .join(", ");
  const address = formatAddress(order?.shipping_address);
  return [
    `You are calling on behalf of ${merchantName} about a cash-on-delivery order.`,
    `First ask if you are speaking to ${name}. If they say no, apologise and end the call without giving any order details.`,
    `If they say yes, tell them the order is ${items}, to be paid in cash on delivery, total ${order?.total_price} ${order?.currency}.`,
    `Ask them to confirm they placed this order and still want it.`,
    `Then read this delivery address back and ask if it is correct: ${address}.`,
    `If the address is wrong, ask for the correct one and repeat it back to check.`,
    `Ask if there is a delivery window they prefer.`,
    `Thank them and end the call. Do not offer discounts, do not take payment, do not promise a delivery date.`,
  ].join(" ");
}

export function formatAddress(addr) {
  if (!addr) return "no address on file";
  return [addr.address1, addr.address2, addr.city, addr.province, addr.zip, addr.country]
    .filter(Boolean)
    .join(", ");
}

/**
 * Turn a terminal CALL-E call into a shipping decision.
 *
 * This is the heart of the plugin: a merchant does not want a transcript, they
 * want a yes/no on whether to put the parcel on a van.
 *
 * @param {object} call     terminal CALL-E call object
 * @param {object} options  { attempt, maxAttempts }
 */
export function decide(call, { attempt = 1, maxAttempts = 2 } = {}) {
  const status = String(call?.status || "").toLowerCase();

  if (!TERMINAL_STATUSES.has(status)) {
    throw new Error(`decide() requires a terminal call status, received "${status || "(empty)"}".`);
  }

  // Unreached: not the customer's fault, and not billed by CALL-E. Retry once,
  // then hold rather than guessing.
  if (!ANSWERED_STATUSES.has(status)) {
    const canRetry = attempt < maxAttempts && status !== "canceled" && status !== "cancelled";
    return {
      decision: canRetry ? DECISION_RETRY : DECISION_HOLD,
      reason: `not_reached:${status}`,
      confirmed: false,
      addressCorrect: null,
      correctedAddress: "",
      deliveryWindow: "",
      nextAttempt: canRetry ? attempt + 1 : null,
    };
  }

  const result = call?.structured_result ?? call?.result ?? null;

  // The call connected but CALL-E could not fill the schema. This is a real,
  // frequently-ignored state: never read it as a confirmation.
  if (!result || typeof result !== "object") {
    return {
      decision: DECISION_HOLD,
      reason: "answered_no_structured_result",
      confirmed: false,
      addressCorrect: null,
      correctedAddress: "",
      deliveryWindow: "",
      nextAttempt: null,
    };
  }

  if (result.cancel_requested === true) {
    return {
      decision: DECISION_HOLD,
      reason: "customer_cancelled",
      confirmed: false,
      addressCorrect: result.address_correct ?? null,
      correctedAddress: "",
      deliveryWindow: "",
      nextAttempt: null,
    };
  }

  if (result.order_confirmed !== true) {
    return {
      decision: DECISION_HOLD,
      reason: "order_not_confirmed",
      confirmed: false,
      addressCorrect: result.address_correct ?? null,
      correctedAddress: String(result.corrected_address || ""),
      deliveryWindow: String(result.preferred_delivery_window || ""),
      nextAttempt: null,
    };
  }

  // Confirmed the order but the address was wrong and no correction was given:
  // shipping now means shipping to a known-bad address.
  const correctedAddress = String(result.corrected_address || "").trim();
  if (result.address_correct === false && !correctedAddress) {
    return {
      decision: DECISION_HOLD,
      reason: "address_wrong_no_correction",
      confirmed: true,
      addressCorrect: false,
      correctedAddress: "",
      deliveryWindow: String(result.preferred_delivery_window || ""),
      nextAttempt: null,
    };
  }

  return {
    decision: DECISION_SHIP,
    reason: correctedAddress ? "confirmed_with_address_correction" : "confirmed",
    confirmed: true,
    addressCorrect: result.address_correct !== false,
    correctedAddress,
    deliveryWindow: String(result.preferred_delivery_window || ""),
    nextAttempt: null,
  };
}

/**
 * The tags written back onto the Shopify order. A human in the warehouse reads
 * these, so they have to be unambiguous at a glance.
 */
export function tagsFor(verdict) {
  const base = ["cod-gate"];
  if (verdict.decision === DECISION_SHIP) base.push("cod-confirmed", "cod-ship");
  if (verdict.decision === DECISION_HOLD) base.push("cod-hold", `cod-hold-${verdict.reason.replace(/[^a-z0-9]+/gi, "-")}`);
  if (verdict.decision === DECISION_RETRY) base.push("cod-retry");
  if (verdict.correctedAddress) base.push("cod-address-corrected");
  return base;
}

/**
 * Merge new tags into Shopify's comma-separated tag string without dropping the
 * merchant's own tags or duplicating ours.
 */
export function mergeTags(existing, incoming) {
  const have = String(existing || "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  const seen = new Set(have.map((t) => t.toLowerCase()));
  for (const tag of incoming) {
    if (!seen.has(tag.toLowerCase())) {
      have.push(tag);
      seen.add(tag.toLowerCase());
    }
  }
  return have.join(", ");
}

/** The human-readable note appended to the order timeline. */
export function noteFor(verdict, { callId, phone }) {
  const lines = [
    `COD confirmation gate: ${verdict.decision.toUpperCase()} (${verdict.reason})`,
    `Called ${maskPhone(phone)} via CALL-E call ${callId || "(none)"}.`,
  ];
  if (verdict.correctedAddress) lines.push(`Customer corrected the address to: ${verdict.correctedAddress}`);
  if (verdict.deliveryWindow) lines.push(`Requested delivery window: ${verdict.deliveryWindow}`);
  return lines.join("\n");
}
