/**
 * Frozen template snapshots — missions never silently pick up later edits.
 */
export type TemplateDef = {
  template_id: string;
  template_version: number;
  prompt_version: number;
  outcome_schema_version: number;
  graph_snapshot: Record<string, unknown>;
  label: string;
};

export const TEMPLATES = {
  "slot-recovery": {
    template_id: "slot-recovery",
    template_version: 1,
    prompt_version: 1,
    outcome_schema_version: 1,
    label: "Slot Recovery · Appointment logistics",
    graph_snapshot: {
      candidates: ["A", "B", "C"],
      confirmation_hard_rule: true,
      no_fake_booked: true,
    },
  },
  "dispatch-bridge": {
    template_id: "dispatch-bridge",
    template_version: 1,
    prompt_version: 1,
    outcome_schema_version: 1,
    label: "Dispatch Bridge · Cross-party",
    graph_snapshot: {
      flow: ["customer", "practice"],
      required_facts: ["appointment_time"],
      nodes: {
        customer: { required_facts: [] },
        practice: { required_facts: ["appointment_time"] },
      },
    },
  },
} as const satisfies Record<string, TemplateDef>;

export type TemplateId = keyof typeof TEMPLATES;

export function freezeTemplate(id: TemplateId): TemplateDef {
  const t = TEMPLATES[id];
  return {
    ...t,
    graph_snapshot: structuredClone(t.graph_snapshot),
  };
}
