import { CalleClient, type Call } from "@call-e/calle";
import type { Subscriber } from "./db";
import { randomUUID } from "crypto";

const rawKey = process.env.CALLE_API_KEY?.trim();
export const isCalleOfflineMock = !rawKey || rawKey === "mock" || rawKey.startsWith("mock_");

// In-memory registry for mock calls in offline/demo mode
const mockCallStore = new Map<string, Call>();

const client = hasLiveCalleClient()
  ? new CalleClient({ apiKey: rawKey! })
  : null;

function hasLiveCalleClient(): boolean {
  return !isCalleOfflineMock;
}

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

export interface RecoveryCallSubscriberInput {
  name: string;
  plan_name: string;
  amount_cents: number;
  phone: string;
  region: string;
  locale: string;
}

export function buildRecoveryCallTask(
  subscriber: RecoveryCallSubscriberInput,
  failureReason: string,
  attemptNumber: number = 1
): RecoveryCallTask {
  const amount = (subscriber.amount_cents / 100).toFixed(2);

  const openingLine =
    attemptNumber > 1
      ? `Call ${subscriber.name} again -- an earlier call about this didn't get through -- about a failed payment ` +
        `for their "${subscriber.plan_name}" subscription ($${amount}).`
      : `Call ${subscriber.name} about a failed payment for their "${subscriber.plan_name}" subscription ($${amount}).`;

  const task =
    `You are an AI billing assistant calling on behalf of Recover, the billing ` +
    `platform that manages ${subscriber.name}'s "${subscriber.plan_name}" subscription. ` +
    `${openingLine} The payment failed because: ${failureReason}. ` +
    `Identify yourself clearly as calling on behalf of Recover at the start of the call. ` +
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
  attemptNumber?: number;
}

/**
 * Places an outbound call via CALL-E's Calls API,
 * or safely executes via the offline mock engine when no live API key is supplied.
 */
export async function placeRecoveryCall({
  subscriber,
  failureReason,
  idempotencyKey,
  webhookUrl,
  attemptNumber = 1,
}: PlaceRecoveryCallParams): Promise<Call> {
  const { task, recipient } = buildRecoveryCallTask(subscriber, failureReason, attemptNumber);

  if (isCalleOfflineMock || !client) {
    const mockId = `call_mock_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    const mockCall: Call = {
      id: mockId,
      object: "call_task",
      status: "completed",
      task,
      recipients: [
        {
          id: `rec_${randomUUID().slice(0, 8)}`,
          phones: [recipient.phone],
          locale: recipient.locale,
          region: recipient.region,
          status: "completed",
          structuredResult: {
            decision: "retry_now",
            evidence: "Customer stated: 'Yes please retry my payment right now.'",
          },
          summary: "Customer confirmed payment retry via phone.",
          attempts: [],
        },
      ],
      structuredResult: {
        decision: "retry_now",
        evidence: "Customer explicitly authorized re-attempting the charge.",
      },
      summary: "Customer confirmed immediate retry.",
      taskCompleted: true,
      completionConfidence: {
        score: 0.96,
        label: "high",
      },
      evidence: ["Customer said: 'Yes, please retry the card now.'"],
      metadata: {
        subscriberId: subscriber.id,
        trigger: "payment_failed",
        isMock: true,
      },
      failureCode: null,
      failureMessage: null,
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    };

    mockCallStore.set(mockId, mockCall);
    return mockCall;
  }

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

/**
 * Re-fetches the authoritative call result directly from CALL-E's server API.
 * Never trust unsigned caller-supplied webhook payloads; always verify against this server lookup.
 */
export async function fetchVerifiedCalleCall(callId: string): Promise<Call | null> {
  if (isCalleOfflineMock || !client) {
    return mockCallStore.get(callId) || null;
  }

  try {
    const verifiedCall = await client.calls.get(callId);
    return verifiedCall;
  } catch (err) {
    console.error(`[CALL-E Security] Failed to re-fetch call ${callId} from API:`, err);
    return null;
  }
}

export const MAX_CALL_ATTEMPTS = 3;

export function followUpDelayMinutes(): number {
  const raw = process.env.FOLLOWUP_DELAY_MINUTES;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1440;
}