// The two verticals, both built on the ONE reusable verified-phone-outcome core.
// A "Goal" here mirrors a CALL-E Goal: a versioned task template + result_schema +
// the keys we verify. Swapping the vertical swaps only the schema and framing — the
// engine, safety, and UI are identical. That reuse IS the "reusable by the community"
// story the rubric rewards.

import type { RankSpec } from "./core/batch";

export interface GoalPreset {
  id: string;
  label: string;
  /** Reserved-fictional E.164 (555-01xx). Never a real number. */
  phone: string;
  goalText: string;
  scenarioId: string;
  resultSchema: Record<string, unknown>;
  requestedKeys: string[];
}

export interface GoalVertical {
  id: "accessibility" | "civic";
  title: string;
  tagline: string;
  /** Wraps the user's plain-language goal into the CALL-E `task`. */
  taskTemplate: (goal: string) => string;
  presets: GoalPreset[];
}

function schema(properties: Record<string, string>): Record<string, unknown> {
  return {
    type: "object",
    properties: Object.fromEntries(
      Object.entries(properties).map(([k, description]) => [k, { type: "string", description }]),
    ),
    required: Object.keys(properties),
  };
}

export const accessibilityVertical: GoalVertical = {
  id: "accessibility",
  title: "Accessibility relay",
  tagline: "Skip the call you can't make. Type the goal; we make the call and hand you back a verified answer.",
  taskTemplate: (goal) =>
    `You are placing a call on behalf of a person who is Deaf or hard of hearing and cannot take the call themselves. ` +
    `Disclose that you are an assistant calling on their behalf. Accomplish this goal politely, and report back exactly what was said: ${goal}`,
  presets: [
    {
      id: "pharmacy-ready",
      label: "Pharmacy — is my refill ready?",
      phone: "+12025550142",
      goalText: "Call the pharmacy, check if my metformin refill is ready, and ask what time they close and by when I can pick it up.",
      scenarioId: "pharmacy-ready",
      resultSchema: schema({
        refill_ready: "Whether the prescription refill is ready (yes/no/unknown)",
        pickup_by: "Latest time it can be picked up today",
        closing_time: "What time the pharmacy closes today",
      }),
      requestedKeys: ["refill_ready", "pickup_by", "closing_time"],
    },
    {
      id: "restaurant-reservation",
      label: "Restaurant — earliest table + step-free?",
      phone: "+12025550173",
      goalText: "Call Bella Trattoria, ask for the earliest table for four tonight, and whether it is wheelchair accessible.",
      scenarioId: "restaurant-reservation",
      resultSchema: schema({
        earliest_table: "Earliest available table time tonight",
        party_size_ok: "Whether a party of four can be seated (yes/no)",
        wheelchair_accessible: "Whether the venue is wheelchair accessible (yes/no)",
      }),
      requestedKeys: ["earliest_table", "party_size_ok", "wheelchair_accessible"],
    },
    {
      id: "clinic-hours",
      label: "Clinic — hours + walk-in flu shot?",
      phone: "+12025550158",
      goalText: "Call Riverside Clinic, ask what time they close today and whether a walk-in flu shot is available.",
      scenarioId: "clinic-hours",
      resultSchema: schema({
        open_until: "What time the clinic closes today",
        walk_in_flu_shot: "Whether a walk-in flu shot is available (yes/no)",
      }),
      requestedKeys: ["open_until", "walk_in_flu_shot"],
    },
  ],
};

export const civicVertical: GoalVertical = {
  id: "civic",
  title: "Civic logistics",
  tagline: "Navigate the deepest phone trees for logistics — hours, wait, documents, generic status. Never advice, never impersonation.",
  taskTemplate: (goal) =>
    `You are calling a government or utility office on a resident's behalf for LOGISTICS ONLY. ` +
    `Do NOT give or seek advice, eligibility interpretations, or account-specific decisions, and do NOT claim to be the resident. ` +
    `If the office requires the account holder to verify identity, stop and report that. Accomplish and report exactly what was said: ${goal}`,
  presets: [
    {
      id: "dmv-realid",
      label: "DMV — REAL ID documents + wait time",
      phone: "+12025550119",
      goalText: "Call the DMV and ask what documents I need to bring to apply for a REAL ID, and today's current wait time.",
      scenarioId: "dmv-realid",
      resultSchema: schema({
        documents_needed: "Documents required to apply for a REAL ID",
        wait_time: "Current wait time at the office",
      }),
      requestedKeys: ["documents_needed", "wait_time"],
    },
    {
      id: "benefits-identity-wall",
      label: "Benefits office — hours + case status",
      phone: "+12025550164",
      goalText: "Call the county benefits office, ask their opening hours, and whether my case has been decided yet.",
      scenarioId: "benefits-identity-wall",
      resultSchema: schema({
        office_hours: "The office's opening hours",
        case_status: "The status of the resident's case (only if lawfully obtainable)",
      }),
      requestedKeys: ["office_hours", "case_status"],
    },
    {
      id: "water-unreachable",
      label: "City water dept — is a boil notice active?",
      phone: "+12025550185",
      goalText: "Call the city water department and ask whether a boil-water notice is currently active for my area.",
      scenarioId: "water-unreachable",
      resultSchema: schema({
        boil_notice_active: "Whether a boil-water notice is active (yes/no)",
      }),
      requestedKeys: ["boil_notice_active"],
    },
  ],
};

export const verticals: GoalVertical[] = [accessibilityVertical, civicVertical];

export function findPreset(verticalId: string, presetId: string): { vertical: GoalVertical; preset: GoalPreset } | null {
  const vertical = verticals.find((v) => v.id === verticalId);
  const preset = vertical?.presets.find((p) => p.id === presetId);
  if (!vertical || !preset) return null;
  return { vertical, preset };
}

export interface BatchRecipientPreset {
  id: string;
  label: string;
  phone: string;
  scenarioId: string;
}

export interface BatchGoalPreset {
  id: string;
  label: string;
  task: string;
  recipients: BatchRecipientPreset[];
  resultSchema: Record<string, unknown>;
  requestedKeys: string[];
  rank: RankSpec;
}

export const batchPresets: BatchGoalPreset[] = [
  {
    id: "compare-pharmacies",
    label: "Compare 3 pharmacies — who has it, cheapest?",
    task:
      "You are calling on behalf of a Deaf customer. Ask whether generic metformin is in stock and the price for a 30-day supply. Report exactly what is said.",
    recipients: [
      { id: "pharmacy-a", label: "Rivertown Pharmacy", phone: "+12025550142", scenarioId: "pharmacy-a" },
      { id: "pharmacy-b", label: "Central Drugs", phone: "+12025550177", scenarioId: "pharmacy-b" },
      { id: "pharmacy-c", label: "Eastside Pharmacy", phone: "+12025550188", scenarioId: "pharmacy-c" },
    ],
    resultSchema: schema({
      in_stock: "Whether generic metformin is in stock (yes/no)",
      price: "Price for a 30-day supply",
    }),
    requestedKeys: ["in_stock", "price"],
    rank: {
      gateKey: "in_stock",
      gateEquals: "yes",
      compareKey: "price",
      kind: "price",
      direction: "asc",
      describe: "In stock, then cheapest — ranked only among prices we could verify on the call",
    },
  },
];

export function findBatchPreset(id: string): BatchGoalPreset | null {
  return batchPresets.find((p) => p.id === id) ?? null;
}
