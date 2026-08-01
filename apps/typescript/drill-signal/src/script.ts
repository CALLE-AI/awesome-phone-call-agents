/**
 * Drill call script and metadata for CALL-E.
 */

import { buildResultSchema } from "./schema.js";
import type { ContactRole, DrillRecord, JsonSchema } from "./types.js";

export function scenarioDescription(scenario: DrillRecord["scenario"]): string {
  if (scenario === "production_outage") {
    return "a scheduled production outage business-continuity drill";
  }
  return "a scheduled business-continuity drill";
}

export function buildTask(drill: DrillRecord, role: ContactRole): string {
  const contact = role === "primary" ? drill.primary : drill.backup;
  const label = contact?.label ?? role;
  return [
    `You are conducting ${scenarioDescription(drill.scenario)}.`,
    `Speak with ${label}, the ${role} on-call role holder.`,
    "Disclose that this is an AI-assisted drill call, not a real incident.",
    "Confirm they reached a live person, acknowledge the outage scenario, and whether they can take ownership.",
    "Collect their first action, escalation target if any, whether they need help, follow-up needs, and opt-out preference.",
    "Do not provide medical, legal, financial, or emergency guidance.",
    "End immediately if they opt out or are not the right person.",
  ].join(" ");
}

export function buildMetadata(drill: DrillRecord, role: ContactRole): Record<string, string> {
  return {
    app: "drill-signal",
    drill_id: drill.id,
    scenario: drill.scenario,
    role,
    mode: drill.mode,
  };
}

export function idempotencyKey(drillId: string, role: ContactRole): string {
  return `drill-signal-${drillId}-${role}`;
}

export function resultSchema(): JsonSchema {
  return buildResultSchema();
}
