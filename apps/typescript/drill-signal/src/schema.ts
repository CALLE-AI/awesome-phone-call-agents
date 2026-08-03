/**
 * Structured drill result schema for CALL-E.
 */

import type { JsonSchema, StructuredDrillResult } from "./types.js";

export const STRUCTURED_RESULT_FIELDS: (keyof StructuredDrillResult)[] = [
  "reached_live_person",
  "acknowledged_scenario",
  "can_take_ownership",
  "first_action",
  "escalation_target",
  "needs_help",
  "follow_up_required",
  "opt_out",
];

export function buildResultSchema(): JsonSchema {
  return {
    type: "object",
    additionalProperties: false,
    required: [...STRUCTURED_RESULT_FIELDS],
    properties: {
      reached_live_person: { type: "boolean", description: "A live person answered and engaged." },
      acknowledged_scenario: {
        type: "boolean",
        description: "The recipient acknowledged the outage drill scenario.",
      },
      can_take_ownership: {
        type: "boolean",
        description: "The recipient can take ownership of the incident response role.",
      },
      first_action: {
        type: "string",
        description: "The first action the recipient would take.",
      },
      escalation_target: {
        type: "string",
        description: "Who they would escalate to, or null if not applicable.",
      },
      needs_help: { type: "boolean", description: "Whether they need immediate assistance." },
      follow_up_required: { type: "boolean", description: "Whether a follow-up is required after the drill." },
      opt_out: { type: "boolean", description: "Whether the recipient opts out of future drills." },
    },
  };
}

export function parseStructuredResult(value: unknown): StructuredDrillResult | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  for (const field of STRUCTURED_RESULT_FIELDS) {
    if (!(field in record)) {
      return null;
    }
  }
  if (typeof record.reached_live_person !== "boolean") return null;
  if (typeof record.acknowledged_scenario !== "boolean") return null;
  if (typeof record.can_take_ownership !== "boolean") return null;
  if (typeof record.first_action !== "string") return null;
  if (!(typeof record.escalation_target === "string" || record.escalation_target === null)) return null;
  if (typeof record.needs_help !== "boolean") return null;
  if (typeof record.follow_up_required !== "boolean") return null;
  if (typeof record.opt_out !== "boolean") return null;
  return {
    reached_live_person: record.reached_live_person as boolean,
    acknowledged_scenario: record.acknowledged_scenario as boolean,
    can_take_ownership: record.can_take_ownership as boolean,
    first_action: record.first_action as string,
    escalation_target: record.escalation_target as string | null,
    needs_help: record.needs_help as boolean,
    follow_up_required: record.follow_up_required as boolean,
    opt_out: record.opt_out as boolean,
  };
}
