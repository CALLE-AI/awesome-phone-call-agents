/**
 * The authorisation trail as a file.
 *
 * A post-incident review does not paste evidence out of somebody's clipboard.
 * It attaches a file to a ticket, and six months later somebody opens that file
 * to answer a question nobody thought to ask at the time. "Who authorised this
 * deploy" is the usual one. "Why did twenty minutes pass before anyone did" is
 * the one that actually changes a rota.
 *
 * So this export is built to be read cold, by a person who was not there:
 *
 * - Every rung dialled, not only the one that answered. The primary not picking
 *   up at 03:12 is a finding about the rota, and it disappears if only the
 *   successful rung is recorded.
 * - Both clocks. When the page was raised, when a human decided, and how long
 *   each call took, because the gap is the thing under review.
 * - The words. The engineer's stated reason and the transcript, so a decision
 *   can be read rather than inferred from an enum.
 * - What was simulated. A run with no phone call in it is labelled as one in
 *   the file itself, not only in the interface that produced it, because the
 *   file is what outlives the session.
 *
 * It records what happened. It draws no conclusions.
 */

/** Bumped when the shape changes, so an old file is still readable later. */
export const AUDIT_SCHEMA_VERSION = 1;

/**
 * Builds the downloadable audit record for one incident.
 *
 * @param {object} input
 * @param {object} input.scenario The incident.
 * @param {object|null} input.outcome The ladder outcome.
 * @param {string} input.incidentId
 * @param {boolean} input.isLive Whether a phone could actually ring.
 * @param {string} [input.connectionMode] How the app reached CALL-E.
 * @param {string} [input.generatedAt] Overridable for deterministic tests.
 * @returns {object}
 */
export function buildAuditRecord({
  scenario,
  outcome,
  incidentId,
  isLive,
  connectionMode = 'simulation',
  generatedAt = new Date().toISOString()
}) {
  const rungs = outcome?.rungs || [];

  return {
    schemaVersion: AUDIT_SCHEMA_VERSION,
    generatedAt,
    incidentId,

    // First field after the identifiers, deliberately. Everything below means
    // something different depending on this one value, and a reader who skims
    // must not get three paragraphs in before learning no phone rang.
    run: {
      live: Boolean(isLive),
      connectionMode,
      note: isLive
        ? 'Live run. Calls in this record were placed to real telephone numbers.'
        : 'Simulated run. No call was placed, no number was dialled, and no credit was spent. Every decision below is scripted.'
    },

    incident: scenario ? {
      id: scenario.id,
      title: scenario.title,
      service: scenario.service,
      severity: scenario.severity,
      errorCode: scenario.errorCode,
      impact: scenario.impact,
      rootCause: scenario.rcaReport?.rootCause || null,
      faultClass: scenario.rcaReport?.vulnerabilityClass || null,
      attributedCommit: scenario.rcaReport?.offendingCommit || null
    } : null,

    authorisation: outcome ? {
      authorised: Boolean(outcome.authorised),
      decision: outcome.decision,
      decidedBy: outcome.decidedBy ? {
        name: outcome.decidedBy.displayName || outcome.decidedBy.name || null,
        role: outcome.decidedBy.role || null,
        // The number that was actually dialled. A rota is edited between
        // incidents, so "we called the primary" does not establish which
        // handset rang, and that is exactly what gets disputed.
        phone: outcome.decidedBy.phone || null
      } : null,
      statedReason: outcome.reason || null,
      completionConfidence: outcome.confidence ?? null,
      resolved: Boolean(outcome.resolved)
    } : {
      authorised: false,
      decision: 'no_decision',
      decidedBy: null,
      statedReason: 'The rota was never paged for this incident.',
      completionConfidence: null,
      resolved: false
    },

    timings: {
      pagedAt: outcome?.pagedAt || null,
      decidedAt: outcome?.decidedAt || null,
      elapsedMs: outcome?.elapsedMs ?? null,
      // Spelled out because a reviewer should not have to know that the clock
      // starts before anyone picks up.
      measures: 'From the page being raised to a human decision or the rota being exhausted. Includes time spent dialling rungs that never answered.'
    },

    rungs: rungs.map((rung, position) => ({
      position: position + 1,
      attempt: rung.attempt ?? 1,
      contact: {
        id: rung.contact?.id || null,
        name: rung.contact?.displayName || rung.contact?.name || null,
        role: rung.contact?.role || null,
        phone: rung.contact?.phone || null,
        region: rung.contact?.region || null
      },
      mode: rung.mode,
      callId: rung.callId || null,
      idempotencyKey: rung.idempotencyKey || null,
      dialledAt: rung.dialledAt || null,
      endedAt: rung.endedAt || null,
      durationMs: rung.durationMs ?? null,
      answeredBy: rung.outcome?.answeredBy || 'unknown',
      // Distinguishes a rung that rang unanswered from one that was never
      // dialled at all. Both leave the deploy blocked and they are not the
      // same finding about the rota.
      callPlaced: rung.outcome?.callPlaced !== false,
      decision: rung.outcome?.decision || 'no_decision',
      authorised: Boolean(rung.outcome?.authorised),
      statedReason: rung.outcome?.reason || null,
      completionConfidence: rung.outcome?.confidence ?? null,
      taskCompleted: rung.snapshot?.taskCompleted ?? null,
      // Preserved verbatim and never interpreted, which is what the platform
      // asks for: it carries no published enum and a decline cannot be read
      // out of it. Kept because support will ask for it.
      failureCode: rung.snapshot?.failureCode || null,
      callback: rung.callback || null,
      questionsAsked: rung.outcome?.questionsAsked || [],
      evidence: rung.snapshot?.evidence || [],
      transcript: (rung.snapshot?.transcript || rung.transcript || []).map((turn) => ({
        speaker: turn.speaker,
        text: turn.text,
        offsetSeconds: turn.offsetSeconds ?? null
      }))
    })),

    gate: {
      rule: 'No production change is applied unless the named on-call engineer authorised it by voice on a completed call.',
      satisfied: Boolean(outcome?.authorised),
      outcome: outcome?.authorised
        ? 'A named engineer authorised the change on the phone, and it was applied.'
        : 'No voice authorisation was obtained, so the staged hotfix was not applied to production.'
    }
  };
}

/** Filename for a downloaded audit record. */
export function auditFileName(incidentId) {
  const safe = String(incidentId || 'incident').replace(/[^A-Za-z0-9_-]/g, '');
  return `calle-audit-${safe || 'incident'}.json`;
}
