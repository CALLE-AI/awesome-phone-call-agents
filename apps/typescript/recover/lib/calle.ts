import { CalleClient } from "@call-e/calle";
import type { Subscriber } from "./db";

// Get this from the CALL-E dashboard: https://dashboard.heycall-e.com/account/api-keys
// TODO(you): set CALLE_API_KEY in your .env.local before running any real call.
const client = new CalleClient({
  apiKey: process.env.CALLE_API_KEY!,
});

// The whole-call structured result we ask CALL-E to extract from the conversation.
// This is what turns "the agent talked to the customer" into something our
// dashboard/backend can act on programmatically.
export const paymentRecoveryResultSchema = {
  type: "object",
  required: ["decision", "evidence"],
  properties: {
    decision: {
      type: "string",
      enum: ["retry_now", "update_card", "pause_subscription", "no_answer", "unknown"],
      description:
        "What the customer decided to do about their failed payment. Use retry_now if they " +
        "want the charge attempted again immediately. Use update_card if they want to update " +
        "their payment method (a link will be sent separately). Use pause_subscription if they " +
        "asked to pause or cancel for now. Use no_answer if the call did not reach a human. " +
        "Use unknown if the evidence is ambiguous.",
    },
    evidence: {
      type: "string",
      description:
        "A short quote or paraphrase from the call that supports the decision, or an empty " +
        "string if no_answer.",
    },
  },
  additionalProperties: false,
} as const;

export type PaymentRecoveryDecision = "retry_now" | "update_card" | "pause_subscription" | "no_answer" | "unknown";

export interface RecoveryCallTask {
  task: string;
  recipient: { phone: string; region: string; locale: string };
}

/**
 * Builds the exact call task and recipient that would be sent to CALL-E,
 * WITHOUT placing any call. This is the "dry run" / preview step -- per this
 * repo's own safety conventions (see docs/safety-reference.md upstream:
 * "no-call preview", "dry-run by default"), a workflow that can ring a real
 * person's phone should let the operator see exactly what will be said and
 * to whom before it happens.
 */
export interface RecoveryCallSubscriberInput {
  name: string;
  plan_name: string;
  amount_cents: number;
  phone: string;
  region: string;
  locale: string;
}

export function buildRecoveryCallTask(subscriber: RecoveryCallSubscriberInput, failureReason: string): RecoveryCallTask {
  const amount = (subscriber.amount_cents / 100).toFixed(2);

  const task =
    `Call ${subscriber.name} about a failed payment for their "${subscriber.plan_name}" ` +
    `subscription ($${amount}). The payment failed because: ${failureReason}. ` +
    `Explain the issue in plain, reassuring language -- this is a common, fixable problem, ` +
    `not a penalty. Ask whether they'd like to (a) retry the charge right now, ` +
    `(b) get a secure link texted to update their card, or (c) pause the subscription ` +
    `for now. Be warm and brief; do not make the customer feel at fault.`;

  return {
    task,
    recipient: {
      phone: subscriber.phone,
      region: subscriber.region,
      locale: subscriber.locale,
    },
  };
}

export interface PlaceRecoveryCallParams {
  subscriber: Subscriber;
  failureReason: string;
  idempotencyKey: string;
  webhookUrl: string;
}

/**
 * Places a real outbound call via CALL-E's one-shot Calls API to talk a
 * subscriber through a failed payment and capture their live decision.
 *
 * This is a SEPARATE, explicit step from buildRecoveryCallTask -- callers
 * (see app/api/calle/place-call/route.ts) only reach this after a human has
 * reviewed the exact task/recipient via the preview and clicked "Confirm".
 *
 * This does NOT wait for the call to finish -- the result arrives later via
 * the /api/calle/webhook route (see app/api/calle/webhook/route.ts), which is
 * why webhookUrl must be a publicly reachable URL (use a tunnel like ngrok
 * for local dev, since CALL-E has to reach it from the outside).
 */
export async function placeRecoveryCall({
  subscriber,
  failureReason,
  idempotencyKey,
  webhookUrl,
}: PlaceRecoveryCallParams) {
  const { task, recipient } = buildRecoveryCallTask(subscriber, failureReason);

  const call = await client.calls.create(
    {
      task,
      recipient,
      resultSchema: paymentRecoveryResultSchema,
      metadata: {
        subscriberId: subscriber.id,
        trigger: "payment_failed",
      },
      webhookUrl,
    },
    { idempotencyKey }
  );

  return call;
}