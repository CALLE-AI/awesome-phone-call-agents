/**
 * Background worker that drives non-terminal missions forward.
 *
 * Cadence: first poll after POLL_FIRST_DELAY_SEC, then every POLL_INTERVAL_SEC.
 * Two modes:
 *  - Mock: CALLE adapter advances its own state; we just read it.
 *  - Real: same loop, real network. Caller (dispatch) triggers the first
 *    poll asynchronously so the iOS client sees queued → planning immediately.
 *
 * Failure mapping (spec §17):
 *  - completed + schema filled       → resolved | needs_human
 *  - voicemail detected              → voicemail
 *  - no answer / busy                → unavailable
 *  - user cancel                     → canceled (local only; see SKILL.md)
 *  - API 4xx on create               → failed
 *  - create outcome unknown          → submission_unknown (reconcile before retry)
 *  - ambiguous transcript            → needs_human (don't invent facts)
 */

import { db } from '../lib/db.js';
import { env, isMock } from '../lib/env.js';
import { maskPhones, sleep } from '../lib/util.js';
import { makeCallegate } from '../adapters/calle.js';
import {
  appendEvent,
  getMission,
  setStatus,
  writeBrief,
} from '../services/missions.js';
import { LIVE_STATUSES, type Brief, type BriefOutcome } from '../lib/types.js';

const gate = makeCallegate();

const OUTCOMES: ReadonlySet<string> = new Set(['resolved', 'needs_human', 'voicemail', 'unavailable', 'refused', 'failed']);

// One poller per mission. The 5s sweeper would otherwise start a new loop for
// every live mission on every tick.
const polling = new Set<string>();

export async function tickAllLive() {
  const live = db
    .prepare(
      `SELECT id FROM missions WHERE status IN ('queued','planning','dialing','in_conversation','wrapping') AND calle_call_id IS NOT NULL`,
    )
    .all() as Array<{ id: string }>;
  for (const row of live) {
    runMission(row.id).catch((e) => {
      console.error(`[worker] mission ${row.id} error:`, maskPhones(String((e as Error).message ?? e)));
    });
  }
}

export async function runMission(missionId: string) {
  if (polling.has(missionId)) return;
  const m = getMission(missionId);
  if (!m || !m.calle_call_id || !LIVE_STATUSES.has(m.status)) return;

  polling.add(missionId);
  try {
    await poll(missionId);
  } finally {
    polling.delete(missionId);
  }
}

async function poll(missionId: string) {
  // In mock mode, no need to wait — the mock state machine has its own clock.
  // In real mode, respect the spec: ~60s first wait, then 5-10s polling.
  if (!isMock) await sleep(env.POLL_FIRST_DELAY_SEC * 1000);

  const intervalMs = isMock ? 1500 : env.POLL_INTERVAL_SEC * 1000;

  while (true) {
    const cur = getMission(missionId);
    if (!cur) return;
    // Stops here after a local cancel. The CALL-E call itself is not recalled.
    if (!LIVE_STATUSES.has(cur.status)) return;

    let status;
    try {
      if (!cur.calle_call_id) return;
      status = await gate.getCallStatus(cur.calle_call_id);
    } catch (e) {
      appendEvent(missionId, 'afterhold', 'poll_error', { message: maskPhones(String((e as Error).message ?? e)) });
      await sleep(intervalMs);
      continue;
    }

    appendEvent(missionId, 'calle', 'status', { status: status.status });

    // Map CALL-E status → our state machine
    switch (status.status) {
      case 'queued':
      case 'planning':
      case 'dialing':
      case 'in_conversation':
      case 'wrapping':
        if (cur.status !== status.status) setStatus(missionId, status.status);
        break;
      case 'completed': {
        const sr = status.structuredResult ?? {};
        // Per spec §17: if outcome is missing or not in the enum, default to needs_human.
        const outcome = (OUTCOMES.has(sr.outcome) ? sr.outcome : 'needs_human') as BriefOutcome;
        const brief: Brief = {
          outcome,
          summary_for_user: typeof sr.summary_for_user === 'string' ? sr.summary_for_user : 'Call completed.',
          facts: sr.facts && typeof sr.facts === 'object' ? (sr.facts as Record<string, unknown>) : {},
          next_step: sr.next_step as string | undefined,
          callee_role: sr.callee_role as string | undefined,
          evidence: status.transcriptExcerpt ? [{ quote: status.transcriptExcerpt.slice(0, 240) }] : [],
        };
        writeBrief(missionId, brief);
        setStatus(missionId, 'completed');
        return;
      }
      case 'voicemail':
        setStatus(missionId, 'voicemail');
        writeBrief(missionId, {
          outcome: 'voicemail',
          summary_for_user: 'Reached voicemail. Nothing was confirmed.',
          facts: {},
          evidence: [],
        });
        return;
      case 'unavailable':
        setStatus(missionId, 'failed');
        writeBrief(missionId, {
          outcome: 'unavailable',
          summary_for_user: 'No answer or busy. Try again later.',
          facts: {},
          evidence: [],
        });
        return;
      case 'refused':
        setStatus(missionId, 'failed');
        writeBrief(missionId, {
          outcome: 'refused',
          summary_for_user: 'The callee declined to help.',
          facts: {},
          evidence: [],
        });
        return;
      case 'canceled':
        setStatus(missionId, 'canceled', 'CALL-E reported the call as canceled.');
        return;
      case 'failed': {
        const msg = maskPhones(status.errorMessage ?? 'Call failed.');
        setStatus(missionId, 'failed', msg);
        writeBrief(missionId, { outcome: 'failed', summary_for_user: msg, facts: {}, evidence: [] });
        return;
      }
    }

    await sleep(intervalMs);
  }
}
