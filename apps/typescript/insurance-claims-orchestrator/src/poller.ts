// src/poller.ts
// Calls CALL-E REST API, polls to terminal status, returns structured result.
// Only used in --live mode. Dry-run never reaches this file.

import type { CallOutcome } from "./ClaimChain.js";

const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);
const MAX_POLL = 60;
const POLL_INTERVAL_MS = 10_000;
const CALLE_BASE_URL = "https://api.heycall-e.com/v1";

export async function calleApiCaller(
  phone: string,
  task: string,
  resultSchema: object
): Promise<{ callId: string; outcome: CallOutcome; structured_result: object | null }> {
  const apiKey = process.env.CALLE_API_KEY;
  if (!apiKey) throw new Error("CALLE_API_KEY not set");

  const createRes = await fetch(`${CALLE_BASE_URL}/calls`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      task,
      recipients: [{ phones: [phone], region: "US", locale: "en-US" }],
      result_schema: resultSchema,
    }),
  });

  if (!createRes.ok) {
    const errorText = await createRes.text();
    // Mask provider error to avoid exposing sensitive details
    throw new Error(
      `CALL-E create failed: ${createRes.status}`
    );
  }

  const { id: callId } = (await createRes.json()) as { id: string };

  let attempts = 0;
  while (attempts < MAX_POLL) {
    await sleep(POLL_INTERVAL_MS);
    attempts++;

    const statusRes = await fetch(`${CALLE_BASE_URL}/calls/${callId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!statusRes.ok) continue;

    const data = (await statusRes.json()) as {
      status: string;
      structured_result?: object;
    };

    if (TERMINAL_STATUSES.has(data.status)) {
      const outcome = mapStatusToOutcome(data.status, data.structured_result);
      // Do NOT log structured_result — only report outcome status
      return {
        callId,
        outcome,
        structured_result: data.structured_result ?? null,
      };
    }
  }

  throw new Error(
    `Call ${callId} did not reach terminal status within ${MAX_POLL} polling attempts`
  );
}

function mapStatusToOutcome(status: string, result: object | undefined): CallOutcome {
  if (status === "completed" && result) return "completed";
  if (status === "completed" && !result) return "unclear";
  if (status === "failed") return "no_answer";
  return "unclear";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
