import type { CallRecord } from "./types";

/** Execution can be in progress before dialing or during result finalization. */
export function callProgress(call: CallRecord | null) {
  if (
    call?.attemptStatus === "completed" ||
    call?.attemptStatus === "failed" ||
    call?.attemptStatus === "canceled"
  ) {
    return {
      phase: "finalizing" as const,
      label: "Finishing up…",
      message: "The call attempt has ended. Waiting for the final result.",
    };
  }

  if (call?.transcript.some((turn) => turn.speaker === "user" && turn.text.trim())) {
    return { phase: "conversation" as const, label: "On the call", message: null };
  }

  if (call?.transcript.some((turn) => turn.speaker === "bot" && turn.text.trim())) {
    return {
      phase: "waiting" as const,
      label: "Waiting for a response…",
      message: "Clarity has started speaking. No response has been recorded yet.",
    };
  }

  return {
    phase: "connecting" as const,
    label: "Connecting…",
    message: "The call has been requested. Waiting for a response; no conversation has been recorded yet.",
  };
}

/** Describe the recorded outcome without attributing provider errors to the candidate. */
export function callFailure(call: CallRecord) {
  const hasSpeech = call.transcript.some((turn) => turn.text.trim());
  const diagnosis = callDiagnosis(call);

  if (call.status === "canceled") {
    return {
      title: "Call canceled",
      message: hasSpeech
        ? "The phone screen was canceled before it finished. Review the recorded conversation below."
        : "The phone screen was canceled. No conversation was recorded.",
      diagnosis,
    };
  }

  if (hasSpeech) {
    return {
      title: "Phone screen incomplete",
      message: "The call ended before the phone screen finished. Review the recorded conversation below.",
      diagnosis,
    };
  }

  return {
    title: "Call could not connect",
    message: "No conversation was recorded and no questions were answered. You can check the number and try again later.",
    diagnosis,
  };
}

export type CallDiagnosis = {
  /** What the carrier actually did, in plain language. */
  reason: string;
  /** What to do about it, or why it is not the candidate's doing. */
  hint: string;
  /** The provider's own code, kept verbatim so a failure stays debuggable. */
  code: string | null;
  /** The provider's raw text. Never rendered as prose — see `reason`. */
  raw: string | null;
};

/**
 * Why the call did not happen, for the operator.
 *
 * This is deliberately separate from `message`. CALL-E reports a declined call
 * as `DECLINED (Hangup by: user)`, and "user" there is the SIP endpoint, not a
 * person who chose to hang up on us — a device or carrier filter that rejects a
 * call before it rings reports exactly the same thing. Printing that text as
 * prose would accuse the candidate of refusing the call on the strength of a
 * string that does not mean that, so the raw wording stays out of the sentence
 * and the operator gets a reading of it instead.
 */
export function callDiagnosis(call: CallRecord): CallDiagnosis | null {
  const code = call.failureCode;
  const raw = call.failureMessage;
  if (!code && !raw) return null;

  const signal = `${code ?? ""} ${raw ?? ""}`.toLowerCase();
  const base = { code, raw };

  // SIP 603 Decline. A zero-length attempt means it never rang.
  if (/\b603\b|declined/.test(signal)) {
    return {
      ...base,
      reason: "The receiving phone rejected the call before it rang.",
      hint:
        "This is normally a carrier spam filter, Do Not Disturb, or a “silence unknown callers” setting — an unrecognised caller ID gets blocked before the phone rings. It is not a signal about the candidate. Allow the CALL-E number on the receiving phone, or try one without call screening.",
    };
  }

  if (/\b486\b|busy/.test(signal)) {
    return { ...base, reason: "The line was busy.", hint: "Nothing is wrong with the number. Try again in a few minutes." };
  }

  if (/\b(408|480)\b|no[_ ]?answer|timeout/.test(signal)) {
    return {
      ...base,
      reason: "The call rang out with no answer.",
      hint: "The number is reachable. Try again when the candidate is expecting the call.",
    };
  }

  if (/\b(404|484|604)\b|invalid|unallocated|not[_ ]?in[_ ]?service/.test(signal)) {
    return {
      ...base,
      reason: "The carrier could not route the call to that number.",
      hint: "Check the number in the application. It must be a dialable E.164 line, and must not be a landline-only or disconnected number.",
    };
  }

  if (/voicemail|machine/.test(signal)) {
    return {
      ...base,
      reason: "The call reached voicemail rather than a person.",
      hint: "Clarity does not leave messages, because a phone screen needs a live conversation. Try again later.",
    };
  }

  return {
    ...base,
    reason: "The call did not connect, and the carrier gave no reason Clarity recognises.",
    hint: "The provider's own code is shown above so it can be looked up.",
  };
}
