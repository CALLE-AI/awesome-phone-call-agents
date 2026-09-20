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
  const transcript = call.recipients.flatMap((recipient) =>
    recipient.attempts.flatMap((attempt) =>
      attempt.transcriptTurns.map(
        (turn) => `${turn.speaker}: ${turn.text}`,
      ),
    ),
  );

  return {
    providerCallId: call.id,
    status: call.status,
    taskCompleted: call.taskCompleted,
    completionConfidence: call.completionConfidence,
    structuredResult: call.structuredResult,
    evidence: call.evidence,
    summary: call.summary,
    transcript,
    failureCode: call.failureCode,
    failureMessage: call.failureMessage,
  };
}
