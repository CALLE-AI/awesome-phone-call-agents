import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  createMission,
  getMission,
  getBrief,
  listEvents,
  listMissions,
  setStatus,
  claimStatus,
  updateMission,
  appendEvent,
} from '../services/missions.js';
import { buildResultSchema } from '../services/resultSchema.js';
import { buildTaskFor } from '../services/taskString.js';
import { getUser } from '../services/auth.js';
import { ensureNotQuietHours } from '../services/safety.js';
import { dispatch, runDialGates } from '../services/dispatch.js';
import { isMock } from '../lib/env.js';
import { isE164, maskDeep, maskPhones, redactE164 } from '../lib/util.js';
import { LIVE_STATUSES, TERMINAL_STATUSES } from '../lib/types.js';

const ArchetypeEnum = z.enum(['courier', 'clinic', 'restaurant', 'utility', 'general']);

const CreateMissionBody = z.object({
  e164: z.string().regex(/^\+[1-9]\d{7,14}$/),
  display_name: z.string().min(1).max(80),
  goal: z.string().min(5).max(800),
  language: z.string().default('en-IN'),
  archetype: ArchetypeEnum.default('general'),
  // ISO 3166-1 alpha-2 of the callee. Required for live calls, never inferred.
  region: z.string().regex(/^[A-Z]{2}$/).optional(),
  // Epoch ms. A future value schedules the call; it is never dialed early.
  schedule_at: z.number().int().positive().nullable().optional(),
});

const StartBody = z.object({ confirm_live: z.boolean().optional() }).default({});

const IdBody = z.object({ id: z.string() });

const CANCEL_NOTE =
  'Canceling stops AfterHold from tracking this mission. It does not recall a call CALL-E has already accepted: ' +
  'a call in progress may still complete.';

export async function missionRoutes(app: FastifyInstance) {
  app.post('/v1/missions', { preHandler: app.authenticate }, async (req, reply) => {
    const body = CreateMissionBody.parse(req.body);
    if (!isE164(body.e164)) return reply.code(400).send({ error: 'bad_e164' });
    if (body.schedule_at != null && body.schedule_at <= Date.now()) {
      return reply
        .code(400)
        .send({ error: 'schedule_in_past', detail: 'schedule_at must be in the future, or omit it to call now.' });
    }
    const u = getUser((req as any).userId)!;
    if (body.schedule_at != null) {
      // A schedule must not be a way around quiet hours: check the real dial time.
      try {
        ensureNotQuietHours(u.quiet_hours_start, u.quiet_hours_end, body.schedule_at);
      } catch (e: any) {
        return reply.code(e.statusCode ?? 429).send({ error: 'quiet_hours', detail: e.message });
      }
    }
    const extract = buildResultSchema(body.archetype);
    const mission = createMission({
      userId: u.id,
      e164: body.e164,
      displayName: body.display_name,
      goal: body.goal,
      language: body.language,
      archetype: body.archetype,
      region: body.region ?? null,
      scheduleAt: body.schedule_at ?? null,
      extractSchema: extract,
      consentSnapshot: { consent_granted: !!u.consent_snapshot, version: 'v1' },
    });
    appendEvent(mission.id, 'afterhold', 'mission_created', { archetype: body.archetype });
    return reply.code(201).send(serializeMission(mission, false));
  });

  app.post('/v1/missions/:id/preview', { preHandler: app.authenticate }, async (req, reply) => {
    const { id } = IdBody.parse(req.params);
    const m = getMission(id, (req as any).userId);
    if (!m) return reply.code(404).send({ error: 'not_found' });
    const task = buildTaskFor(m);
    updateMission(m.id, { task_string: task });
    if (m.status === 'draft') setStatus(m.id, 'previewed');
    appendEvent(m.id, 'afterhold', 'previewed', {});
    return reply.send({
      task_string: maskPhones(task),
      extract_schema: JSON.parse(m.extract_schema),
      status: m.status === 'draft' ? 'previewed' : m.status,
    });
  });

  app.post('/v1/missions/:id/start', { preHandler: app.authenticate }, async (req, reply) => {
    const { id } = IdBody.parse(req.params);
    const body = StartBody.parse(req.body ?? {});
    const m = getMission(id, (req as any).userId);
    if (!m) return reply.code(404).send({ error: 'not_found' });
    if (m.status !== 'draft' && m.status !== 'previewed') {
      return reply.code(409).send({ error: 'not_startable', detail: `mission is ${m.status}` });
    }

    // Live calls need explicit per-run operator intent.
    if (!isMock) {
      if (body.confirm_live !== true) {
        return reply.code(400).send({
          error: 'confirm_live_required',
          detail: 'This server places real calls. Send {"confirm_live": true} to start this mission.',
        });
      }
      if (!m.region) {
        return reply
          .code(400)
          .send({ error: 'region_required', detail: 'Set a recipient region (e.g. "US") when creating the mission.' });
      }
    }

    try {
      if (m.schedule_at != null) {
        if (m.schedule_at <= Date.now()) {
          return reply.code(400).send({
            error: 'schedule_in_past',
            detail: 'Create a new mission with a future time, or omit schedule_at to call now.',
          });
        }
        // Gate what can be decided now; every gate is re-checked at dial time.
        const u = getUser(m.user_id)!;
        ensureNotQuietHours(u.quiet_hours_start, u.quiet_hours_end, m.schedule_at);
        if (!m.task_string) updateMission(m.id, { task_string: buildTaskFor(m) });
        if (!claimStatus(m.id, ['draft', 'previewed'], 'scheduled')) {
          return reply.code(409).send({ error: 'not_startable' });
        }
        return reply.send(serializeMission(getMission(m.id)!, false));
      }

      runDialGates(m);
      const r = await dispatch(m.id, ['draft', 'previewed']);
      if (!r.ok) {
        return reply.code(r.code).send({ error: r.error, detail: r.detail ? maskPhones(r.detail) : undefined });
      }
    } catch (e: any) {
      return reply.code(e.statusCode ?? 500).send({ error: 'gate_refused', detail: maskPhones(String(e?.message ?? e)) });
    }
    return reply.send(serializeMission(getMission(m.id)!, false));
  });

  app.get('/v1/missions/:id', { preHandler: app.authenticate }, async (req, reply) => {
    const { id } = IdBody.parse(req.params);
    const m = getMission(id, (req as any).userId);
    if (!m) return reply.code(404).send({ error: 'not_found' });
    const brief = getBrief(id);
    return reply.send({
      ...serializeMission(m, true),
      brief: brief ? maskDeep(brief) : null,
    });
  });

  app.get('/v1/missions/:id/events', { preHandler: app.authenticate }, async (req, reply) => {
    const { id } = IdBody.parse(req.params);
    const m = getMission(id, (req as any).userId);
    if (!m) return reply.code(404).send({ error: 'not_found' });
    const q = z.object({ since: z.coerce.number().int().nonnegative().optional() }).parse(req.query ?? {});
    const events = listEvents(id, q.since).map((e) => ({
      seq: e.seq,
      type: e.type,
      source: e.source,
      t: e.t,
      payload: maskDeep(safeParse(e.payload)),
    }));
    return reply.send({ events });
  });

  app.post('/v1/missions/:id/cancel', { preHandler: app.authenticate }, async (req, reply) => {
    const { id } = IdBody.parse(req.params);
    const m = getMission(id, (req as any).userId);
    if (!m) return reply.code(404).send({ error: 'not_found' });
    if (TERMINAL_STATUSES.has(m.status) && m.status !== 'submission_unknown') {
      return reply.send({ ok: true, status: m.status, note: 'Mission had already finished.' });
    }
    // Local cancel only: stops tracking and prevents any not-yet-sent dial.
    // It cannot recall a call CALL-E has accepted.
    const submitted = LIVE_STATUSES.has(m.status) || m.status === 'submission_unknown';
    setStatus(m.id, 'canceled');
    return reply.send({
      ok: true,
      status: 'canceled',
      call_recalled: false,
      note: submitted ? CANCEL_NOTE : 'No call had been submitted, so nothing will be dialed.',
    });
  });

  app.get('/v1/missions', { preHandler: app.authenticate }, async (req, reply) => {
    const q = z.object({ filter: z.enum(['live', 'scheduled', 'done']).optional() }).parse(req.query ?? {});
    const list = listMissions((req as any).userId, q.filter);
    return reply.send({ missions: list.map((m) => serializeMission(m, false)) });
  });

  app.post('/v1/missions/:id/retry', { preHandler: app.authenticate }, async (req, reply) => {
    const { id } = IdBody.parse(req.params);
    const m = getMission(id, (req as any).userId);
    if (!m) return reply.code(404).send({ error: 'not_found' });
    if (m.status === 'submission_unknown' || LIVE_STATUSES.has(m.status)) {
      return reply.code(409).send({
        error: 'reconcile_first',
        detail:
          'The earlier call may still be in progress or may have been created. Check the CALL-E dashboard for it before creating a replacement.',
      });
    }
    const next = createMission({
      userId: m.user_id,
      e164: m.e164,
      displayName: m.display_name,
      goal: m.goal,
      language: m.language,
      archetype: m.archetype,
      region: m.region,
      scheduleAt: null,
      extractSchema: JSON.parse(m.extract_schema),
      consentSnapshot: JSON.parse(m.consent_snapshot),
    });
    appendEvent(next.id, 'afterhold', 'retried_from', { source_mission_id: m.id });
    return reply.code(201).send(serializeMission(next, false));
  });
}

function serializeMission(m: any, withTaskString: boolean) {
  return {
    id: m.id,
    e164: redactE164(m.e164),
    display_name: maskPhones(m.display_name),
    goal: maskPhones(m.goal),
    language: m.language,
    archetype: m.archetype,
    region: m.region,
    schedule_at: m.schedule_at,
    status: m.status,
    calle_call_id: m.calle_call_id,
    error: m.error ? maskPhones(m.error) : m.error,
    task_string: withTaskString && m.task_string ? maskPhones(m.task_string) : undefined,
    extract_schema: JSON.parse(m.extract_schema),
    created_at: m.created_at,
    updated_at: m.updated_at,
    started_at: m.started_at,
    ended_at: m.ended_at,
  };
}

function safeParse(s: string) {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}
