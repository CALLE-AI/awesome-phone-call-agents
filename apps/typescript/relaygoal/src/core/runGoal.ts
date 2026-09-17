// Orchestration: validate → place ONE call → verify. This is the reusable
// "verified phone outcome" entrypoint both verticals (accessibility relay,
// civic-logistics) call. It never retries the dial on ambiguity — it fails closed
// through verifyOutcome instead, so a client timeout can never double-place a call.

import { assertE164 } from "./phone";
import { verifyOutcome, type VerifyOptions } from "./verify";
import type { CalleLike, VerifiedOutcome } from "./types";

export interface VerifiedGoalRequest {
  /** Natural-language goal for CALL-E to accomplish on the call. */
  task: string;
  /** Recipient in E.164. Validated before any dial. */
  phone: string;
  /** JSON Schema handed to CALL-E to extract structured answers. */
  resultSchema?: Record<string, unknown>;
  /** The keys we will verify and surface to the user. */
  requestedKeys: string[];
  /** Payload-bound key so a retry returns the original call, never a duplicate. */
  idempotencyKey?: string;
  verify?: VerifyOptions;
}

export async function runVerifiedGoal(
  client: CalleLike,
  req: VerifiedGoalRequest,
): Promise<VerifiedOutcome> {
  assertE164(req.phone);

  const input: Parameters<CalleLike["calls"]["createAndWait"]>[0] = {
    task: req.task,
    phone: req.phone,
  };
  if (req.resultSchema !== undefined) input.resultSchema = req.resultSchema;
  if (req.idempotencyKey !== undefined) input.idempotencyKey = req.idempotencyKey;

  const result = await client.calls.createAndWait(input);
  return verifyOutcome(result, req.requestedKeys, req.verify);
}
