import type { JsonObject } from "@call-e/calle";
import type { BrainGoal, OpportunityProfile, SourcedField } from "../types.ts";
import { insightText } from "../intent/phrases.ts";
import { MISSED_PICKUP_ACTION, priorityFromScores } from "../intent/opportunity.ts";

function field<T>(value: T, confidence = 0.92): SourcedField<T> {
  return { value, source: "explicit", confidence };
}

const CORE_TARGET_FIELDS = new Set([
  "companySize",
  "companyDescription",
  "alternatives",
  "primaryPain",
  "timeline",
  "useCase",
  "objections",
  "decisionMaker"
]);

const CORE_RESULT_KEYS = new Set([
  "primary_pain",
  "use_case",
  "timeline",
  "company_size",
  "company_description",
  "alternatives",
  "objections",
  "decision_role",
  "interest_level",
  "asked_for_person",
  "handoff_recommended",
  "evidence_summary"
]);

const CORE_PROPERTIES: JsonObject = {
  primary_pain: {
    type: "string",
    description:
      "Core business pain in a short phrase, e.g. 'Manual CRM admin' or 'HubSpot too expensive'. Empty string if none was stated. Never a call-status summary such as 'the discovery call completed'."
  },
  use_case: {
    type: "string",
    description: "What they want Harbor for, in a short phrase. Empty string if not stated."
  },
  timeline: {
    type: "string",
    description: "Implementation or buying timeline in a short phrase (e.g. '1-2 months'). Empty string if not stated."
  },
  company_size: {
    type: "string",
    description: "Team or seat count as stated (e.g. '80 reps'). Empty string if not stated."
  },
  company_description: {
    type: "string",
    description:
      "What the company does, in a short phrase (e.g. 'B2B logistics software'). Empty string if not stated. Not a call-status summary."
  },
  alternatives: {
    type: "array",
    items: { type: "string" },
    description: "Named tools or processes they use or are evaluating. Empty array if none."
  },
  objections: {
    type: "array",
    items: { type: "string" },
    description: "Short objection phrases they raised. Empty array if none."
  },
  decision_role: {
    type: "string",
    description: "Their buying role in a short phrase. Empty string if not stated."
  },
  interest_level: {
    type: "string",
    enum: ["strong", "moderate", "low", "not_interested", "unknown"],
    description:
      "strong: pricing, demo, next steps, or clear follow-up interest. moderate: curiosity without a next step. low: minimal engagement. not_interested: they declined. unknown: insufficient evidence."
  },
  asked_for_person: {
    type: "string",
    enum: ["yes", "no", "unknown"],
    description:
      "yes only if they explicitly asked to speak with a human, sales rep, or specialist. Do not infer from politeness. unknown if unclear."
  },
  handoff_recommended: {
    type: "string",
    enum: ["yes", "no", "unknown"],
    description:
      "yes if asked_for_person is yes or interest_level is strong. no when low or not_interested. unknown if insufficient evidence."
  },
  evidence_summary: {
    type: "string",
    description:
      "One concise sentence citing their words or behavior. This is supporting evidence, not a pain-point label and not a call-status summary."
  }
};

export const RECIPIENT_RESULT_SCHEMA: JsonObject = {
  type: "object",
  additionalProperties: false,
  required: ["answered_by"],
  properties: {
    answered_by: {
      type: "string",
      enum: ["human", "voicemail", "ivr", "unknown"],
      description:
        "Final endpoint. human if a person spoke. voicemail if a mailbox picked up. ivr if stuck in a tree. unknown if unclear. If an IVR transferred to a person, use human."
    }
  }
};

export function discoveryResultSchema(goals: BrainGoal[] = []): JsonObject {
  const extra: JsonObject = {};
  for (const goal of goals.filter((item) => item.enabled !== false)) {
    if (CORE_TARGET_FIELDS.has(goal.targetField) || CORE_RESULT_KEYS.has(goal.targetField)) continue;
    extra[goal.targetField] = {
      type: "string",
      description: `${goal.label}. ${goal.guidance || "Short phrase from the call."} Empty string if not stated.`
    };
  }
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "primary_pain",
      "use_case",
      "timeline",
      "company_size",
      "alternatives",
      "objections",
      "decision_role",
      "interest_level",
      "asked_for_person",
      "handoff_recommended",
      "evidence_summary"
    ],
    properties: { ...CORE_PROPERTIES, ...extra }
  };
}

export function asText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return insightText(value);
}

function asList(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const items = value.map((item) => asText(item)).filter((item): item is string => Boolean(item));
    return items.length ? items : undefined;
  }
  const single = asText(value);
  if (!single) return undefined;
  const parts = single.split(/[,;]/).map((part) => part.trim()).filter(Boolean);
  return parts.length ? parts : undefined;
}

export function answeredByFromRecipient(structured: JsonObject | null | undefined): string | undefined {
  return asText(structured?.answered_by);
}

export function mergeCalleStructuredResult(
  base: OpportunityProfile,
  taskResult: JsonObject | null | undefined,
  missedPickup: boolean
): OpportunityProfile {
  if (!taskResult) return base;

  const pain = insightText(asText(taskResult.primary_pain));
  const useCase = asText(taskResult.use_case);
  const timeline = asText(taskResult.timeline);
  const companySize = asText(taskResult.company_size);
  const companyDescription = asText(taskResult.company_description);
  const alternatives = asList(taskResult.alternatives);
  const objections = asList(taskResult.objections);
  const decisionRole = asText(taskResult.decision_role);
  const interest = asText(taskResult.interest_level);
  const askedForPerson = asText(taskResult.asked_for_person);
  const handoff = asText(taskResult.handoff_recommended);
  const evidence = asText(taskResult.evidence_summary);

  const wantsFollowUp =
    missedPickup ||
    askedForPerson === "yes" ||
    handoff === "yes" ||
    interest === "strong" ||
    Boolean(base.wantsHumanFollowUp?.value);

  const extractedGoals = { ...base.extractedGoals };
  if (evidence) extractedGoals.evidenceSummary = field(evidence);
  for (const [key, raw] of Object.entries(taskResult)) {
    if (CORE_RESULT_KEYS.has(key)) continue;
    const text = asText(raw);
    if (text) extractedGoals[key] = field(text);
  }

  const next: OpportunityProfile = {
    ...base,
    primaryPain: pain ? field(pain) : base.primaryPain,
    useCase: useCase ? field(useCase) : base.useCase,
    timeline: timeline ? field(timeline) : base.timeline,
    companySize: companySize ? field(companySize) : base.companySize,
    companyDescription: companyDescription ? field(companyDescription) : base.companyDescription,
    alternatives: alternatives ? field(alternatives) : base.alternatives,
    objections: objections ? field(objections) : base.objections,
    decisionMaker: decisionRole ? field(decisionRole) : base.decisionMaker,
    wantsHumanFollowUp: field(wantsFollowUp, askedForPerson === "yes" ? 0.95 : 0.8),
    recommendedAction: missedPickup
      ? field(MISSED_PICKUP_ACTION, 0.9)
      : askedForPerson === "yes" || handoff === "yes" || interest === "strong"
        ? field("Sales rep follow-up within 1 hour", 0.9)
        : base.recommendedAction,
    extractedGoals: Object.keys(extractedGoals).length ? extractedGoals : undefined
  };

  const intentLevel =
    interest === "strong" ? "high" : interest === "low" || interest === "not_interested" ? "low" : "medium";
  next.priority = priorityFromScores(
    intentLevel,
    next.scores.overall.value,
    wantsFollowUp,
    next.priority === "disqualified"
  );
  return next;
}
