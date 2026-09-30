import { z } from "zod";

import type { CallPurpose } from "../calle/types";
import { getDemoBeneficiary } from "../calle/demo-data";

export const callBriefFactSchema = z.object({
  field: z.string(),
  value: z.string(),
  sourceId: z.string(),
  sourceType: z.enum(["demo_record", "care_task", "policy"]),
});

export const callBriefSchema = z.object({
  briefVersion: z.string(),
  purpose: z.string(),
  beneficiaryRef: z.string(),
  facts: z.array(callBriefFactSchema).max(8),
  recommendations: z.array(z.string()).max(4),
  prohibitedClaims: z.array(z.string()).min(1),
  maxPersonalFields: z.number(),
  source: z.enum(["rule_based", "model"]),
  confidence: z.number().min(0).max(1),
});

export type CallBrief = z.infer<typeof callBriefSchema>;

const PROHIBITED = [
  "Do not diagnose or prescribe.",
  "Do not claim to be a licensed clinician.",
  "Do not collect unnecessary PII.",
];

/** Deterministic call brief — no model required. Caps injected personal fields. */
export function buildCallBriefRuleBased(input: {
  beneficiaryId: string;
  purpose: CallPurpose;
  locale: string;
}): CallBrief {
  const demo = getDemoBeneficiary(input.beneficiaryId);
  const facts: CallBrief["facts"] = [
    {
      field: "purpose",
      value: input.purpose.replace(/_/g, " "),
      sourceId: "compile:v4",
      sourceType: "care_task",
    },
    {
      field: "locale",
      value: input.locale,
      sourceId: "policy:supported-locales",
      sourceType: "policy",
    },
  ];

  if (demo) {
    facts.push(
      {
        field: "displayName",
        value: demo.displayName,
        sourceId: demo.id,
        sourceType: "demo_record",
      },
      {
        field: "priority",
        value: demo.priority,
        sourceId: demo.id,
        sourceType: "demo_record",
      },
    );
  }

  return callBriefSchema.parse({
    briefVersion: "v4.0.0",
    purpose: input.purpose,
    beneficiaryRef: input.beneficiaryId,
    facts: facts.slice(0, 8),
    recommendations: [
      "Confirm reachability and callback preference.",
      "Escalate to human CHW if urgent symptoms are reported.",
    ],
    prohibitedClaims: PROHIBITED,
    maxPersonalFields: 3,
    source: "rule_based",
    confidence: 1,
  });
}

export async function buildCallBrief(input: {
  beneficiaryId: string;
  purpose: CallPurpose;
  locale: string;
  aiEnabled?: boolean;
}): Promise<CallBrief> {
  void input.aiEnabled;
  return buildCallBriefRuleBased(input);
}
