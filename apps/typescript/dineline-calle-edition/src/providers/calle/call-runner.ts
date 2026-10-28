import type { CalleClient, Call, CreateCallInput } from "@call-e/calle";

import {
  AcceptedCallStatusUnknownError,
  type ProviderCallResult,
} from "./types.js";

export async function createAndWaitForCalleCall(
  client: CalleClient,
  input: CreateCallInput,
  idempotencyKey: string,
  timeoutMs: number,
): Promise<ProviderCallResult> {
  const accepted = await client.calls.create(input, { idempotencyKey });

  try {
    return mapCalleCall(
      await client.calls.waitForResult(accepted.id, { timeoutMs }),
    );
  } catch (error) {
    // The call already exists. Preserve its ID so status can be read safely
    // instead of risking a second outbound call.
    throw new AcceptedCallStatusUnknownError(accepted.id, error);
  }
}

export async function readCalleCall(
  client: CalleClient,
  providerCallId: string,
): Promise<ProviderCallResult> {
  return mapCalleCall(await client.calls.get(providerCallId));
}

export function mapCalleCall(call: Call): ProviderCallResult {
  const transcript = call.transcript.map((turn) => `${turn.speaker}: ${turn.text}`);
  const result =
    call.resultStatus === "available" && call.status === "completed" && !call.error
      ? call.result
      : null;
  const score = result?.completion_confidence;
  const quote = typeof result?.evidence === "string" ? result.evidence.trim() : "";
  const normalize = (value: string) => value.toLowerCase().replace(/\s+/g, " ").trim();
  // v2 has no platform evidence/confidence fields; use requested fields only with transcript support.
  const evidence =
    quote && normalize(call.transcript.map((turn) => turn.text).join(" ")).includes(normalize(quote))
      ? [quote]
      : [];

  return {
    providerCallId: call.id,
    status: call.status,
    resultStatus: call.resultStatus,
    taskCompleted:
      typeof result?.task_completed === "boolean" ? result.task_completed : null,
    completionConfidence:
      typeof score === "number" && Number.isFinite(score) && score >= 0 && score <= 1
        ? { score, label: "reported" }
        : null,
    structuredResult: result,
    evidence,
    summary: typeof result?.summary === "string" ? result.summary : null,
    transcript,
    failureCode: call.error?.code ?? null,
    failureMessage: call.error?.message ?? null,
  };
}
