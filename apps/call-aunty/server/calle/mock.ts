import { tagFallbackMetadata, type MockFallbackReason } from "./mock-fallback";
import type { CallEventPage, CallTask, CreateCallRequest } from "./runtime-types";

const state = new Map<string, CallTask>();
const now = () => new Date().toISOString();

export type MockScenarioId = "completed" | "no_answer" | "busy" | "needs_follow_up" | "voicemail" | "safety_escalation";

type ScenarioFixture = {
  status: CallTask["status"];
  taskCompleted: boolean;
  summary: string;
  evidence: string;
  confidence: { score: number; label: string };
  structured: Record<string, unknown>;
};

const SCENARIOS: Record<MockScenarioId, ScenarioFixture> = {
  completed: {
    status: "completed",
    taskCompleted: true,
    summary: "Mock CALL-E result: recipient reached and the requested action completed.",
    evidence: "Mock recipient confirmed the requested action.",
    confidence: { score: 0.96, label: "high" },
    structured: {
      request_type: "family_update",
      outcome: "completed",
      follow_up_required: "no",
      summary: "Mock result",
      reached: true,
      availability: "available",
      needsHumanFollowUp: false,
      appointmentConfirmed: true,
      preferredCallbackWindow: "none",
      safetyEscalation: "none",
      summaryCode: "ok_routine",
      nextAction: "none",
      completionConfidence: 0.96,
      needs_follow_up: "no",
      appointment_confirmed: "yes",
      preferred_window: "none",
    },
  },
  no_answer: {
    status: "completed",
    taskCompleted: false,
    summary: "Mock CALL-E result: no answer after authorized attempts.",
    evidence: "Mock runtime recorded an unanswered ring.",
    confidence: { score: 0.88, label: "high" },
    structured: {
      request_type: "check_in",
      outcome: "no_answer",
      follow_up_required: "yes",
      summary: "No answer — mock fallback.",
      reached: false,
      availability: "unavailable",
      needsHumanFollowUp: true,
      appointmentConfirmed: null,
      preferredCallbackWindow: "unknown",
      safetyEscalation: "none",
      summaryCode: "no_answer",
      nextAction: "call_again",
      completionConfidence: 0.88,
      needs_follow_up: "yes",
      appointment_confirmed: "unknown",
      preferred_window: "unknown",
    },
  },
  busy: {
    status: "completed",
    taskCompleted: false,
    summary: "Mock CALL-E result: recipient line was busy.",
    evidence: "Mock runtime recorded a busy signal.",
    confidence: { score: 0.8, label: "medium" },
    structured: {
      request_type: "appointment",
      outcome: "needs_follow_up",
      follow_up_required: "yes",
      summary: "Busy — mock fallback.",
      reached: false,
      availability: "busy",
      needsHumanFollowUp: true,
      appointmentConfirmed: null,
      preferredCallbackWindow: "afternoon",
      safetyEscalation: "none",
      summaryCode: "needs_callback",
      nextAction: "call_again",
      completionConfidence: 0.8,
      needs_follow_up: "yes",
      appointment_confirmed: "unknown",
      preferred_window: "afternoon",
    },
  },
  needs_follow_up: {
    status: "completed",
    taskCompleted: true,
    summary: "Mock CALL-E result: reached, CHW follow-up still required.",
    evidence: "Mock recipient asked a community health worker to call back.",
    confidence: { score: 0.9, label: "high" },
    structured: {
      request_type: "reminder",
      outcome: "needs_follow_up",
      follow_up_required: "yes",
      summary: "Reached — mock CHW follow-up.",
      reached: true,
      availability: "available",
      needsHumanFollowUp: true,
      appointmentConfirmed: null,
      preferredCallbackWindow: "afternoon",
      safetyEscalation: "contact_chw_today",
      summaryCode: "needs_chw",
      nextAction: "call_again",
      completionConfidence: 0.9,
      needs_follow_up: "yes",
      appointment_confirmed: "unknown",
      preferred_window: "afternoon",
    },
  },
  voicemail: {
    status: "completed",
    taskCompleted: false,
    summary: "Mock CALL-E result: voicemail left; family asked for a CHW callback.",
    evidence: "Mock runtime recorded a voicemail greeting and no live conversation.",
    confidence: { score: 0.84, label: "high" },
    structured: {
      request_type: "callback_confirmation",
      outcome: "voicemail",
      follow_up_required: "yes",
      summary: "Voicemail — mock CHW callback.",
      reached: false,
      availability: "unavailable",
      needsHumanFollowUp: true,
      appointmentConfirmed: null,
      preferredCallbackWindow: "evening",
      safetyEscalation: "none",
      summaryCode: "voicemail",
      nextAction: "call_again",
      completionConfidence: 0.84,
      needs_follow_up: "yes",
      appointment_confirmed: "unknown",
      preferred_window: "evening",
    },
  },
  safety_escalation: {
    status: "completed",
    taskCompleted: true,
    summary: "Mock CALL-E result: safety script used; probing stopped for human follow-up.",
    evidence: "Mock recipient mentioned danger signs; agent stopped additional survey questions.",
    confidence: { score: 0.93, label: "high" },
    structured: {
      request_type: "check_in",
      outcome: "needs_follow_up",
      follow_up_required: "yes",
      summary: "Safety escalation — mock human follow-up.",
      reached: true,
      availability: "available",
      needsHumanFollowUp: true,
      appointmentConfirmed: null,
      preferredCallbackWindow: "now",
      safetyEscalation: "contact_chw_today",
      summaryCode: "safety_review",
      nextAction: "urgent_review",
      completionConfidence: 0.93,
      needs_follow_up: "yes",
      appointment_confirmed: "unknown",
      preferred_window: "now",
    },
  },
};

export function selectMockScenario(task: string): MockScenarioId {
  const text = task.toLowerCase();
  if (/\bno[- ]?answer\b/.test(text)) return "no_answer";
  if (/\bbusy\b/.test(text)) return "busy";
  if (/\bvoicemail\b/.test(text)) return "voicemail";
  if (/\bsafety\b|\bdistress\b|\bescalat/.test(text)) return "safety_escalation";
  if (/\bfollow[- ]?up\b/.test(text) || /\bchw\b/.test(text)) return "needs_follow_up";
  return "completed";
}

function buildMockCall(
  req: CreateCallRequest & { callId?: string },
  scenario: MockScenarioId,
  fallbackReason?: MockFallbackReason,
): CallTask {
  const id = req.callId ?? `call_mock_${Math.random().toString(36).slice(2, 10)}`;
  const fixture = SCENARIOS[scenario];
  const createdAt = now();
  const metadata = fallbackReason
    ? tagFallbackMetadata(req.metadata, fallbackReason)
    : { ...(req.metadata ?? {}), calle_source: "mock" };

  return {
    id,
    object: "call_task",
    status: fixture.status,
    task: req.task,
    recipients: req.recipients.map((recipient, index) => ({
      id: `rcp_${index}`,
      phones: recipient.phones,
      region: recipient.region,
      locale: recipient.locale,
      status: fixture.status,
      structured_result: fixture.structured,
      summary: fixture.summary,
      attempts: [],
    })),
    structured_result: fixture.structured,
    summary: fixture.summary,
    task_completed: fixture.taskCompleted,
    completion_confidence: fixture.confidence,
    evidence: [fixture.evidence],
    metadata,
    created_at: createdAt,
    completed_at: createdAt,
  };
}

export function mockCall(
  req: CreateCallRequest & { callId?: string },
  fallbackReason?: MockFallbackReason,
): CallTask {
  if (req.callId) {
    const existing = state.get(req.callId);
    if (existing) return existing;
  }
  const scenario = selectMockScenario(req.task);
  const call = buildMockCall(req, scenario, fallbackReason);
  state.set(call.id, call);
  return call;
}

export function getMockCall(id: string, fallbackReason?: MockFallbackReason): CallTask {
  const existing = state.get(id);
  if (existing) return existing;
  return mockCall(
    {
      callId: id,
      task: "Mock CALL-E fallback lookup",
      recipients: [],
      idempotencyKey: `mock-get-${id}`.slice(0, 64).padEnd(16, "0"),
      metadata: { lookup: "true" },
    },
    fallbackReason,
  );
}

export function mockEvents(id: string): CallEventPage {
  const existing = getMockCall(id);
  const createdAt = existing.created_at;
  const completedAt = existing.completed_at ?? createdAt;
  return {
    object: "list",
    data: [
      {
        id: `evt_${id}_queued`,
        type: "call.queued",
        call_id: id,
        created_at: createdAt,
        level: "info",
        status: "queued",
        message: "Mock CALL-E task queued.",
      },
      {
        id: `evt_${id}_completed`,
        type: "call.completed",
        call_id: id,
        created_at: completedAt,
        level: "info",
        status: existing.status,
        message: existing.summary ?? "Mock CALL-E event.",
      },
    ],
    next_cursor: null,
  };
}

export function resetMockCalls() {
  state.clear();
}

export { SCENARIOS as MOCK_SCENARIOS };
