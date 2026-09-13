import type { NormalizedCompanionResult, OrchestrationDecision } from "./types.js";
export interface CompanionDecisionResult {
  decision: OrchestrationDecision;
  reason: string;
}

// Exactly one retry of the vulnerable person, then the trusted circle (decision record DEC-011).
// The full application's specification always required this shape — "programmer une
// nouvelle tentative ; si le nombre maximal de tentatives est atteint :
// contacter le premier proche" — and an earlier decision deferred only the "how many"
// half of it. This is that bound, and it is a bound, not a policy knob: an
// unbounded retry loop would call a vulnerable person forever and never reach
// anyone who could actually help.
export const MAX_COMPANION_ATTEMPTS = 2;

export interface CompanionDecisionContext {
  // Which check-in attempt produced this result: 1 for the first call, 2 for
  // the retry. Read from the persisted call event, never from a counter in
  // memory, so a restart resumes at the correct attempt.
  attemptNumber: number;
}

// Every signal that, stated explicitly by the person, warrants someone checking
// in. Each is a fact the person reported, not an interpretation of their
// condition, and each alone is enough to cascade — there is no priority tier
// left to weigh them against (DEC-011, "Priority removed").
function statedConcerningSignals(result: NormalizedCompanionResult): string[] {
  const signals: Array<[boolean, string]> = [
    [result.fallMentioned === "yes", "a fall"],
    [result.mobilityDifficulty === "yes", "difficulty moving around"],
    [result.painOrInjuryMentioned === "yes", "pain or an injury"],
    [result.unusualConfusion === "yes", "unusual confusion"],
    [result.distressExpressed === "yes", "distress"],
    [result.conversationEndedNormally === "no", "a conversation that ended abnormally"],
    [result.otherAttentionSignal === "yes", "another unusual signal"],
  ];
  return signals.filter(([present]) => present).map(([, label]) => label);
}

// The deterministic rule order
// established (and later simplified to a binary outcome — see
// decision record DEC-011). CALL-E may interpret the
// conversation; it does not control the workflow.
//
// KinCall makes exactly one operational decision — close, or contact the
// trusted circle. There is no priority tier: the original high/medium/low
// distinction never changed what the cascade did, since every escalation ran
// the identical contact sequence. Keeping a label with no behavioural
// consequence would have implied a graded response that does not exist, which
// is closer to false reassurance than to precision. This is an operational
// decision, not a medical triage — KinCall does not assess severity, only
// whether someone should check in.
//
// Two rules deliberately OVERRIDE whatever attention_required the model
// reported — an explicit request for help, and a failure to reach the person —
// because those are operational facts, not judgements, and a model that
// underrates them must not be able to talk KinCall out of acting.
//
// The only path to a closure is the last rule, and it requires positive
// evidence on every axis. Everything else — including attention_required
// "unknown", unknown reachability, and a result that failed validation
// entirely (handled by the caller) — reaches the trusted circle instead, by
// precaution. Ambiguity is never reported as "nothing unusual" (KinCall
// must not assert that someone is safe).
//
// Assumes an already-normalized, well-formed result; a malformed one never
// reaches this function.
export function decideCompanionAction(
  result: NormalizedCompanionResult,
  context: CompanionDecisionContext
): CompanionDecisionResult {
  // ── 1 / 2. Reachability, before anything the model reported ───────────────
  // With no conversation there is nothing to read signals from, so a reported
  // signal here would not be trustworthy either way.
  if (result.personReached === "no") {
    if (context.attemptNumber < MAX_COMPANION_ATTEMPTS) {
      return {
        decision: "RETRY_CHECK_IN",
        reason: "The check-in call did not reach the person — one more attempt is owed.",
      };
    }
    // Bounded: never a third call to the person. Nobody has spoken to them
    // across every attempt, which is exactly when the trusted circle matters.
    return {
      decision: "CONTACT_TRUSTED_PERSON",
      reason: `The person could not be reached in ${MAX_COMPANION_ATTEMPTS} attempts.`,
    };
  }

  // ── 3. An explicit request for help outranks every model judgement ────────
  // "yes" means the person actually asked (the schema's own instruction to the
  // extraction model), never inferred from silence — which is why "unknown"
  // does not land here and falls through to the ordinary rules below.
  if (result.explicitHelpRequested === "yes") {
    return {
      decision: "CONTACT_TRUSTED_PERSON",
      reason: "Person explicitly asked for help.",
    };
  }

  // ── 4. Any explicitly stated concerning signal ─────────────────────────────
  // Reported as something the person said, never as a diagnosis (a safety rule of the full application).
  const stated = statedConcerningSignals(result);
  if (stated.length > 0) {
    return {
      decision: "CONTACT_TRUSTED_PERSON",
      reason: `The person mentioned ${stated.join(", ")}.`,
    };
  }

  // ── 5. The model's own judgement that attention is needed ─────────────────
  if (result.attentionRequired === "yes") {
    return {
      decision: "CONTACT_TRUSTED_PERSON",
      reason: "The check-in indicated that attention is needed.",
    };
  }

  // ── 6. An unjudged result cascades by precaution ───────────────────────────
  if (result.attentionRequired === "unknown") {
    return {
      decision: "CONTACT_TRUSTED_PERSON",
      reason: "The check-in could not be judged either way.",
    };
  }

  // ── 7. The ONLY closure path: positive evidence on every axis ─────────────
  if (
    result.personReached === "yes" &&
    result.conversationEndedNormally === "yes" &&
    result.attentionRequired === "no"
  ) {
    return {
      decision: "LOG_AND_CLOSE",
      reason: "No attention signal detected.",
    };
  }

  // Anything left is ambiguous — most often an ending that could not be
  // confirmed. It must reach a person, not a reassuring close.
  return {
    decision: "CONTACT_TRUSTED_PERSON",
    reason: "The check-in could not be confirmed as unremarkable.",
  };
}
