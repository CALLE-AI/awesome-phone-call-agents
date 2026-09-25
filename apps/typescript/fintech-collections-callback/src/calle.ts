// The only module that imports the CALL-E SDK. Loaded lazily by client.ts so a
// dry-run never constructs a client or requires an API key.

import { CalleClient } from "@call-e/calle";
import type { Call } from "@call-e/calle";
import type { OverdueAccount, CollectionsResult } from "./types.js";
import { resolveBaseUrl, maskPhoneText } from "./safety.js";

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
  // Fail closed: resolveBaseUrl throws unless the origin is an official CALL-E
  // HTTPS host (or loopback), so the bearer key can't be sent to an arbitrary URL.
  return new CalleClient({ apiKey, baseUrl: resolveBaseUrl(baseUrl) });
}

/** Stable intent key; provider retention and manual reconciliation still apply. */
export function idempotencyKey(account: OverdueAccount): string {
  return `collections_${account.accountId}_${account.dueDate}`.replace(/[^a-zA-Z0-9_]/g, "_");
}

/**
 * The spoken instructions for CALL-E. Right-party verification comes FIRST: no
 * debt, amount, or due date is disclosed until the named party confirms their
 * identity. Compliance rules are baked in, not optional.
 */
export function buildTask(account: OverdueAccount): string {
  const amount = (account.amountDueCents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: account.currency,
  });
  return [
    `Call ${account.phone}. You are an automated assistant calling on behalf of the lender.`,
    `Step 1 — RIGHT-PARTY VERIFICATION FIRST. Ask to speak with ${account.customerName} and confirm you are actually speaking with them.`,
    "Until identity is confirmed, do NOT reveal any debt, amount, due date, account details, or even that this concerns a payment or collections matter.",
    `If ${account.customerName} is unavailable, someone else answers, or identity cannot be confirmed: disclose nothing, apologize for the intrusion, and end the call.`,
    `Step 2 — ONLY after ${account.customerName} confirms their identity, give a courtesy reminder: a payment of ${amount} was due on ${account.dueDate} and is now ${account.daysPastDue} days past due.`,
    "Rules you MUST follow throughout:",
    "- Be respectful. Do not threaten, pressure, or imply legal consequences.",
    "- Do NOT collect card numbers, bank details, or any payment on this call.",
    "- After the reminder, offer a choice: give a promise-to-pay date, raise a dispute, or schedule a callback.",
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
    outcome: RECIPIENT_RESULT_SCHEMA.properties.outcome.enum.includes(r.outcome as CollectionsResult["outcome"])
      ? r.outcome! : "unknown",
    promiseToPayDate: maskPhoneText(r.promise_to_pay_date),
    callbackAt: maskPhoneText(r.callback_at),
    notes: maskPhoneText(r.notes),
  };
}
