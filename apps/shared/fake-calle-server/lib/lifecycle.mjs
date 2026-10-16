// Call lifecycle: scenario table plus the timer-driven state machine that
// walks a call from "queued" to a terminal status. Statuses are lowercase to
// match the documented Developer API example response. The documented alias
// quirk is preserved: the no_answer scenario emits an event whose message
// carries the raw "NO ANSWER" form, so clients can test normalization.

import { fillSchema, hashString, seededRandom, synthEvidence, synthTranscript } from "./synth.mjs";

export const TERMINAL_STATUSES = new Set([
  "completed",
  "failed",
  "no_answer",
  "voicemail",
  "busy",
  "declined",
  "canceled",
]);

/** Fake-only controls read from call metadata. */
export const METADATA_CONTROLS = {
  scenario: "scenario",
  terminalDelayMs: "terminal_delay_ms",
  progressDelayMs: "progress_delay_ms",
  webhookRepeat: "webhook_repeat",
};

/**
 * @typedef {Object} Scenario
 * @property {string} terminalStatus
 * @property {boolean | null} taskCompleted
 * @property {{ score: number, label: string } | null} confidence
 * @property {{ code: string, message: string } | null} [attemptFailure]
 */

/** @type {Record<string, Scenario>} */
export const SCENARIOS = {
  completed: {
    terminalStatus: "completed",
    taskCompleted: true,
    confidence: { score: 0.92, label: "high" },
  },
  completed_low_confidence: {
    terminalStatus: "completed",
    taskCompleted: true,
    confidence: { score: 0.41, label: "low" },
  },
  no_answer: {
    terminalStatus: "no_answer",
    taskCompleted: false,
    confidence: null,
    attemptFailure: { code: "no_answer", message: "No answer before timeout. Alias form: NO ANSWER." },
  },
  voicemail: {
    terminalStatus: "voicemail",
    taskCompleted: false,
    confidence: null,
    attemptFailure: { code: "voicemail_detected", message: "Voicemail or answering system detected." },
  },
  busy: {
    terminalStatus: "busy",
    taskCompleted: false,
    confidence: null,
    attemptFailure: { code: "busy", message: "Line was busy." },
  },
  declined: {
    terminalStatus: "declined",
    taskCompleted: false,
    confidence: null,
    attemptFailure: { code: "recipient_declined", message: "The recipient declined to continue." },
  },
  failed: {
    terminalStatus: "failed",
    taskCompleted: false,
    confidence: null,
    attemptFailure: { code: "provider_error", message: "Simulated provider error." },
  },
  canceled: {
    terminalStatus: "canceled",
    taskCompleted: false,
    confidence: null,
    attemptFailure: { code: "canceled_by_operator", message: "The call was canceled." },
  },
};

export const DEFAULT_SCENARIO = "completed";

/** @param {unknown} metadata @param {string} key @returns {unknown} */
function control(metadata, key) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return undefined;
  return /** @type {Record<string, unknown>} */ (metadata)[key];
}

/** @param {string} callId @returns {string} */
export function attemptId(callId) {
  return `att_${hashString(`${callId}:attempt`).toString(36)}`;
}

/**
 * Advance a call to its terminal state: fill attempts, transcripts, structured
 * results, evidence, and confidence. Mutates the call object in place.
 * @param {import("../fake-calle-server.mjs").CallRecord} call
 */
export function finalize(call) {
  const scenarioName =
    typeof control(call.metadata, METADATA_CONTROLS.scenario) === "string"
      ? /** @type {string} */ (control(call.metadata, METADATA_CONTROLS.scenario))
      : DEFAULT_SCENARIO;
  const scenario = SCENARIOS[scenarioName] ?? SCENARIOS[DEFAULT_SCENARIO];
  // Seed from task + scenario (not the random call id) so the same task text
  // and scenario always replay the same transcript and values.
  const rng = seededRandom(hashString(`${call.task}:${scenarioName}`));
  const confirmed = scenario.terminalStatus === "completed";

  call.status = scenario.terminalStatus;
  call.task_completed = scenario.taskCompleted;
  call.completion_confidence = scenario.confidence;

  for (const recipient of call.recipients) {
    const attempt = recipient.attempts[recipient.attempts.length - 1];
    if (!attempt) continue;
    attempt.completed_at = new Date().toISOString();
    if (scenario.attemptFailure) {
      attempt.status = scenario.terminalStatus;
      attempt.failure_code = scenario.attemptFailure.code;
      attempt.failure_message = scenario.attemptFailure.message;
      attempt.transcript_turns = [];
      recipient.structured_result = null;
      continue;
    }
    attempt.status = "completed";
    attempt.summary = `Synthetic attempt for scenario ${scenarioName}.`;
    attempt.transcript_turns = synthTranscript(call.task, rng, confirmed ? "confirm" : "decline");
    recipient.structured_result = fillSchema(call.recipient_result_schema, rng);
    recipient.status = "completed";
  }

  call.evidence = call.recipients.flatMap((recipient) =>
    recipient.attempts.flatMap((attempt) => synthEvidence(attempt.transcript_turns)),
  );
  call.structured_result =
    confirmed || scenarioName === "completed_low_confidence"
      ? fillSchema(call.result_schema, rng)
      : null;

  call.scenario = scenarioName;
}

/**
 * Timer chain: queued -> preparing -> in_progress -> terminal.
 * Resolves when the terminal transition has been applied.
 * @param {import("../fake-calle-server.mjs").CallRecord} call
 * @param {(callId: string, type: string, message: string, level?: string) => void} pushEvent
 * @param {() => void} onTerminal
 * @param {{ preparingMs: number, dialingMs: number, terminalMs: number }} timing
 * @returns {NodeJS.Timeout[]} timers so the caller can cancel them on shutdown
 */
export function scheduleLifecycle(call, pushEvent, onTerminal, timing) {
  const timers = [];
  const metadataNumber = (key, fallback) => {
    const raw = control(call.metadata, key);
    const value = typeof raw === "number" ? raw : Number.parseInt(String(raw ?? ""), 10);
    return Number.isFinite(value) && value >= 0 ? value : fallback;
  };
  const preparingMs = metadataNumber(METADATA_CONTROLS.progressDelayMs, timing.preparingMs);
  const terminalMs = metadataNumber(METADATA_CONTROLS.terminalDelayMs, timing.terminalMs);

  timers.push(setTimeout(() => {
    call.status = "preparing";
    pushEvent(call.id, "call.preparing", "Call is preparing.", "info");
  }, preparingMs));

  timers.push(setTimeout(() => {
    call.status = "in_progress";
    for (const recipient of call.recipients) {
      recipient.status = "in_progress";
      recipient.attempts.push({
        id: attemptId(call.id),
        phone: recipient.phones[0] ?? "",
        status: "dialing",
        started_at: new Date().toISOString(),
        completed_at: null,
        summary: null,
        transcript_turns: [],
        provider_call_id: `prov_${hashString(`${call.id}:provider`).toString(36)}`,
        failure_code: null,
        failure_message: null,
      });
    }
    pushEvent(call.id, "call.in_progress", "Call is in progress.", "info");
  }, preparingMs + Math.max(1, Math.floor(timing.dialingMs))));

  timers.push(setTimeout(() => {
    finalize(call);
    const scenario = SCENARIOS[call.scenario];
    const message = scenario?.attemptFailure?.message ?? `Call ${call.status}.`;
    pushEvent(
      call.id,
      `call.${call.status}`,
      message,
      call.status === "completed" ? "info" : "warn",
    );
    onTerminal();
  }, preparingMs + Math.max(1, Math.floor(timing.dialingMs)) + terminalMs));

  return timers;
}
