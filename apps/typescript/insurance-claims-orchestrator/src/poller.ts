// src/poller.ts
// Calls CALL-E REST API, polls to terminal status, returns structured result.
// Only used in --live mode. Dry-run never reaches this file.
//
// IMPORTANT (real-world side effect): once CALL-E accepts a call, the outbound
// call may continue on the provider even if this process exits locally. Exiting
// this CLI does NOT cancel an in-flight accepted call.

import type { CallOutcome } from "./ClaimChain.js";

const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);
const MAX_POLL = 60;
const POLL_INTERVAL_MS = 10_000;
const CALLE_BASE_URL = "https://api.heycall-e.com/v1";

// The set of self-reported outcomes we treat as a confirmed, successful intake.
// The AI reports its own outcome in the structured result; provider transport
// status alone is NOT sufficient to declare success.
const CONFIRMED_OUTCOMES = new Set<CallOutcome>(["completed"]);
const KNOWN_OUTCOMES = new Set<CallOutcome>([
  "completed",
  "voicemail",
  "no_answer",
  "refused",
  "unclear",
]);

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
    // Mask provider error to avoid exposing sensitive details in logs.
    throw new Error(`CALL-E create failed: ${createRes.status}`);
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
      structured_result?: { outcome?: string } & Record<string, unknown>;
    };

    if (TERMINAL_STATUSES.has(data.status)) {
      const outcome = deriveOutcome(data.status, data.structured_result);
      return {
        callId,
        outcome,
        structured_result: data.structured_result ?? null,
      };
    }
  }

  // Timed out waiting for a terminal status. This is ambiguous — the call may
  // still be in progress or accepted on the provider. Do NOT treat as a clean
  // no-answer that would trigger an automatic redial. Surface as unclear so the
  // orchestrator routes to human review.
  return { callId, outcome: "unclear", structured_result: null };
}

// Derive the workflow outcome from BOTH the provider transport status and the
// AI-reported outcome inside the structured result.
//
// Rules:
// - A confirmed intake requires the provider to report "completed" AND the AI's
//   own self-reported `outcome` to be a confirmed outcome ("completed").
// - If the AI reported a specific known outcome (refused/unclear/voicemail/
//   no_answer), preserve it verbatim — never overwrite a refusal with success.
// - Ambiguous provider failures ("failed"/"cancelled") map to "unclear", which
//   is NOT retryable, rather than "no_answer", which is.
function deriveOutcome(
  providerStatus: string,
  result: ({ outcome?: string } & Record<string, unknown>) | undefined
): CallOutcome {
  const reported = normalizeReportedOutcome(result?.outcome);

  // If the AI self-reported a known outcome, that is the source of truth.
  if (reported) {
    // Success requires provider completion too; otherwise it's ambiguous.
    if (CONFIRMED_OUTCOMES.has(reported)) {
      return providerStatus === "completed" && result ? "completed" : "unclear";
    }
    return reported;
  }

  // No usable self-reported outcome. Fall back conservatively.
  // Provider "completed" without a parsable result is ambiguous, not success.
  // Provider "failed"/"cancelled" is ambiguous — do NOT map to retryable no_answer.
  return "unclear";
}

function normalizeReportedOutcome(value: unknown): CallOutcome | null {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase() as CallOutcome;
  return KNOWN_OUTCOMES.has(v) ? v : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
