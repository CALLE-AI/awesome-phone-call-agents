import "server-only";

import { assertCalleCallId, parseCalleCallSnapshot, type CalleCallSnapshot } from "./status";

const CALLE_API_ORIGIN = "https://api.heycall-e.com";

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
