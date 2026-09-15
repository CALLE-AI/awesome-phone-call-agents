import "server-only";

import { CalleClient } from "@call-e/calle";
import type { DialResult } from "./calle";
import { assertCalleBaseUrl } from "./calle-origin";
import { failClosed, mapLiveResult } from "./map-live-result";
import type { CallPlan } from "./plan";
import type { FraudOpsCase } from "./types";

export { failClosed, mapLiveResult } from "./map-live-result";
export { assertCalleBaseUrl, CALLE_PRODUCTION_ORIGIN } from "./calle-origin";

export async function placeLiveCall(
  fraudCase: FraudOpsCase,
  plan: CallPlan
): Promise<DialResult> {
  const apiKey = process.env.CALLE_API_KEY?.trim() ?? "";
  const baseUrl = process.env.CALLE_BASE_URL?.trim() ?? "";
  if (!apiKey) {
    throw new Error("CALLE_API_KEY is not configured");
  }
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
