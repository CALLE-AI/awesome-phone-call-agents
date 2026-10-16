/**
 * Placing a call. Shared by POST /v1/missions/:id/start (immediate) and the
 * sweeper (scheduled missions that have come due).
 *
 * Every gate is re-checked at the real dial time, so a schedule chosen outside
 * quiet hours cannot be used to dial inside them.
 */

import { db } from '../lib/db.js';
import { now } from '../lib/util.js';
import type { MissionStatus } from '../lib/types.js';
import { CalleSubmitError, makeCallegate } from '../adapters/calle.js';
import { runMission } from '../workers/missionWorker.js';
import { getUser } from './auth.js';
import { appendEvent, claimStatus, getMission, setStatus, updateMission, type MissionRow } from './missions.js';
import { buildTaskFor } from './taskString.js';
import {
  enforceRateLimit,
  ensureCalleEnabled,
  ensureConsentGranted,
  ensureNotQuietHours,
  ensureNumberAllowed,
} from './safety.js';

export type DispatchResult =
  | { ok: true }
  | { ok: false; code: number; error: string; detail?: string };

/** Run every pre-dial gate for a call placed right now. Throws errors carrying `statusCode`. */
export function runDialGates(m: MissionRow) {
  const u = getUser(m.user_id)!;
  ensureCalleEnabled();
  ensureConsentGranted(u.id);
  ensureNumberAllowed(u.id, m.e164);
  ensureNotQuietHours(u.quiet_hours_start, u.quiet_hours_end);
}

/**
 * Claim the mission (from one of `from` → queued) and create the CALL-E call.
 * Caller must have run the gates. The atomic claim means a second /start, a
 * cancel, or a concurrent sweeper tick can never produce a second call.
 */
export async function dispatch(missionId: string, from: MissionStatus[]): Promise<DispatchResult> {
  const m = getMission(missionId);
  if (!m) return { ok: false, code: 404, error: 'not_found' };
  if (!claimStatus(m.id, from, 'queued')) return { ok: false, code: 409, error: 'not_startable', detail: m.status };

  try {
    enforceRateLimit(m.user_id);
  } catch (e) {
    updateMission(m.id, { status: m.status }); // undo the claim; nothing was sent
    throw e;
  }

  const task = m.task_string ?? buildTaskFor(m);
  if (!m.task_string) updateMission(m.id, { task_string: task });

  try {
    const { calle_call_id } = await makeCallegate().createCall({
      task,
      resultSchema: JSON.parse(m.extract_schema),
      phoneNumber: m.e164,
      region: m.region,
      language: m.language,
      idempotencyKey: m.idempotency_key,
      missionId: m.id,
    });
    updateMission(m.id, { calle_call_id, started_at: now() });
    appendEvent(m.id, 'calle', 'call_created', { calle_call_id });
  } catch (e) {
    const err = e instanceof CalleSubmitError ? e : new CalleSubmitError(String((e as Error)?.message ?? e), true);
    if (err.ambiguous) {
      // The call may exist. Never mark this failed or allow a retry until an
      // operator checks the CALL-E dashboard and reconciles it.
      setStatus(m.id, 'submission_unknown', err.message);
      return { ok: false, code: 502, error: 'calle_submission_unknown', detail: err.message };
    }
    setStatus(m.id, 'failed', err.message);
    return { ok: false, code: 502, error: 'calle_create_rejected', detail: err.message };
  }

  // Don't await — the worker advances the mission through the phases.
  setImmediate(() =>
    runMission(m.id).catch((e) => console.error('[dispatch] runMission error', String((e as Error)?.message ?? e))),
  );
  return { ok: true };
}

/** Sweeper hook: dial scheduled missions whose time has come, re-checking every gate. */
export async function dispatchDueScheduled() {
  const due = db
    .prepare(`SELECT * FROM missions WHERE status = 'scheduled' AND schedule_at <= ?`)
    .all(now()) as MissionRow[];
  for (const m of due) {
    try {
      runDialGates(m);
    } catch (e: any) {
      // A gate failed at dial time (quiet hours, kill switch, consent or
      // allowlist removed, rate limit). Do not dial; tell the user instead.
      if (claimStatus(m.id, ['scheduled'], 'failed')) {
        setStatus(m.id, 'failed', `Not dialed at scheduled time: ${e?.message ?? e}`);
      }
      continue;
    }
    try {
      await dispatch(m.id, ['scheduled']);
    } catch (e: any) {
      // Rate limit hit at dial time. The claim was undone and nothing was sent.
      if (claimStatus(m.id, ['scheduled'], 'failed')) {
        setStatus(m.id, 'failed', `Not dialed at scheduled time: ${e?.message ?? e}`);
      }
    }
  }
}
