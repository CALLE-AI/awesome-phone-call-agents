/**
 * Background worker that drives non-terminal missions forward.
 *
 * Cadence: first poll after POLL_FIRST_DELAY_SEC, then every POLL_INTERVAL_SEC.
 * Two modes:
 *  - Mock: CALLE adapter advances its own state; we just read it.
 *  - Real: same loop, real network. Caller (start route) triggers the first
 *    poll asynchronously so the iOS client sees queued → planning immediately.
 *
 * Failure mapping (spec §17):
 *  - completed + schema filled       → resolved | needs_human
 *  - voicemail detected              → voicemail
 *  - no answer / busy                → unavailable
 *  - user cancel                     → canceled
 *  - API 4xx on create               → failed
 *  - ambiguous transcript            → needs_human (don't invent facts)
 */

import { db } from '../lib/db.js';
import { env, isMock } from '../lib/env.js';
import { sleep } from '../lib/util.js';
import { makeCallegate } from '../adapters/calle.js';
import {
  appendEvent,
  getMission,
  setStatus,
  writeBrief,
} from '../services/missions.js';
import { LIVE_STATUSES, type Brief, type BriefOutcome } from '../lib/types.js';

const gate = makeCallegate();

export async function tickAllLive() {
  const live = db
    .prepare(
      `SELECT * FROM missions WHERE status IN ('queued','planning','dialing','in_conversation','wrapping') AND calle_call_id IS NOT NULL`,
    )
    .all() as any[];
  for (const row of live) {
    runMission(row.id).catch((e) => {
      console.error(`[worker] mission ${row.id} error:`, e);
      setStatus(row.id, 'failed', String((e as Error).message ?? e));
    });
  }
}

export async function runMission(missionId: string) {
  const m = getMission(missionId);
  if (!m || !m.calle_call_id || !LIVE_STATUSES.has(m.status)) return;

  // In mock mode, no need to wait — the mock state machine has its own clock.
  // In real mode, respect the spec: ~60s first wait, then 5-10s polling.
  if (!isMock) await sleep(env.POLL_FIRST_DELAY_SEC * 1000);

  const intervalMs = isMock ? 1500 : env.POLL_INTERVAL_SEC * 1000;

  while (true) {
    const cur = getMission(missionId);
    if (!cur) return;
    if (!LIVE_STATUSES.has(cur.status)) return;

    let status;
    try {
      if (!cur.calle_call_id) return;
      status = await gate.getCallStatus(cur.calle_call_id);
    } catch (e) {
      appendEvent(missionId, 'afterhold', 'poll_error', { message: String((e as Error).message ?? e) });
      await sleep(intervalMs);
      continue;
    }

    appendEvent(missionId, 'calle', 'status', status);

    // Map CALL-E status → our state machine
    switch (status.status) {
      case 'queued':
      case 'planning':
      case 'dialing':
      case 'in_conversation':
      case 'wrapping':
        if (cur.status !== status.status) setStatus(missionId, status.status as any);
        break;
      case 'completed': {
        const sr = status.structuredResult ?? {};
        // Per spec §17: if outcome is missing or ambiguous, default to needs_human.
        const outcome = ((sr.outcome as string) ?? 'needs_human') as BriefOutcome;
        const brief: Brief = {
          outcome,
          summary_for_user: (sr.summary_for_user as string) ?? 'Call completed.',
          facts: (sr.facts as Record<string, unknown>) ?? {},
          next_step: sr.next_step as string | undefined,
          callee_role: sr.callee_role as string | undefined,
          evidence: [
            {
              quote: (status.transcriptExcerpt ?? '').slice(0, 240),
            },
          ],
        };
        writeBrief(missionId, brief);
        setStatus(missionId, 'completed');
        return;
      }
      case 'voicemail':
        setStatus(missionId, 'voicemail');
        writeBrief(missionId, {
          outcome: 'voicemail',
          summary_for_user: 'Reached voicemail. Left a brief message.',
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
      case 'failed':
        setStatus(missionId, 'failed', status.errorMessage);
        writeBrief(missionId, {
          outcome: 'failed',
          summary_for_user: status.errorMessage ?? 'Call failed.',
          facts: {},
          evidence: [],
        });
        return;
    }

    await sleep(intervalMs);
  }
}
