import type { ExecutionPlan, MissionInput, SafetyMode } from "@/types";

export const GUARDRAILS: Record<SafetyMode, string[]> = {
  info_only: [
    "Gather information only — never make commitments, bookings, purchases, or agreements.",
    "Clearly identify as an AI assistant acting on behalf of the user.",
    "Never provide sensitive personal, payment, or credential data.",
    "Never agree to contracts or financial commitments.",
    "End the call politely once the objective facts are collected.",
  ],
  approval_required: [
    "You may negotiate and gather information, but MUST request explicit user approval before any irreversible action (booking, payment, contract, cancellation).",
    "Clearly identify as an AI assistant acting on behalf of the user.",
    "Never provide sensitive data beyond what the user explicitly authorized.",
    "If the other party presses for an immediate commitment, say approval is required and offer to call back.",
  ],
  autonomous: [
    "Only low-risk, clearly defined actions are allowed (e.g. requesting info, holding an inquiry — never payments or contracts).",
    "Clearly identify as an AI assistant.",
    "When in doubt, stop and escalate for human review instead of acting.",
  ],
};

export function buildAgentInstructions(input: MissionInput, plan: Omit<ExecutionPlan, "agentInstructions" | "resultSchema" | "safety">): string {
  const safety = GUARDRAILS[input.safetyMode];
  return [
    `You are CallPilot, an AI operations phone agent calling on behalf of "${input.title}". You are calling ${input.targetName} at ${input.phoneE164}.`,
    `OBJECTIVE: ${plan.objective}. Success means: ${plan.success_condition}.`,
    `TARGET: ${plan.target}.`,
    `QUESTIONS TO COVER (adapt order, skip what's already answered, ask follow-ups when answers are vague):`,
    ...plan.questions.map((q, i) => `  ${i + 1}. ${q}`),
    `CONSTRAINTS:`,
    ...plan.constraints.map((c) => `  - ${c}`),
    `DESIRED OUTCOME: ${input.desiredOutcome || plan.success_condition}`,
    `BEHAVIOR: 1) Introduce yourself naturally as an AI assistant and state the purpose in one sentence. 2) Ask relevant questions and truly listen. 3) Adapt to unexpected answers; ask concise follow-ups. 4) Avoid repeating answered questions. 5) Detect when the objective is achieved and stop. 6) End politely and summarize what was agreed.`,
    `SAFETY (${input.safetyMode}):`,
    ...safety.map((s) => `  - ${s}`),
    `Never pretend to be human. Never misrepresent identity. Return only truthful, on-call facts.`,
  ].join("\n");
}

export function buildPlan(input: MissionInput): ExecutionPlan {
  const questions = input.questions.filter(Boolean).slice(0, 8);
  const constraints = input.constraints.filter(Boolean).slice(0, 8);
  const base = {
    objective: input.goal.trim(),
    target: input.targetName.trim(),
    questions: questions.length ? questions : ["What options are available?", "What is required to proceed?"],
    constraints: constraints.length ? constraints : ["Do not make commitments without approval"],
    success_condition: input.desiredOutcome.trim() || "Obtain the requested information in structured form",
  };
  const agentInstructions = buildAgentInstructions(input, base);
  return {
    ...base,
    agentInstructions,
    safety: { mode: input.safetyMode, guardrails: GUARDRAILS[input.safetyMode] },
    resultSchema: {
      type: "object",
      required: ["objective_achieved", "notes", "next_action"],
      properties: {
        objective_achieved: { type: "boolean" },
        availability: { type: "array", items: { type: "object", properties: { date: { type: "string" }, time: { type: "string" } } } },
        price: { type: ["string", "null"] },
        requirements: { type: "array", items: { type: "string" } },
        notes: { type: "array", items: { type: "string" } },
        next_action: { type: "string" },
      },
    },
  };
}
