import { db } from '../lib/db.js';
import { newId, now, hashKey } from '../lib/util.js';
import {
  type MissionStatus,
  type MissionArchetype,
  type Brief,
  TERMINAL_STATUSES,
} from '../lib/types.js';

export interface MissionRow {
  id: string;
  user_id: string;
  e164: string;
  display_name: string;
  goal: string;
  language: string;
  archetype: MissionArchetype;
  schedule_at: number | null;
  extract_schema: string;
  consent_snapshot: string;
  status: MissionStatus;
  calle_call_id: string | null;
  idempotency_key: string;
  task_string: string | null;
  error: string | null;
  created_at: number;
  updated_at: number;
  started_at: number | null;
  ended_at: number | null;
}

export const getMission = (id: string, userId?: string): MissionRow | undefined =>
  db
    .prepare(userId ? 'SELECT * FROM missions WHERE id = ? AND user_id = ?' : 'SELECT * FROM missions WHERE id = ?')
    .get(id, ...(userId ? [userId] : [])) as MissionRow | undefined;

export const listMissions = (userId: string, statusFilter?: 'live' | 'scheduled' | 'done') => {
  let where = 'user_id = ?';
  const args: any[] = [userId];
  if (statusFilter === 'live') where += " AND status IN ('queued','planning','dialing','in_conversation','wrapping')";
  if (statusFilter === 'scheduled') where += " AND status = 'previewed' AND schedule_at IS NOT NULL";
  if (statusFilter === 'done') where += " AND status IN ('completed','voicemail','failed','canceled')";
  return db
    .prepare(`SELECT * FROM missions WHERE ${where} ORDER BY updated_at DESC LIMIT 50`)
    .all(...args) as MissionRow[];
};

export const createMission = (input: {
  userId: string;
  e164: string;
  displayName: string;
  goal: string;
  language: string;
  archetype: MissionArchetype;
  scheduleAt: number | null;
  extractSchema: object;
  consentSnapshot: object;
}): MissionRow => {
  const id = `mis_${newId('').slice(1)}`;
  const t = now();
  const idem = hashKey(input.userId, input.e164, input.goal, input.scheduleAt ?? 'now', Math.floor(t / 600_000));
  db.prepare(
    `INSERT INTO missions (
      id, user_id, e164, display_name, goal, language, archetype,
      schedule_at, extract_schema, consent_snapshot, status,
      idempotency_key, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)`,
  ).run(
    id,
    input.userId,
    input.e164,
    input.displayName,
    input.goal,
    input.language,
    input.archetype,
    input.scheduleAt,
    JSON.stringify(input.extractSchema),
    JSON.stringify(input.consentSnapshot),
    idem,
    t,
    t,
  );
  return getMission(id, input.userId)!;
};

export const updateMission = (id: string, patch: Partial<MissionRow>) => {
  const cur = getMission(id);
  if (!cur) return;
  const next = { ...cur, ...patch, updated_at: now() };
  db.prepare(
    `UPDATE missions SET
      status = ?, calle_call_id = ?, task_string = ?, error = ?,
      started_at = ?, ended_at = ?, schedule_at = ?
     WHERE id = ?`,
  ).run(
    next.status,
    next.calle_call_id,
    next.task_string,
    next.error,
    next.started_at,
    next.ended_at,
    next.schedule_at,
    id,
  );
};

export const setStatus = (id: string, status: MissionStatus, error?: string) => {
  const t = now();
  const started = ['dialing', 'in_conversation'].includes(status) ? t : undefined;
  const ended = TERMINAL_STATUSES.has(status) ? t : undefined;
  db.prepare(
    `UPDATE missions SET status = ?, error = COALESCE(?, error),
       started_at = COALESCE(?, started_at), ended_at = COALESCE(?, ended_at),
       updated_at = ?
     WHERE id = ?`,
  ).run(status, error ?? null, started ?? null, ended ?? null, t, id);
  appendEvent(id, 'afterhold', 'status', { status, error: error ?? null });
};

export const appendEvent = (missionId: string, source: 'afterhold' | 'calle', type: string, payload: any) => {
  const last = db
    .prepare('SELECT COALESCE(MAX(seq), 0) AS s FROM mission_events WHERE mission_id = ?')
    .get(missionId) as { s: number };
  db.prepare(
    `INSERT INTO mission_events (id, mission_id, source, type, payload, t, seq)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(`evt_${newId('').slice(1)}`, missionId, source, type, JSON.stringify(payload ?? {}), now(), last.s + 1);
};

export const listEvents = (missionId: string, sinceSeq?: number) =>
  db
    .prepare('SELECT * FROM mission_events WHERE mission_id = ? AND seq > ? ORDER BY seq ASC')
    .all(missionId, sinceSeq ?? 0) as Array<{
    id: string;
    mission_id: string;
    source: 'afterhold' | 'calle';
    type: string;
    payload: string;
    t: number;
    seq: number;
  }>;

export const writeBrief = (missionId: string, brief: Brief) => {
  db.prepare(
    `INSERT OR REPLACE INTO briefs (
      mission_id, outcome, summary_for_user, facts, next_step,
      callee_role, confidence, evidence, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    missionId,
    brief.outcome,
    brief.summary_for_user,
    JSON.stringify(brief.facts ?? {}),
    brief.next_step ?? null,
    brief.callee_role ?? null,
    brief.confidence ?? null,
    JSON.stringify(brief.evidence ?? []),
    now(),
  );
};

export const getBrief = (missionId: string): Brief | undefined => {
  const row = db.prepare('SELECT * FROM briefs WHERE mission_id = ?').get(missionId) as any;
  if (!row) return undefined;
  return {
    outcome: row.outcome,
    summary_for_user: row.summary_for_user,
    facts: JSON.parse(row.facts),
    next_step: row.next_step ?? undefined,
    callee_role: row.callee_role ?? undefined,
    confidence: row.confidence ?? undefined,
    evidence: JSON.parse(row.evidence),
  };
};
