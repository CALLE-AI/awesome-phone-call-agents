// The only module that imports the CALL-E SDK. Loaded lazily by client.ts so a
// dry-run never constructs a client or requires an API key.

import { CalleClient } from "@call-e/calle";
import type { Call } from "@call-e/calle";
import type { OverdueAccount, CollectionsResult } from "./types.js";

export type CalleClientLike = CalleClient;

/** Per-recipient structured-output schema CALL-E fills in when the call ends. */
const RECIPIENT_RESULT_SCHEMA = {
  type: "object",
  required: ["outcome"],
  properties: {
    outcome: {
      type: "string",
      enum: [
        "promise-to-pay",
        "dispute",
        "callback-requested",
        "wrong-number",
        "no-answer",
        "refused",
        "unknown",
      ],
    },
    promise_to_pay_date: { type: "string" },
    callback_at: { type: "string" },
    notes: { type: "string" },
  },
} as const;

// How long to wait for a single call to reach a terminal state before giving up.
// The SDK's default is 10 min; we cap at 5 so one stalled call can't block the
// batch for that long, while still leaving headroom for a real call to finish.
// A placed-then-timed-out call is still billed, so don't set this too tight.
const CALL_TIMEOUT_MS = 300_000;

export function createCalleClient(apiKey: string, baseUrl?: string): CalleClient {
  return new CalleClient({ apiKey, baseUrl: baseUrl ?? "https://api.heycall-e.com" });
}

/** Deterministic idempotency key so a retried run never double-dials an account. */
export function idempotencyKey(account: OverdueAccount): string {
  return `collections_${account.accountId}_${account.dueDate}`.replace(/[^a-zA-Z0-9_]/g, "_");
}

/** The spoken instructions for CALL-E. Compliance rules are baked in, not optional. */
export function buildTask(account: OverdueAccount): string {
  const amount = (account.amountDueCents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: account.currency,
  });
  return [
    `Call ${account.phone} and ask to speak with ${account.customerName}.`,
    `Purpose: a courtesy reminder that a payment of ${amount} was due on ${account.dueDate} and is now ${account.daysPastDue} days past due.`,
    "Rules you MUST follow:",
    "- Identify yourself as an automated assistant calling on behalf of the lender.",
    `- Only discuss the account with ${account.customerName}. If someone else answers or it is the wrong number, apologize and end the call.`,
    "- Be respectful. Do not threaten, pressure, or imply legal consequences.",
    "- Do NOT collect card numbers, bank details, or any payment on this call.",
    "- Offer the customer a choice: give a promise-to-pay date, raise a dispute, or schedule a callback.",
    "When the call ends, report the outcome and any promise-to-pay date or requested callback time.",
  ].join("\n");
}

export interface PlacedCall {
  callId: string;
  status: string;
  taskCompleted: boolean;
  confidence?: number;
  structured?: CollectionsResult;
  raw: unknown;
}

export async function placeCall(client: CalleClient, account: OverdueAccount): Promise<PlacedCall> {
  const call = await client.calls.createAndWait(
    {
      task: buildTask(account),
      recipients: [
        { phones: [account.phone], region: account.region, locale: account.language ?? "en-US" },
      ],
      recipientResultSchema: RECIPIENT_RESULT_SCHEMA,
      metadata: { account_id: account.accountId, days_past_due: String(account.daysPastDue) },
    },
    { idempotencyKey: idempotencyKey(account), timeoutMs: CALL_TIMEOUT_MS },
  );

  return {
    callId: call.id,
    status: call.status,
    taskCompleted: Boolean(call.taskCompleted),
    // completionConfidence is { score: 0..1, label }; the report wants the numeric score.
    confidence: call.completionConfidence?.score,
    structured: mapResult(call.recipients?.[0]?.structuredResult),
    raw: call,
  };
}

// The recipient-result payload we asked CALL-E for (see RECIPIENT_RESULT_SCHEMA).
// The SDK types structuredResult as an opaque JsonObject, so we narrow it here.
interface RawResult {
  outcome?: CollectionsResult["outcome"];
  promise_to_pay_date?: string;
  callback_at?: string;
  notes?: string;
}

export function mapResult(raw: Call["recipients"][number]["structuredResult"] | undefined): CollectionsResult | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as RawResult;
  return {
    outcome: r.outcome ?? "unknown",
    promiseToPayDate: r.promise_to_pay_date,
    callbackAt: r.callback_at,
    notes: r.notes,
  };
}
