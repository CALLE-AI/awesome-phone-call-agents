import "server-only";

import { assertCalleCallId, parseCalleCallSnapshot, type CalleCallSnapshot } from "./status";
import { validateOutboundCallRequest, type OutboundCallRequest } from "./outbound";

const CALLE_API_ORIGIN = "https://api.heycall-e.com";

export async function createCalleCall(
  request: OutboundCallRequest,
  apiKey: string,
  fetcher: typeof fetch = fetch,
): Promise<CalleCallSnapshot> {
  const validated = validateOutboundCallRequest(request);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetcher(`${CALLE_API_ORIGIN}/v1/calls`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": validated.idempotencyKey,
      },
      body: JSON.stringify({
        task: `Identify yourself as Senior Phone AI. ${validated.purpose}`,
        recipients: [{ phones: [validated.destinationE164] }],
        metadata: { application: "senior-phone-ai" },
      }),
      redirect: "manual",
      signal: controller.signal,
    });
    if (response.status >= 300 && response.status < 400) throw new Error("CALL-E redirect rejected");
    if (!response.ok) throw new Error(`CALL-E create status ${response.status}`);
    return parseCalleCallSnapshot(await response.json());
  } finally {
    clearTimeout(timeout);
  }
}

export async function getCalleCallSnapshot(
  callId: string,
  apiKey: string,
  fetcher: typeof fetch = fetch,
): Promise<CalleCallSnapshot> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetcher(
      `${CALLE_API_ORIGIN}/v1/calls/${encodeURIComponent(assertCalleCallId(callId))}`,
      {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
        redirect: "manual",
        signal: controller.signal,
      },
    );
    if (response.status >= 300 && response.status < 400) {
      throw new Error("CALL-E redirect rejected");
    }
    if (!response.ok) throw new Error(`CALL-E status ${response.status}`);
    return parseCalleCallSnapshot(await response.json());
  } finally {
    clearTimeout(timeout);
  }
}

export async function getCalleCallSnapshots(
  callIds: string[],
  apiKey: string,
): Promise<{ calls: CalleCallSnapshot[]; unavailableCount: number }> {
  const results = await Promise.allSettled(callIds.map((callId) => getCalleCallSnapshot(callId, apiKey)));
  const calls = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
  calls.sort((left, right) => (right.createdAt ?? "").localeCompare(left.createdAt ?? ""));
  return { calls, unavailableCount: results.length - calls.length };
}
