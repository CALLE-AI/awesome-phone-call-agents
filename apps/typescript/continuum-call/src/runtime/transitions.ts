import type {
  BusinessOutcome,
  IntentState,
  MissionStatus,
} from "./types.js";

/**
 * Transition guards — pure functions, no I/O.
 * See PROJECT.md §4 Transitions.
 */

const INTENT_EDGES: Record<IntentState, IntentState[]> = {
  planned: ["dispatching", "cancelled"],
  dispatching: ["run_known", "ambiguous"],
  run_known: ["terminal"],
  // Recover existing provider run only — never auto-dial a new key from here.
  ambiguous: ["run_known"],
  terminal: [],
  cancelled: [],
};

export function canTransitionIntent(
  from: IntentState,
  to: IntentState,
): boolean {
  return INTENT_EDGES[from]?.includes(to) ?? false;
}

/**
 * In-flight intents are NOT cancelled magically.
 * Only planned → cancelled. In-flight → mission cancellation_requested.
 */
export function canCancelIntentDirectly(state: IntentState): boolean {
  return state === "planned";
}

export function requiresCancellationRequested(state: IntentState): boolean {
  return (
    state === "dispatching" ||
    state === "run_known" ||
    state === "ambiguous"
  );
}

/**
 * Slot Recovery: unresolved/ambiguous must never unlock next waitlist candidate.
 */
export function canUnlockNextConflictingCandidate(args: {
  upstreamState: IntentState;
  upstreamOutcome: BusinessOutcome | null;
  missionStatus: MissionStatus;
}): { ok: boolean; reason: string } {
  const { upstreamState, upstreamOutcome, missionStatus } = args;

  if (missionStatus !== "running") {
    return { ok: false, reason: "mission_not_dispatching" };
  }

  if (upstreamState === "ambiguous" || upstreamState === "dispatching") {
    return { ok: false, reason: "upstream_unresolved" };
  }

  if (upstreamState === "planned") {
    return { ok: false, reason: "upstream_not_started" };
  }

  if (upstreamState === "terminal") {
    if (
      upstreamOutcome === "verbally_confirmed" ||
      upstreamOutcome === "candidate_accepted" ||
      upstreamOutcome === "practice_acknowledged"
    ) {
      return { ok: false, reason: "slot_already_taken" };
    }
    if (upstreamOutcome === "unresolved" || upstreamOutcome === null) {
      return { ok: false, reason: "terminal_but_unresolved" };
    }
    if (upstreamOutcome === "callback_requested") {
      return { ok: false, reason: "callback_pending" };
    }
    // Only an evidenced decline or a completed no-contact disposition unlocks.
    if (
      upstreamOutcome === "declined" ||
      upstreamOutcome === "no_answer" ||
      upstreamOutcome === "voicemail"
    ) {
      return { ok: true, reason: "terminal_non_confirmation" };
    }
    return { ok: false, reason: "terminal_outcome_not_unlocking" };
  }

  return { ok: false, reason: "unknown_state" };
}

/**
 * Confirmation hard rule — an early "yes" is not enough.
 */
export function evaluateVerbalConfirmation(args: {
  confirmationQuestionAsked: boolean;
  answerAfterQuestion: boolean;
  slotMatchesOfferedFact: boolean;
  schemaValid: boolean;
  transcriptResultConflict: boolean;
  reliableTranscript: boolean;
}): BusinessOutcome {
  if (!args.reliableTranscript) return "unresolved";
  if (args.transcriptResultConflict) return "unresolved";
  if (!args.schemaValid) return "unresolved";
  if (!args.confirmationQuestionAsked) return "unresolved";
  if (!args.answerAfterQuestion) return "unresolved";
  if (!args.slotMatchesOfferedFact) return "unresolved";
  return "verbally_confirmed";
}
