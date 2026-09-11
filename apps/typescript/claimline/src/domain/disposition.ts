import type { CallStatus, Disposition, TranscriptTurn } from "./types.js";

/**
 * Fail-closed disposition. A call result is only "auto_ok" when every check
 * passes. Anything ambiguous — a non-completed call, low confidence, an invalid
 * or missing structured result, a voicemail, or a refusal — routes to a human.
 */
export interface DispositionInput {
  status: CallStatus;
  taskCompleted: boolean | null;
  confidenceScore: number | null;
  confidenceLabel: string | null;
  structuredResult: Record<string, unknown> | null;
  schemaValid: boolean;
  voicemailDetected?: boolean;
  refusalDetected?: boolean;
}

export interface DispositionResult {
  disposition: Disposition;
  reason: string;
}

const VOICEMAIL_HINTS = [
  "voicemail",
  "voice mail",
  "leave a message",
  "after the tone",
  "after the beep",
  "not available to take your call",
  "please record your message",
];

const REFUSAL_HINTS = [
  "do not call",
  "don't call",
  "stop calling",
  "not interested",
  "no comment",
  "i refuse",
  "won't answer",
  "will not answer",
  "remove me",
  "hang up",
];

export function detectVoicemail(
  transcript: TranscriptTurn[],
  summary: string | null,
): boolean {
  const haystack = buildHaystack(transcript, summary);
  return VOICEMAIL_HINTS.some((hint) => haystack.includes(hint));
}

export function detectRefusal(
  transcript: TranscriptTurn[],
  summary: string | null,
): boolean {
  const haystack = buildHaystack(transcript, summary);
  return REFUSAL_HINTS.some((hint) => haystack.includes(hint));
}

function buildHaystack(
  transcript: TranscriptTurn[],
  summary: string | null,
): string {
  const parts = transcript.map((t) => t.text);
  if (summary) parts.push(summary);
  return parts.join(" \n ").toLowerCase();
}

export function classifyDisposition(
  input: DispositionInput,
  confidenceThreshold: number,
): DispositionResult {
  if (input.status !== "completed") {
    return needsHuman(`call_not_completed:${input.status}`);
  }
  if (input.voicemailDetected) {
    return needsHuman("voicemail_detected");
  }
  if (input.refusalDetected) {
    return needsHuman("recipient_refused");
  }
  if (input.taskCompleted !== true) {
    return needsHuman("task_not_completed");
  }
  if (input.structuredResult === null) {
    return needsHuman("missing_structured_result");
  }
  if (!input.schemaValid) {
    return needsHuman("structured_result_schema_invalid");
  }
  if (input.confidenceScore === null) {
    return needsHuman("missing_confidence");
  }
  if (input.confidenceScore < confidenceThreshold) {
    return needsHuman(
      `low_confidence:${input.confidenceScore.toFixed(2)}<${confidenceThreshold}`,
    );
  }
  if ((input.confidenceLabel ?? "").toLowerCase() === "low") {
    return needsHuman("low_confidence_label");
  }
  return { disposition: "auto_ok", reason: "all_checks_passed" };
}

function needsHuman(reason: string): DispositionResult {
  return { disposition: "needs_human", reason };
}
