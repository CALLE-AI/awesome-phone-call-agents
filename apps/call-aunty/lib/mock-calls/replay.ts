import { applySurveyAnswer, emptySurveyFlags, SAFETY_CONCERN_CODE } from "./branching";
import type { SensitiveEscalation, SurveyAnswer, SurveyFlags } from "./types";

export type ReplayStepKind =
  | "sms_turn"
  | "rest_create"
  | "rest_poll"
  | "rest_retry"
  | "mcp_tool"
  | "system_state"
  | "provider_place"
  | "provider_failover";

export type ReplaySpeaker = "user" | "aunty" | "system";
export type ReplayRestStatus = "queued" | "completed" | "timeout" | "declined" | "callback" | "policy_block";
export type McpToolName = "plan_call" | "run_call" | "get_call_run";

export type ReplayStep =
  | {
      id: string;
      kind: "sms_turn";
      speaker: ReplaySpeaker;
      text: string;
      questionId?: string;
      answer?: SurveyAnswer;
    }
  | {
      id: string;
      kind: "rest_create";
      contactId: string;
      idempotencyKey: string;
      purpose: string;
    }
  | {
      id: string;
      kind: "rest_poll";
      responseStatus: ReplayRestStatus;
      result?: Record<string, unknown>;
    }
  | {
      id: string;
      kind: "rest_retry";
      sameIdempotencyKey: true;
    }
  | {
      id: string;
      kind: "mcp_tool";
      tool: McpToolName;
      confirmation?: boolean;
      expectedStatus: string;
    }
  | {
      id: string;
      kind: "system_state";
      status: string;
      note: string;
    }
  | {
      id: string;
      kind: "provider_place";
      providerId: string;
      accepted: boolean;
      status: ReplayRestStatus | "failed" | "in_progress";
      failureCode?: string;
      providerCallId?: string;
    }
  | {
      id: string;
      kind: "provider_failover";
      from: string;
      to: string;
      attempts: number;
    };

export interface EndToEndReplayFixture {
  id: string;
  title: string;
  purpose: string;
  synthetic: true;
  contactId: string;
  seedPlanId: string;
  seedRunId: string;
  idempotencyKey: string;
  steps: readonly ReplayStep[];
  expected: {
    terminalStatus: string;
    outreachSuppressed: boolean;
    persistSameRunId: boolean;
    confirmationRequired?: boolean;
    escalation: SensitiveEscalation;
    answers?: Record<string, SurveyAnswer>;
    forbiddenSubstrings?: string[];
    phoneProviderId?: string | null;
    failoverAttempts?: number;
  };
}

export interface ReplayState {
  planId: string | null;
  runId: string | null;
  status: string;
  idempotencyKey: string | null;
  confirmationGranted: boolean;
  outreachSuppressed: boolean;
  answers: Record<string, SurveyAnswer>;
  flags: SurveyFlags;
  escalation: SensitiveEscalation;
  events: string[];
  mintedRunIds: string[];
  phoneProviderId: string | null;
  failoverAttempts: number;
}

export function emptyReplayState(): ReplayState {
  return {
    planId: null,
    runId: null,
    status: "idle",
    idempotencyKey: null,
    confirmationGranted: false,
    outreachSuppressed: false,
    answers: {},
    flags: emptySurveyFlags(),
    escalation: "none",
    events: [],
    mintedRunIds: [],
    phoneProviderId: null,
    failoverAttempts: 0,
  };
}

function pushEvent(state: ReplayState, stepId: string, message: string): void {
  state.events.push(`${stepId}: ${message}`);
}

function applySmsTurn(state: ReplayState, step: Extract<ReplayStep, { kind: "sms_turn" }>): void {
  pushEvent(state, step.id, `${step.speaker} ${step.text}`);
  if (step.questionId === undefined || step.answer === undefined || step.speaker !== "aunty") return;
  const decision = applySurveyAnswer({
    answers: state.answers,
    flags: state.flags,
    questionId: step.questionId,
    answer: step.answer,
    spoken: step.text,
  });
  state.answers = { ...state.answers, [step.questionId]: decision.persistAnswer };
  state.flags = decision.flags;
  if (decision.escalation !== "none") state.escalation = decision.escalation;
  if (decision.flags.consentDenied) {
    state.outreachSuppressed = true;
    state.status = "declined";
  }
  if (decision.escalation === "safety_script") state.status = "safety_escalation";
}

export function applyReplayStep(state: ReplayState, step: ReplayStep, fixture: EndToEndReplayFixture): ReplayState {
  const next: ReplayState = {
    ...state,
    answers: { ...state.answers },
    flags: { ...state.flags },
    events: [...state.events],
    mintedRunIds: [...state.mintedRunIds],
  };

  switch (step.kind) {
    case "sms_turn":
      applySmsTurn(next, step);
      break;
    case "system_state":
      next.status = step.status;
      if (step.status === "callback_requested") next.outreachSuppressed = false;
      if (step.status === "declined") next.outreachSuppressed = true;
      pushEvent(next, step.id, step.note);
      break;
    case "rest_create": {
      if (next.outreachSuppressed) {
        next.status = "policy_block";
        pushEvent(next, step.id, "POST /v1/calls blocked; consent or DNC forbids outreach");
        break;
      }
      next.idempotencyKey = step.idempotencyKey;
      if (next.runId) {
        pushEvent(next, step.id, `POST /v1/calls reused run_id=${next.runId}`);
      } else {
        next.runId = fixture.seedRunId;
        next.mintedRunIds.push(fixture.seedRunId);
        next.status = "queued";
        pushEvent(next, step.id, `POST /v1/calls minted run_id=${next.runId}`);
      }
      break;
    }
    case "rest_poll":
      if (!next.runId) {
        next.status = "error";
        pushEvent(next, step.id, "GET /v1/calls missing run_id");
        break;
      }
      next.status = step.responseStatus;
      pushEvent(next, step.id, `GET /v1/calls/${next.runId} status=${step.responseStatus}`);
      break;
    case "rest_retry":
      if (!next.idempotencyKey || next.idempotencyKey !== fixture.idempotencyKey) {
        next.status = "error";
        pushEvent(next, step.id, "retry attempted with a changed idempotency key");
        break;
      }
      if (!next.runId) {
        next.runId = fixture.seedRunId;
        next.mintedRunIds.push(fixture.seedRunId);
      }
      next.status = "queued";
      pushEvent(next, step.id, `retry preserved run_id=${next.runId} key=${next.idempotencyKey}`);
      break;
    case "mcp_tool":
      if (step.tool === "plan_call") {
        next.planId = fixture.seedPlanId;
        next.status = step.expectedStatus;
        pushEvent(next, step.id, `mcp plan_call plan_id=${next.planId}`);
        break;
      }
      if (step.tool === "run_call") {
        if (!next.planId) {
          next.status = "blocked";
          pushEvent(next, step.id, "mcp run_call blocked; plan_call required first");
          break;
        }
        if (step.confirmation !== true) {
          next.status = "blocked";
          pushEvent(next, step.id, "mcp run_call blocked; explicit confirmation required");
          break;
        }
        next.confirmationGranted = true;
        if (!next.runId) {
          next.runId = fixture.seedRunId;
          next.mintedRunIds.push(fixture.seedRunId);
        }
        next.status = step.expectedStatus;
        pushEvent(next, step.id, `mcp run_call run_id=${next.runId}`);
        break;
      }
      next.status = step.expectedStatus;
      pushEvent(next, step.id, `mcp get_call_run run_id=${next.runId} status=${next.status}`);
      break;
    case "provider_place": {
      next.failoverAttempts += 1;
      if (step.accepted) {
        next.phoneProviderId = step.providerId;
        next.status = step.status;
        if (step.providerCallId) {
          if (!next.runId) {
            next.runId = step.providerCallId;
            next.mintedRunIds.push(step.providerCallId);
          }
        } else if (!next.runId) {
          next.runId = fixture.seedRunId;
          next.mintedRunIds.push(fixture.seedRunId);
        }
        pushEvent(next, step.id, `provider ${step.providerId} accepted run_id=${next.runId}`);
      } else {
        next.status = step.status;
        pushEvent(
          next,
          step.id,
          `provider ${step.providerId} rejected code=${step.failureCode ?? "provider_unavailable"}`,
        );
      }
      break;
    }
    case "provider_failover":
      next.failoverAttempts = Math.max(next.failoverAttempts, step.attempts);
      pushEvent(
        next,
        step.id,
        `failover ${step.from} → ${step.to} after ${step.attempts} attempts`,
      );
      break;
  }

  return next;
}

export function replayEndToEnd(fixture: EndToEndReplayFixture): ReplayState {
  return fixture.steps.reduce((state, step) => applyReplayStep(state, step, fixture), emptyReplayState());
}

export function replaySnapshots(fixture: EndToEndReplayFixture): ReplayState[] {
  const snapshots: ReplayState[] = [];
  let state = emptyReplayState();
  for (const step of fixture.steps) {
    state = applyReplayStep(state, step, fixture);
    snapshots.push(state);
  }
  return snapshots;
}

const TOKEN = "<REDACTED>";

export const END_TO_END_REPLAY_FIXTURES: readonly EndToEndReplayFixture[] = [
  {
    id: "replay-e2e-complete",
    title: "SMS consent → REST create/poll → MCP get_call_run",
    purpose: "Happy-path replay that persists one run_id across SMS, REST, and MCP.",
    synthetic: true,
    contactId: "demo-contact-004",
    seedPlanId: "plan_mock_004",
    seedRunId: "run_mock_004",
    idempotencyKey: "mock-replay-complete",
    steps: [
      {
        id: "sms-consent",
        kind: "sms_turn",
        speaker: "user",
        text: "Hi Aunty Cora. This is the fictional Call Aunty survey assistant. Is now a good time for a short survey?",
      },
      {
        id: "sms-consent-yes",
        kind: "sms_turn",
        speaker: "aunty",
        text: "Yes, I have a few minutes.",
        questionId: "consent",
        answer: true,
      },
      {
        id: "sms-q01",
        kind: "sms_turn",
        speaker: "aunty",
        text: "I would say 5.",
        questionId: "q01",
        answer: "Very positive",
      },
      {
        id: "rest-create",
        kind: "rest_create",
        contactId: "demo-contact-004",
        idempotencyKey: "mock-replay-complete",
        purpose: "fictional survey QA",
      },
      { id: "rest-poll", kind: "rest_poll", responseStatus: "completed", result: { fixture: true, scenario: "happy-path" } },
      { id: "mcp-plan", kind: "mcp_tool", tool: "plan_call", expectedStatus: "ready" },
      { id: "mcp-run", kind: "mcp_tool", tool: "run_call", confirmation: true, expectedStatus: "started" },
      { id: "mcp-get", kind: "mcp_tool", tool: "get_call_run", expectedStatus: "completed" },
    ],
    expected: {
      terminalStatus: "completed",
      outreachSuppressed: false,
      persistSameRunId: true,
      confirmationRequired: true,
      escalation: "none",
      answers: { consent: true, q01: "Very positive" },
      forbiddenSubstrings: [TOKEN.replace("REDACTED", "live-token")],
    },
  },
  {
    id: "replay-e2e-callback-resume",
    title: "Callback window then resume with the same idempotency key",
    purpose: "A later-time request must stay resumable and must not mint a second run.",
    synthetic: true,
    contactId: "demo-contact-002",
    seedPlanId: "plan_mock_002",
    seedRunId: "run_mock_002",
    idempotencyKey: "mock-callback-002",
    steps: [
      {
        id: "sms-not-now",
        kind: "sms_turn",
        speaker: "aunty",
        text: "Not right now. Could you text me tomorrow afternoon?",
      },
      {
        id: "system-callback",
        kind: "system_state",
        status: "callback_requested",
        note: "callback_window=15:00-17:00 local consent=pending durable=true",
      },
      {
        id: "rest-create",
        kind: "rest_create",
        contactId: "demo-contact-002",
        idempotencyKey: "mock-callback-002",
        purpose: "fictional survey QA",
      },
      { id: "rest-poll-queued", kind: "rest_poll", responseStatus: "callback" },
      {
        id: "rest-retry",
        kind: "rest_retry",
        sameIdempotencyKey: true,
      },
      { id: "rest-poll-done", kind: "rest_poll", responseStatus: "completed" },
      { id: "mcp-get", kind: "mcp_tool", tool: "get_call_run", expectedStatus: "completed" },
    ],
    expected: {
      terminalStatus: "completed",
      outreachSuppressed: false,
      persistSameRunId: true,
      escalation: "none",
    },
  },
  {
    id: "replay-e2e-transient-retry",
    title: "REST timeout then retry with the same key",
    purpose: "Transient MOCK_TRANSIENT failures must reuse run_id and idempotency key.",
    synthetic: true,
    contactId: "demo-contact-011",
    seedPlanId: "plan_mock_011",
    seedRunId: "run_mock_011",
    idempotencyKey: "mock-011",
    steps: [
      {
        id: "rest-create",
        kind: "rest_create",
        contactId: "demo-contact-011",
        idempotencyKey: "mock-011",
        purpose: "fictional survey QA",
      },
      { id: "rest-timeout", kind: "rest_poll", responseStatus: "timeout" },
      { id: "rest-retry", kind: "rest_retry", sameIdempotencyKey: true },
      { id: "rest-complete", kind: "rest_poll", responseStatus: "completed" },
      { id: "mcp-get", kind: "mcp_tool", tool: "get_call_run", expectedStatus: "completed" },
    ],
    expected: {
      terminalStatus: "completed",
      outreachSuppressed: false,
      persistSameRunId: true,
      escalation: "none",
    },
  },
  {
    id: "replay-e2e-refusal",
    title: "SMS refusal suppresses REST and MCP outreach",
    purpose: "Consent denial must not create a second synthetic outreach.",
    synthetic: true,
    contactId: "demo-contact-001",
    seedPlanId: "plan_mock_001",
    seedRunId: "run_mock_001",
    idempotencyKey: "mock-replay-refusal",
    steps: [
      {
        id: "sms-no",
        kind: "sms_turn",
        speaker: "aunty",
        text: "No, thanks. I do not want to do a survey.",
        questionId: "consent",
        answer: false,
      },
      {
        id: "system-declined",
        kind: "system_state",
        status: "declined",
        note: "follow_up_suppressed=true survey_started=false",
      },
      {
        id: "rest-create",
        kind: "rest_create",
        contactId: "demo-contact-001",
        idempotencyKey: "mock-replay-refusal",
        purpose: "fictional survey QA",
      },
      { id: "mcp-run-blocked", kind: "mcp_tool", tool: "run_call", confirmation: true, expectedStatus: "blocked" },
    ],
    expected: {
      terminalStatus: "blocked",
      outreachSuppressed: true,
      persistSameRunId: true,
      escalation: "none",
      answers: { consent: false },
    },
  },
  {
    id: "replay-e2e-distress",
    title: "Distress answer stops probing and redacts the REST/MCP summary",
    purpose: "Safety-sensitive SMS answers persist a code, then complete the run as an escalation.",
    synthetic: true,
    contactId: "demo-contact-033",
    seedPlanId: "plan_mock_033",
    seedRunId: "run_mock_033",
    idempotencyKey: "mock-replay-distress",
    steps: [
      {
        id: "sms-yes",
        kind: "sms_turn",
        speaker: "aunty",
        text: "Yes.",
        questionId: "consent",
        answer: true,
      },
      {
        id: "sms-q06",
        kind: "sms_turn",
        speaker: "aunty",
        text: "I have chest pain and it is hard to breathe.",
        questionId: "q06",
        answer: "I have chest pain and it is hard to breathe.",
      },
      {
        id: "rest-create",
        kind: "rest_create",
        contactId: "demo-contact-033",
        idempotencyKey: "mock-replay-distress",
        purpose: "fictional survey QA",
      },
      {
        id: "rest-poll",
        kind: "rest_poll",
        responseStatus: "completed",
        result: { outcome: "safety_escalation", q06: SAFETY_CONCERN_CODE },
      },
      { id: "mcp-plan", kind: "mcp_tool", tool: "plan_call", expectedStatus: "ready" },
      { id: "mcp-run", kind: "mcp_tool", tool: "run_call", confirmation: true, expectedStatus: "started" },
      { id: "mcp-get", kind: "mcp_tool", tool: "get_call_run", expectedStatus: "completed" },
    ],
    expected: {
      terminalStatus: "completed",
      outreachSuppressed: false,
      persistSameRunId: true,
      escalation: "safety_script",
      answers: { consent: true, q06: SAFETY_CONCERN_CODE },
      forbiddenSubstrings: ["chest pain", "hard to breathe"],
    },
  },
  {
    id: "replay-e2e-pii",
    title: "PII in an open answer is redacted across SMS persist, REST, and MCP",
    purpose: "An example.test address must never leave the replay as cleartext.",
    synthetic: true,
    contactId: "demo-contact-008",
    seedPlanId: "plan_mock_008",
    seedRunId: "run_mock_008",
    idempotencyKey: "mock-replay-pii",
    steps: [
      {
        id: "sms-yes",
        kind: "sms_turn",
        speaker: "aunty",
        text: "Yes.",
        questionId: "consent",
        answer: true,
      },
      {
        id: "sms-q08",
        kind: "sms_turn",
        speaker: "aunty",
        text: "Email me at aunty.pat@example.test if you need more detail.",
        questionId: "q08",
        answer: "Email me at aunty.pat@example.test if you need more detail.",
      },
      {
        id: "rest-create",
        kind: "rest_create",
        contactId: "demo-contact-008",
        idempotencyKey: "mock-replay-pii",
        purpose: "fictional survey QA",
      },
      { id: "rest-poll", kind: "rest_poll", responseStatus: "completed" },
      { id: "mcp-plan", kind: "mcp_tool", tool: "plan_call", expectedStatus: "ready" },
      { id: "mcp-run", kind: "mcp_tool", tool: "run_call", confirmation: true, expectedStatus: "started" },
      { id: "mcp-get", kind: "mcp_tool", tool: "get_call_run", expectedStatus: "completed" },
    ],
    expected: {
      terminalStatus: "completed",
      outreachSuppressed: false,
      persistSameRunId: true,
      escalation: "none",
      answers: { consent: true, q08: "Email me at [redacted-email] if you need more detail." },
      forbiddenSubstrings: ["aunty.pat@example.test"],
    },
  },
  {
    id: "replay-e2e-skip-remaining",
    title: "Skip-the-rest SMS branch then complete the run without further questions",
    purpose: "Optional remaining questions stay unasked; the run still finishes.",
    synthetic: true,
    contactId: "demo-contact-016",
    seedPlanId: "plan_mock_016",
    seedRunId: "run_mock_016",
    idempotencyKey: "mock-replay-skip",
    steps: [
      {
        id: "sms-yes",
        kind: "sms_turn",
        speaker: "aunty",
        text: "Yes.",
        questionId: "consent",
        answer: true,
      },
      {
        id: "sms-skip",
        kind: "sms_turn",
        speaker: "aunty",
        text: "Please skip the rest.",
        questionId: "q06",
        answer: "Please skip the rest.",
      },
      {
        id: "rest-create",
        kind: "rest_create",
        contactId: "demo-contact-016",
        idempotencyKey: "mock-replay-skip",
        purpose: "fictional survey QA",
      },
      { id: "rest-poll", kind: "rest_poll", responseStatus: "completed" },
      { id: "mcp-get", kind: "mcp_tool", tool: "get_call_run", expectedStatus: "completed" },
    ],
    expected: {
      terminalStatus: "completed",
      outreachSuppressed: false,
      persistSameRunId: true,
      escalation: "stop_probing",
      answers: { consent: true, q06: "Please skip the rest." },
    },
  },
  {
    id: "replay-e2e-mcp-confirm",
    title: "MCP run_call is confirmation-gated",
    purpose: "plan_call must precede run_call, and confirmation must be explicit.",
    synthetic: true,
    contactId: "demo-contact-012",
    seedPlanId: "plan_mock_012",
    seedRunId: "run_mock_012",
    idempotencyKey: "mock-mcp-012",
    steps: [
      { id: "mcp-run-too-soon", kind: "mcp_tool", tool: "run_call", confirmation: true, expectedStatus: "blocked" },
      { id: "mcp-plan", kind: "mcp_tool", tool: "plan_call", expectedStatus: "ready" },
      { id: "mcp-run-no-confirm", kind: "mcp_tool", tool: "run_call", confirmation: false, expectedStatus: "blocked" },
      { id: "mcp-run", kind: "mcp_tool", tool: "run_call", confirmation: true, expectedStatus: "started" },
      { id: "mcp-get", kind: "mcp_tool", tool: "get_call_run", expectedStatus: "completed" },
    ],
    expected: {
      terminalStatus: "completed",
      outreachSuppressed: false,
      persistSameRunId: true,
      confirmationRequired: true,
      escalation: "none",
    },
  },
  {
    id: "replay-e2e-provider-failover",
    title: "CALL-E outage fails over to the backup phone API",
    purpose: "Primary provider_unavailable must hand the dial to backup-phone-api and keep one run_id.",
    synthetic: true,
    contactId: "demo-contact-failover",
    seedPlanId: "plan_mock_failover",
    seedRunId: "backup-phone-api_run_failover",
    idempotencyKey: "mock-replay-failover",
    steps: [
      {
        id: "rest-create",
        kind: "rest_create",
        contactId: "demo-contact-failover",
        idempotencyKey: "mock-replay-failover",
        purpose: "fictional survey QA",
      },
      {
        id: "primary-outage",
        kind: "provider_place",
        providerId: "call-e",
        accepted: false,
        status: "failed",
        failureCode: "provider_unavailable",
      },
      {
        id: "backup-accept",
        kind: "provider_place",
        providerId: "backup-phone-api",
        accepted: true,
        status: "in_progress",
        providerCallId: "backup-phone-api_run_failover",
      },
      {
        id: "failover-event",
        kind: "provider_failover",
        from: "call-e",
        to: "backup-phone-api",
        attempts: 2,
      },
      { id: "rest-poll", kind: "rest_poll", responseStatus: "completed" },
      { id: "mcp-get", kind: "mcp_tool", tool: "get_call_run", expectedStatus: "completed" },
    ],
    expected: {
      terminalStatus: "completed",
      outreachSuppressed: false,
      persistSameRunId: true,
      escalation: "none",
      phoneProviderId: "backup-phone-api",
      failoverAttempts: 2,
    },
  },
  {
    id: "replay-e2e-failover-exhausted",
    title: "Ordered failover exhausts without accepting a run",
    purpose: "When every phone API is down, do not mint a second live dial on retry of the same key.",
    synthetic: true,
    contactId: "demo-contact-outage",
    seedPlanId: "plan_mock_outage",
    seedRunId: "run_mock_outage",
    idempotencyKey: "mock-replay-outage",
    steps: [
      {
        id: "rest-create",
        kind: "rest_create",
        contactId: "demo-contact-outage",
        idempotencyKey: "mock-replay-outage",
        purpose: "fictional survey QA",
      },
      {
        id: "primary-outage",
        kind: "provider_place",
        providerId: "call-e",
        accepted: false,
        status: "failed",
        failureCode: "provider_unavailable",
      },
      {
        id: "backup-outage",
        kind: "provider_place",
        providerId: "backup-phone-api",
        accepted: false,
        status: "failed",
        failureCode: "timeout",
      },
      {
        id: "tertiary-outage",
        kind: "provider_place",
        providerId: "tertiary-phone-api",
        accepted: false,
        status: "failed",
        failureCode: "provider_unavailable",
      },
      {
        id: "failover-event",
        kind: "provider_failover",
        from: "call-e",
        to: "tertiary-phone-api",
        attempts: 3,
      },
      { id: "rest-retry", kind: "rest_retry", sameIdempotencyKey: true },
    ],
    expected: {
      terminalStatus: "queued",
      outreachSuppressed: false,
      persistSameRunId: true,
      escalation: "none",
      phoneProviderId: null,
      failoverAttempts: 3,
    },
  },
];

export function getReplayFixture(id: string): EndToEndReplayFixture {
  const fixture = END_TO_END_REPLAY_FIXTURES.find((item) => item.id === id);
  if (!fixture) throw new Error(`Unknown replay fixture: ${id}`);
  return fixture;
}

export function assertReplayInvariants(fixture: EndToEndReplayFixture, state: ReplayState): string[] {
  const failures: string[] = [];
  if (state.status !== fixture.expected.terminalStatus) {
    failures.push(`status ${state.status} !== ${fixture.expected.terminalStatus}`);
  }
  if (state.outreachSuppressed !== fixture.expected.outreachSuppressed) {
    failures.push(`outreachSuppressed ${String(state.outreachSuppressed)} !== ${String(fixture.expected.outreachSuppressed)}`);
  }
  if (state.escalation !== fixture.expected.escalation) {
    failures.push(`escalation ${state.escalation} !== ${fixture.expected.escalation}`);
  }
  if (fixture.expected.persistSameRunId && new Set(state.mintedRunIds).size > 1) {
    failures.push(`minted more than one run_id: ${state.mintedRunIds.join(",")}`);
  }
  if (state.runId && state.runId !== fixture.seedRunId && !fixture.expected.outreachSuppressed) {
    failures.push(`run_id drifted from seed ${fixture.seedRunId}`);
  }
  if (fixture.expected.answers) {
    for (const [key, value] of Object.entries(fixture.expected.answers)) {
      if (state.answers[key] !== value) failures.push(`answer ${key} ${String(state.answers[key])} !== ${String(value)}`);
    }
  }
  const serialized = JSON.stringify(state.answers);
  for (const needle of fixture.expected.forbiddenSubstrings ?? []) {
    if (serialized.includes(needle)) failures.push(`persisted answers still contain ${needle}`);
  }
  if (state.events.some((event) => /Bearer\s+(?!<REDACTED>)\S+/i.test(event))) {
    failures.push("event log contains a non-redacted bearer token");
  }
  if (
    fixture.expected.phoneProviderId !== undefined &&
    state.phoneProviderId !== fixture.expected.phoneProviderId
  ) {
    failures.push(
      `phoneProviderId ${String(state.phoneProviderId)} !== ${String(fixture.expected.phoneProviderId)}`,
    );
  }
  if (
    fixture.expected.failoverAttempts !== undefined &&
    state.failoverAttempts !== fixture.expected.failoverAttempts
  ) {
    failures.push(
      `failoverAttempts ${state.failoverAttempts} !== ${fixture.expected.failoverAttempts}`,
    );
  }
  return failures;
}
