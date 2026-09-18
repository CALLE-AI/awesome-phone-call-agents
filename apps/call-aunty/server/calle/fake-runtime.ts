import type { CalleAdapter, PlaceCallCommand, ProviderCallResult } from "./adapter";
import type { CallFailureCode, CallStructuredResult, CallWorkflowStatus } from "./types";
import { callStructuredResultSchema } from "./types";

export type DemoScenarioId =
  | "instant_success"
  | "no_answer"
  | "busy"
  | "voicemail"
  | "provider_error"
  | "safety_escalation"
  | "needs_review"
  | "human_handoff";

export const DEMO_SCENARIO_IDS: DemoScenarioId[] = [
  "instant_success",
  "no_answer",
  "busy",
  "voicemail",
  "provider_error",
  "safety_escalation",
  "needs_review",
  "human_handoff",
];

type ScenarioSpec = {
  status: CallWorkflowStatus;
  failureCode: CallFailureCode | null;
  result: CallStructuredResult | null;
};

const SCENARIOS: Record<DemoScenarioId, ScenarioSpec> = {
  instant_success: {
    status: "dry_run_completed",
    failureCode: null,
    result: callStructuredResultSchema.parse({
      reached: true,
      availability: "available",
      needsHumanFollowUp: false,
      appointmentConfirmed: true,
      preferredCallbackWindow: "none",
      safetyEscalation: "none",
      summaryCode: "ok_routine",
      nextAction: "none",
      completionConfidence: 0.94,
    }),
  },
  no_answer: {
    status: "no_answer",
    failureCode: "no_answer",
    result: callStructuredResultSchema.parse({
      reached: false,
      availability: "unavailable",
      needsHumanFollowUp: false,
      appointmentConfirmed: null,
      preferredCallbackWindow: "unknown",
      safetyEscalation: "none",
      summaryCode: "no_answer",
      nextAction: "call_again",
      completionConfidence: 0.88,
    }),
  },
  busy: {
    status: "no_answer",
    failureCode: "no_answer",
    result: callStructuredResultSchema.parse({
      reached: false,
      availability: "busy",
      needsHumanFollowUp: true,
      appointmentConfirmed: null,
      preferredCallbackWindow: "afternoon",
      safetyEscalation: "none",
      summaryCode: "needs_callback",
      nextAction: "call_again",
      completionConfidence: 0.8,
    }),
  },
  voicemail: {
    status: "no_answer",
    failureCode: "no_answer",
    result: callStructuredResultSchema.parse({
      reached: false,
      availability: "unavailable",
      needsHumanFollowUp: true,
      appointmentConfirmed: null,
      preferredCallbackWindow: "evening",
      safetyEscalation: "none",
      summaryCode: "incomplete",
      nextAction: "call_again",
      completionConfidence: 0.7,
    }),
  },
  provider_error: {
    status: "failed",
    failureCode: "provider_unavailable",
    result: null,
  },
  safety_escalation: {
    status: "dry_run_completed",
    failureCode: null,
    result: callStructuredResultSchema.parse({
      reached: true,
      availability: "available",
      needsHumanFollowUp: true,
      appointmentConfirmed: null,
      preferredCallbackWindow: "unknown",
      safetyEscalation: "urgent_in_person_care",
      summaryCode: "urgent_care",
      nextAction: "urgent_review",
      completionConfidence: 0.86,
    }),
  },
  needs_review: {
    status: "dry_run_completed",
    failureCode: null,
    result: callStructuredResultSchema.parse({
      reached: true,
      availability: "available",
      needsHumanFollowUp: true,
      appointmentConfirmed: null,
      preferredCallbackWindow: "unknown",
      safetyEscalation: "contact_chw_today",
      summaryCode: "needs_chw",
      nextAction: "call_again",
      completionConfidence: 0.42,
    }),
  },
  human_handoff: {
    status: "dry_run_completed",
    failureCode: null,
    result: callStructuredResultSchema.parse({
      reached: true,
      availability: "available",
      needsHumanFollowUp: true,
      appointmentConfirmed: false,
      preferredCallbackWindow: "morning",
      safetyEscalation: "contact_chw_today",
      summaryCode: "needs_callback",
      nextAction: "call_again",
      completionConfidence: 0.9,
    }),
  },
};

export class FakeCalleRuntime implements CalleAdapter {
  constructor(private scenario: DemoScenarioId = "instant_success") {}

  setScenario(scenario: DemoScenarioId) {
    this.scenario = scenario;
  }

  getScenario(): DemoScenarioId {
    return this.scenario;
  }

  private run(workflowId: string): ProviderCallResult {
    const spec = SCENARIOS[this.scenario] ?? SCENARIOS.instant_success;
    return {
      providerCallId: `fake_${this.scenario}_${workflowId}`,
      status: spec.status,
      structuredResult: spec.result,
      failureCode: spec.failureCode,
      taskCompleted: spec.status === "dry_run_completed" || spec.status === "completed",
      completionConfidence: spec.result?.completionConfidence ?? null,
    };
  }

  async placeFollowUpCall(command: PlaceCallCommand): Promise<ProviderCallResult> {
    return this.run(command.workflowId);
  }

  async getStatus(providerCallId: string): Promise<ProviderCallResult> {
    const workflowId = providerCallId.replace(/^fake_[a-z_]+_/, "") || "unknown";
    return this.run(workflowId);
  }

  async cancel(providerCallId: string): Promise<ProviderCallResult> {
    return {
      providerCallId,
      status: "cancelled",
      structuredResult: null,
      failureCode: "cancelled",
    };
  }
}
