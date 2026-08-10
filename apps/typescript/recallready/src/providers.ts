import { CalleClient, type Call } from "@call-e/calle";
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

function requiredText(value: unknown, field: string, maximum = 500): string {
  if (typeof value !== "string" || !value.trim()) reject(`missing ${field}`);
  return value.trim().slice(0, maximum);
}

function reject(reason: string): never {
  throw new Error(`CALL-E result rejected: ${reason}. Manual review is required; no remedy was confirmed.`);
}

function optionalText(value: unknown, field: string): string | null {
  if (value === null || value === undefined || value === "") return null;
  return requiredText(value, field);
}

function boundedConfidence(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    reject(`invalid ${field}`);
  }
  return value;
}

const ELIGIBILITY = new Set<CallResult["eligibility"]>([
  "confirmed", "not_confirmed", "needs_more_information", "unknown",
]);
const REMEDIES = new Set<CallResult["remedy"]>([
  "refund", "repair", "replace", "dispose", "new_instructions", "unknown",
]);

function validatedResult(raw: Call, approvedPhone: string): CallResult {
  if (raw.status !== "completed") reject(`terminal status was ${raw.status}`);
  if (raw.taskCompleted !== true) reject("task was not completed");
  boundedConfidence(raw.completionConfidence?.score, "completion confidence");
  if (raw.recipients.length !== 1) reject("recipient count was not exactly one");
  const recipient = raw.recipients.find((candidate) => candidate.phones.includes(approvedPhone));
  if (!recipient) reject("approved recipient was not bound to the result");
  if (recipient.status !== "completed") reject(`recipient status was ${recipient.status}`);

  const result = raw.structuredResult;
  if (!result || typeof result !== "object" || Array.isArray(result)) reject("structured result was unavailable");
  const eligibility = requiredText(result.eligibility, "eligibility") as CallResult["eligibility"];
  if (!ELIGIBILITY.has(eligibility)) reject("eligibility enum was invalid");
  const remedy = requiredText(result.remedy, "remedy") as CallResult["remedy"];
  if (!REMEDIES.has(remedy)) reject("remedy enum was invalid");
  if (typeof result.needs_human !== "boolean") reject("needs_human was invalid");
  const evidence = raw.evidence
    .filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
    .map((value) => value.trim().slice(0, 300))
    .slice(0, 6);
  if (evidence.length === 0) reject("evidence was unavailable");

  return {
    provider: "call-e", status: "completed", taskCompleted: true,
    eligibility, remedy,
    requiredProof: requiredText(result.required_proof, "required_proof"),
    nextStep: requiredText(result.next_step, "next_step"),
    deadline: optionalText(result.deadline, "deadline"),
    needsHuman: result.needs_human,
    caseReference: optionalText(result.case_reference, "case_reference"),
    confidence: boundedConfidence(result.confidence, "result confidence"),
    evidence,
    callId: requiredText(raw.id, "call id", 120),
  };
}

export class CalleCallProvider implements CallProvider {
  readonly client: CalleClient;

  constructor(apiKey: string, client?: CalleClient) {
    if (!apiKey) throw new Error("CALL_E_API_KEY is required for live calls.");
    this.client = client ?? new CalleClient({ apiKey });
  }

  async run(phone: string, task: string, idempotencyKey: string): Promise<CallResult> {
    const raw = await this.client.calls.createAndWait({
      task,
      recipient: { phones: [phone], region: "US", locale: "en-US" },
      resultSchema: RESULT_SCHEMA,
      metadata: { workflow: "recallready", idempotency_key: idempotencyKey },
    }, { idempotencyKey });
    return validatedResult(raw, phone);
  }
}
