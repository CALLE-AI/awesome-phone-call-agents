import { CalleClient } from "@call-e/calle";
import { RESULT_SCHEMA } from "./call-task.js";
import type { CallResult } from "./types.js";

export interface CallProvider {
  run(phone: string, task: string, idempotencyKey: string): Promise<CallResult>;
}

export class MockCallProvider implements CallProvider {
  async run(_phone: string, _task: string, idempotencyKey: string): Promise<CallResult> {
    return {
      provider: "mock",
      status: "completed",
      taskCompleted: true,
      eligibility: "confirmed",
      remedy: "repair",
      requiredProof: "A photo of the model label; no personal account data.",
      nextStep: "Use the public recall form to request the free repair kit.",
      deadline: null,
      needsHuman: false,
      caseReference: null,
      confidence: 0.94,
      evidence: [
        "Authorized demo response confirmed the supplied model.",
        "The stated remedy was a free repair kit.",
      ],
      callId: `mock_${idempotencyKey}`,
    };
  }
}

type CallePayload = {
  status?: string;
  taskCompleted?: boolean;
  task_completed?: boolean;
  structuredResult?: Record<string, unknown>;
  structured_result?: Record<string, unknown>;
  evidence?: unknown[];
  id?: string;
  callId?: string;
};

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.slice(0, 500) : fallback;
}

function number(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export class CalleCallProvider implements CallProvider {
  readonly client: CalleClient;

  constructor(apiKey: string) {
    if (!apiKey) throw new Error("CALL_E_API_KEY is required for live calls.");
    this.client = new CalleClient({ apiKey });
  }

  async run(phone: string, task: string, idempotencyKey: string): Promise<CallResult> {
    const raw = (await this.client.calls.createAndWait({
      task: `${task} Call this explicitly approved number: ${phone}`,
      resultSchema: RESULT_SCHEMA,
      metadata: { workflow: "recallready", idempotency_key: idempotencyKey },
    })) as CallePayload;

    const result = raw.structuredResult ?? raw.structured_result ?? {};
    const eligibility = text(result.eligibility, "unknown") as CallResult["eligibility"];
    const remedy = text(result.remedy, "unknown") as CallResult["remedy"];

    return {
      provider: "call-e",
      status: text(raw.status, "unknown"),
      taskCompleted: Boolean(raw.taskCompleted ?? raw.task_completed),
      eligibility,
      remedy,
      requiredProof: text(result.required_proof, "Not established"),
      nextStep: text(result.next_step, "Manual follow-up required"),
      deadline: result.deadline === null ? null : text(result.deadline) || null,
      needsHuman: Boolean(result.needs_human),
      caseReference: result.case_reference === null ? null : text(result.case_reference) || null,
      confidence: Math.max(0, Math.min(1, number(result.confidence))),
      evidence: (raw.evidence ?? []).filter((v): v is string => typeof v === "string").map((v) => v.slice(0, 300)).slice(0, 6),
      callId: text(raw.callId ?? raw.id, `call_${idempotencyKey}`),
    };
  }
}
