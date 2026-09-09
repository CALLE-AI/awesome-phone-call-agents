import "server-only";

import { CalleClient } from "@call-e/calle";
import type { DialResult } from "./calle";
import { failClosed, mapLiveResult } from "./map-live-result";
import type { CallPlan } from "./plan";
import type { FraudOpsCase } from "./types";

export { failClosed, mapLiveResult } from "./map-live-result";

export function assertCalleBaseUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("CALLE_BASE_URL is not a URL");
  }
  const local =
    (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost") &&
    parsed.port !== "";
  if (parsed.protocol === "http:" && !local) {
    throw new Error("plain HTTP only for 127.0.0.1 or localhost with a port");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("CALLE_BASE_URL must be http(s)");
  }
}

export async function placeLiveCall(
  fraudCase: FraudOpsCase,
  plan: CallPlan
): Promise<DialResult> {
  const apiKey = process.env.CALLE_API_KEY?.trim() ?? "";
  const baseUrl = process.env.CALLE_BASE_URL?.trim() ?? "";
  assertCalleBaseUrl(baseUrl);
  const client = new CalleClient({ apiKey, baseUrl });

  let raw: unknown;
  try {
    const timeout = AbortSignal.timeout(120_000);
    raw = await Promise.race([
      client.calls.createAndWait(
        {
          task: plan.taskPrompt,
          recipients: [{ phones: [fraudCase.contact.phone_e164] }],
          recipientResultSchema: plan.recipientResultSchema,
          metadata: { case_id: fraudCase.case_id },
        },
        { idempotencyKey: plan.idempotencyKey, timeoutMs: 120_000 }
      ),
      new Promise((_, reject) => {
        timeout.addEventListener("abort", () => reject(new Error("timeout")));
      }),
    ]);
  } catch {
    return failClosed(fraudCase, "outcome_unknown");
  }

  return mapLiveResult(fraudCase, raw);
}
