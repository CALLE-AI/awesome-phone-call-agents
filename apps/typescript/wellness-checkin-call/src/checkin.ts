import { classifyWellnessResult } from "./classify.js";
import { maskPhone } from "./mask.js";
import { WELLNESS_RESULT_SCHEMA, WELLNESS_TASK } from "./script.js";
import type { CallePort } from "./calle.js";
import type { WellnessReport, WellnessRequest } from "./types.js";

export interface PreviewPlan {
  workflow_id: string;
  masked_phone: string;
  task: string;
  idempotency_key: string;
}

/** No network call. Safe to run with no credentials, any number of times. */
export function previewCheckin(request: WellnessRequest): PreviewPlan {
  return {
    workflow_id: request.workflow_id,
    masked_phone: maskPhone(request.phone),
    task: WELLNESS_TASK,
    idempotency_key: idempotencyKeyFor(request.workflow_id),
  };
}

/**
 * A stable key per workflow_id, so a retried run reconciles with the
 * in-flight or completed call instead of dialing a second time.
 */
export function idempotencyKeyFor(workflowId: string): string {
  return `wellness-checkin:${workflowId}`;
}

export interface RunCheckinOptions {
  request: WellnessRequest;
  port: CallePort;
  pollIntervalMs?: number;
  timeoutMs?: number;
  onProgress?: (line: string) => void;
}

/** Places exactly one call and returns its classified result. */
export async function runCheckin(options: RunCheckinOptions): Promise<WellnessReport> {
  const { request, port, pollIntervalMs = 3000, timeoutMs = 10 * 60 * 1000, onProgress } = options;
  const maskedPhone = maskPhone(request.phone);

  onProgress?.(`placing call to ${maskedPhone}`);
  const created = await port.createCall(
    {
      task: WELLNESS_TASK,
      phone: request.phone,
      resultSchema: WELLNESS_RESULT_SCHEMA as unknown as Record<string, unknown>,
      metadata: { workflow_id: request.workflow_id },
    },
    idempotencyKeyFor(request.workflow_id)
  );

  onProgress?.(`waiting for call ${created.id} to finish`);
  const finished = await port.waitForResult(created.id, { timeoutMs, intervalMs: pollIntervalMs });

  const { level, reasons } = classifyWellnessResult(finished.structuredResult);

  return {
    call_id: finished.id,
    level,
    reasons,
    summary: finished.summary,
    masked_phone: maskedPhone,
  };
}
