import "dotenv/config";
import { CalleClient } from "@call-e/calle";

const demoMode = process.env.CALLE_MODE !== "live";
const apiKey = process.env.CALLE_API_KEY;

if (!demoMode && !apiKey) {
  throw new Error("CALLE_API_KEY is required when CALLE_MODE=live.");
}

const baseUrl = process.env.CALLE_BASE_URL || "https://api.heycall-e.com";
const fetchWithTimeout = async (request) => {
  const controller = new AbortController();
  // Call creation can take longer than a normal API read while CALL-E prepares
  // telephony resources. Keep a bounded but realistic server-side timeout.
  const timer = setTimeout(() => controller.abort(), 120_000);
  try {
    return await fetch(request, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

export const calleClient = demoMode ? null : new CalleClient({ apiKey, baseUrl, fetch: fetchWithTimeout });
const demoCalls = new Map();

function demoCall({ recipient, metadata }) {
  const id = `demo_${crypto.randomUUID()}`;
  const call = {
    id,
    status: "COMPLETED",
    summary: "Demo mode: no phone call was placed.",
    structuredResult: {
      availability: "unknown",
      estimate: "unknown",
      arrival_window: "unknown",
      booking_method: "No booking action was taken.",
      evidence_summary: "This is a local no-call demonstration result."
    },
    recipients: [{ phones: recipient.phones, attempts: [] }],
    metadata
  };
  demoCalls.set(id, call);
  return { call, events: [{ type: "demo.completed", message: "Demo mode completed; no phone call was placed." }] };
}

/**
 * Server-only call entry point. The caller must enforce its own authorization,
 * idempotency, audit logging, and consent checks before using this function.
 */
export async function createServiceInquiry({ task, recipient, resultSchema, metadata, webhookUrl }, { idempotencyKey }) {
  if (demoMode) return demoCall({ recipient, metadata });
  return calleClient.calls.create({ task, recipient, resultSchema, metadata, webhookUrl }, { idempotencyKey });
}

export async function getServiceInquiry(callId) {
  if (demoMode) {
    const call = demoCalls.get(callId);
    if (!call) throw new Error("Demo call was not found.");
    return { call, events: [{ type: "demo.completed", message: "Demo mode completed; no phone call was placed." }] };
  }
  const [call, events] = await Promise.all([
    calleClient.calls.get(callId),
    calleClient.calls.listEvents(callId, { limit: 50 }).catch(() => ({ data: [] }))
  ]);
  return { call, events: events.data };
}
