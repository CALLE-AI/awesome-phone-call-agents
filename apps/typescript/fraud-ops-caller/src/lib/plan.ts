import { createHash } from "node:crypto";
import { buildCalleTaskPrompt, nvcFrameForCase } from "./nvc";
import {
  TOOL_IDS,
  demoSlaHours,
  maskE164,
  toolsForIntent,
  type ToolId,
} from "./plan-view";
import { evaluateGate, type GateDecision } from "./policy";
import { DISPOSITIONS, type FraudOpsCase, type Intent } from "./types";

export {
  DEMO_DISPOSITION,
  TOOL_IDS,
  demoSlaHours,
  maskE164,
  toolsForIntent,
  type ToolId,
} from "./plan-view";

export type CallPlan = {
  caseId: string;
  intent: Intent;
  maskedTo: string;
  taskPrompt: string;
  recipientResultSchema: ReturnType<typeof recipientResultSchema>;
  idempotencyKey: string;
  gate: GateDecision;
  tools: ToolId[];
  nvcOpening: { observation: string; feeling: string; need: string; request: string };
  demoSlaHours: number | null;
};

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(obj)
        .sort()
        .map((k) => [k, sortKeys(obj[k])])
    );
  }
  return value;
}

export function recipientResultSchema(intent: Intent) {
  return {
    type: "object",
    required: ["disposition", "quotes", "next_action"],
    properties: {
      callback_at: { type: "string" },
      deescalation_override: { type: "boolean" },
      disposition: { type: "string", enum: [...DISPOSITIONS[intent]] },
      handoff_reason: { type: "string" },
      hostility_strikes: { type: "integer", enum: [0, 1, 2] },
      missing_docs: { type: "array", items: { type: "string" } },
      next_action: { type: "string" },
      nvc_state: {
        type: "string",
        enum: [
          "intake",
          "deescalation",
          "deep_validation",
          "solution_mapping",
          "execution",
          "resolution_close",
        ],
      },
      ptp_date: { type: "string" },
      quotes: { type: "array", items: { type: "string" } },
      statement_summary: { type: "string" },
      tool_invoked: { type: "string", enum: [...TOOL_IDS] },
      unsafe_flag: { type: "boolean" },
    },
  };
}

/**
 * SHA-256 via node:crypto on the server. The desk is a client component —
 * do not import this file from `desk.tsx`. The API route rebuilds the plan.
 * ponytail: one hash impl; client reads mask/tools/SLA from plan-view.ts.
 * Idempotency stays server-authoritative.
 */
function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export async function buildCallPlan(
  fraudCase: FraudOpsCase,
  now?: Date
): Promise<CallPlan> {
  const taskPrompt = buildCalleTaskPrompt(fraudCase);
  const schema = recipientResultSchema(fraudCase.intent);
  const canonical = JSON.stringify({
    case_id: fraudCase.case_id,
    attempt_n: fraudCase.policy.attempt_n,
    intent: fraudCase.intent,
    taskPrompt,
    recipientResultSchema: sortKeys(schema),
  });
  return {
    caseId: fraudCase.case_id,
    intent: fraudCase.intent,
    maskedTo: maskE164(fraudCase.contact.phone_e164),
    taskPrompt,
    recipientResultSchema: schema,
    idempotencyKey: sha256Hex(canonical),
    gate: evaluateGate(fraudCase, now),
    tools: toolsForIntent(fraudCase.intent, fraudCase.safety_sensitive),
    nvcOpening: nvcFrameForCase(fraudCase),
    demoSlaHours: demoSlaHours(fraudCase),
  };
}
