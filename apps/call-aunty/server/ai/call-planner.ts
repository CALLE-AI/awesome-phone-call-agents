import { z } from "zod";
import type { CallPurpose } from "../calle/types";
import { getPromptTemplate } from "./prompts/registry";

export const aiCallPlanSchema = z.object({
  plannerVersion: z.string(),
  purpose: z.string(),
  goals: z.array(z.string()).min(1).max(8),
  allowedTopics: z.array(z.string()).min(1).max(12),
  forbiddenTopics: z.array(z.string()).min(1).max(12),
  questions: z.array(z.string()).min(1).max(6),
  successCriteria: z.array(z.string()).min(1).max(8),
  escalationCriteria: z.array(z.string()).min(1).max(8),
  dataToCapture: z.array(z.string()).min(1).max(12),
  confidence: z.number().min(0).max(1),
  source: z.enum(["rule_based", "model"]),
});

export type AiCallPlan = z.infer<typeof aiCallPlanSchema>;

export type CallPlannerInput = {
  purpose: CallPurpose;
  locale: string;
  triageState: string;
  beneficiaryId: string;
};

/** Rule-based planner — works without AI credentials. */
export function planCallRuleBased(input: CallPlannerInput): AiCallPlan {
  const template = getPromptTemplate(input.purpose);
  return aiCallPlanSchema.parse({
    plannerVersion: template.version,
    purpose: input.purpose,
    goals: template.goals,
    allowedTopics: template.allowedTopics,
    forbiddenTopics: template.forbiddenTopics,
    questions: template.questions,
    successCriteria: template.successCriteria,
    escalationCriteria: template.escalationCriteria,
    dataToCapture: template.dataToCapture,
    confidence: 1,
    source: "rule_based",
  });
}

export async function planCall(input: CallPlannerInput): Promise<AiCallPlan> {
  return planCallRuleBased(input);
}
