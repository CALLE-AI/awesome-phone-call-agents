/**
 * The gate itself: order in, ship / hold decision out, written back to Shopify.
 *
 * Kept separate from the HTTP server so it can be driven by the CLI, by a test,
 * or by a Shopify Flow HTTP action without duplicating the logic.
 */

import { AmbiguousCallError } from "./calle.mjs";
import {
  buildIdempotencyKey,
  buildTask,
  decide,
  formatAddress,
  isCashOnDelivery,
  isE164,
  maskDeep,
  maskPhone,
  mergeTags,
  noteFor,
  tagsFor,
  DECISION_HOLD,
  DECISION_RETRY,
} from "./decision.mjs";

/**
 * @param {object} deps
 * @param {import("./calle.mjs").CalleClient} deps.calle
 * @param {import("./shopify.mjs").ShopifyClient} [deps.shopify]  omitted in dry-run
 * @param {(event: object) => void} [deps.log]
 */
export function createGate({ calle, shopify, log = () => {} }) {
  /**
   * Run the gate for one order.
   *
   * @param {object} options
   * @param {object} options.order        Shopify order object
   * @param {string} options.shopDomain
   * @param {string} options.merchantName
   * @param {boolean} [options.dryRun]    when true: no call, no writeback
   * @param {number} [options.maxAttempts]
   */
  async function run({ order, shopDomain, merchantName, dryRun = false, maxAttempts = 2, pollOptions } = {}) {
    const orderId = order?.id;
    if (!orderId) throw new Error("Order is missing an id.");

    if (!isCashOnDelivery(order)) {
      const skipped = { decision: "skip", reason: "not_cash_on_delivery", orderId };
      log({ event: "skipped", ...skipped });
      return skipped;
    }

    const phone = (order?.shipping_address?.phone || order?.customer?.phone || order?.phone || "").trim();
    if (!isE164(phone)) {
      const verdict = {
        decision: DECISION_HOLD,
        reason: "no_usable_phone_number",
        confirmed: false,
        addressCorrect: null,
        correctedAddress: "",
        deliveryWindow: "",
        nextAttempt: null,
      };
      const written = dryRun ? null : await writeBack({ orderId, order, verdict, callId: null, phone });
      log({ event: "held", orderId, reason: verdict.reason });
      return { ...verdict, orderId, callId: null, written, dryRun };
    }

    const task = buildTask({ order, merchantName });

    if (dryRun) {
      // The no-call path. This is what a merchant runs first, and what a judge
      // can run with no credentials at all.
      return {
        decision: "preview",
        reason: "dry_run",
        orderId,
        shopDomain,
        phone: maskPhone(phone),
        address: formatAddress(order?.shipping_address),
        idempotencyKey: buildIdempotencyKey({ shopDomain, orderId, attempt: 1 }),
        task,
        dryRun: true,
      };
    }

    let attempt = 1;
    let lastVerdict = null;
    let lastCallId = null;

    while (attempt <= maxAttempts) {
      const idempotencyKey = buildIdempotencyKey({ shopDomain, orderId, attempt });
      let created;
      try {
        created = await calle.createCall({
          phone,
          task,
          metadata: { order_id: String(orderId), shop_domain: shopDomain, attempt: String(attempt) },
          idempotencyKey,
        });
      } catch (error) {
        if (error instanceof AmbiguousCallError) {
          // Never create a second call to a real customer to resolve doubt.
          const verdict = {
            decision: DECISION_HOLD,
            reason: "ambiguous_call_creation",
            confirmed: false,
            addressCorrect: null,
            correctedAddress: "",
            deliveryWindow: "",
            nextAttempt: null,
            idempotencyKey: error.idempotencyKey,
          };
          const written = await writeBack({ orderId, order, verdict, callId: null, phone });
          log({ event: "ambiguous", orderId, idempotencyKey: error.idempotencyKey });
          return { ...verdict, orderId, callId: null, written, dryRun: false };
        }
        throw error;
      }

      lastCallId = created.callId;
      log({ event: "call_created", orderId, callId: created.callId, attempt, phone: maskPhone(phone) });

      const { call, timedOut } = await calle.waitForTerminal(created.callId, pollOptions ?? {});
      if (timedOut) {
        const verdict = {
          decision: DECISION_HOLD,
          reason: "call_did_not_reach_terminal_state",
          confirmed: false,
          addressCorrect: null,
          correctedAddress: "",
          deliveryWindow: "",
          nextAttempt: null,
        };
        const written = await writeBack({ orderId, order, verdict, callId: created.callId, phone });
        log({ event: "timeout", orderId, callId: created.callId });
        return { ...verdict, orderId, callId: created.callId, written, dryRun: false };
      }

      lastVerdict = decide(call, { attempt, maxAttempts });
      log({ event: "decided", orderId, callId: created.callId, attempt, decision: lastVerdict.decision, reason: lastVerdict.reason });

      if (lastVerdict.decision !== DECISION_RETRY) break;
      attempt = lastVerdict.nextAttempt ?? attempt + 1;
    }

    const written = await writeBack({ orderId, order, verdict: lastVerdict, callId: lastCallId, phone });
    return { ...lastVerdict, orderId, callId: lastCallId, written, dryRun: false };
  }

  async function writeBack({ orderId, order, verdict, callId, phone }) {
    if (!shopify) return null;
    const tags = mergeTags(order?.tags, tagsFor(verdict));
    const note = noteFor(verdict, { callId, phone });
    const result = await shopify.writeVerdict(orderId, { tags, note });
    return maskDeep({ tags, note, orderId: result?.order?.id ?? orderId });
  }

  return { run };
}
