import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  createMission,
  getMission,
  getBrief,
  listEvents,
  listMissions,
  setStatus,
  updateMission,
  appendEvent,
} from '../services/missions.js';
import { buildResultSchema, factsHint } from '../services/resultSchema.js';
import { renderTaskString } from '../services/taskString.js';
import { getUser } from '../services/auth.js';
import {
  ensureCalleEnabled,
  ensureConsentGranted,
  ensureNotQuietHours,
  ensureNumberAllowed,
  enforceRateLimit,
} from '../services/safety.js';
import { makeCallegate } from '../adapters/calle.js';
import { env } from '../lib/env.js';
import { isE164, now, redactE164 } from '../lib/util.js';
import { runMission } from '../workers/missionWorker.js';

const ArchetypeEnum = z.enum(['courier', 'clinic', 'restaurant', 'utility', 'general']);

const CreateMissionBody = z.object({
  e164: z.string().regex(/^\+[1-9]\d{7,14}$/),
  display_name: z.string().min(1).max(80),
  goal: z.string().min(5).max(800),
  language: z.string().default('en-IN'),
  archetype: ArchetypeEnum.default('general'),
  schedule_at: z.number().int().positive().nullable().optional(),
});

const IdBody = z.object({ id: z.string() });

export async function missionRoutes(app: FastifyInstance) {
  app.post('/v1/missions', { preHandler: app.authenticate }, async (req, reply) => {
    const body = CreateMissionBody.parse(req.body);
    if (!isE164(body.e164)) return reply.code(400).send({ error: 'bad_e164' });
    const u = getUser((req as any).userId)!;
    const extract = buildResultSchema(body.archetype);
    const mission = createMission({
      userId: u.id,
      e164: body.e164,
      displayName: body.display_name,
      goal: body.goal,
      language: body.language,
      archetype: body.archetype,
      scheduleAt: body.schedule_at ?? null,
      extractSchema: extract,
      consentSnapshot: { consent_granted: !!u.consent_snapshot, version: 'v1' },
    });
    appendEvent(mission.id, 'afterhold', 'mission_created', { archetype: body.archetype });
    return reply.code(201).send(serializeMission(mission, false));
  });

  app.post(
    '/v1/missions/:id/preview',
    { preHandler: app.authenticate },
    async (req, reply) => {
      const { id } = IdBody.parse(req.params);
      const m = getMission(id, (req as any).userId);
      if (!m) return reply.code(404).send({ error: 'not_found' });
      const u = getUser(m.user_id)!;
      const task = renderTaskString({
        e164: m.e164,
        goal: m.goal,
        language: m.language,
        archetype: m.archetype,
        userName: u.name,
        displayName: m.display_name,
        extractSchemaFactsHint: factsHint(m.archetype),
      });
      updateMission(m.id, { task_string: task });
      if (m.status === 'draft') setStatus(m.id, 'previewed');
      appendEvent(m.id, 'afterhold', 'previewed', { task_excerpt: task.slice(0, 240) });
      return reply.send({
        task_string: task,
        extract_schema: JSON.parse(m.extract_schema),
        status: m.status === 'draft' ? 'previewed' : m.status,
      });
    },
  );

  app.post(
    '/v1/missions/:id/start',
    { preHandler: app.authenticate },
    async (req, reply) => {
      const { id } = IdBody.parse(req.params);
      const m = getMission(id, (req as any).userId);
      if (!m) return reply.code(404).send({ error: 'not_found' });

      // Spec §8 sequence
      ensureCalleEnabled();
      const u = getUser(m.user_id)!;
      ensureConsentGranted(u.id);
      ensureNumberAllowed(u.id, m.e164);
      if (!m.schedule_at) ensureNotQuietHours(u.quiet_hours_start, u.quiet_hours_end);
      enforceRateLimit(u.id);

      // Need a previewed plan before live dial — auto-build if missing.
      let task = m.task_string;
      if (!task) {
        task = renderTaskString({
          e164: m.e164,
          goal: m.goal,
          language: m.language,
          archetype: m.archetype,
          userName: u.name,
          displayName: m.display_name,
          extractSchemaFactsHint: factsHint(m.archetype),
        });
        updateMission(m.id, { task_string: task });
      }

      try {
        setStatus(m.id, 'queued');
        const gate = makeCallegate();
        const { calle_call_id } = await gate.createCall({
          task,
          resultSchema: JSON.parse(m.extract_schema),
          phoneNumber: m.e164,
          language: m.language,
          idempotencyKey: m.idempotency_key,
        });
        updateMission(m.id, { calle_call_id, started_at: now() });
        appendEvent(m.id, 'calle', 'call_created', { calle_call_id });

        // Kick the worker — it will advance the mission through the phases.
        // Don't await — caller returns immediately with queued.
        setImmediate(() => runMission(m.id).catch((e) => {
          console.error('[start] runMission error', e);
          setStatus(m.id, 'failed', String((e as Error).message ?? e));
        }));
      } catch (e: any) {
        setStatus(m.id, 'failed', String(e?.message ?? e));
        return reply.code(502).send({ error: 'calle_create_failed', detail: String(e?.message ?? e) });
      }
      return reply.send(serializeMission(getMission(m.id)!, false));
    },
  );

  app.get(
    '/v1/missions/:id',
    { preHandler: app.authenticate },
    async (req, reply) => {
      const { id } = IdBody.parse(req.params);
      const m = getMission(id, (req as any).userId);
      if (!m) return reply.code(404).send({ error: 'not_found' });
      return reply.send({
        ...serializeMission(m, true),
        brief: getBrief(id) ?? null,
      });
    },
  );

  app.get(
    '/v1/missions/:id/events',
    { preHandler: app.authenticate },
    async (req, reply) => {
      const { id } = IdBody.parse(req.params);
      const m = getMission(id, (req as any).userId);
      if (!m) return reply.code(404).send({ error: 'not_found' });
      const q = z
        .object({ since: z.coerce.number().int().nonnegative().optional() })
        .parse(req.query ?? {});
      const events = listEvents(id, q.since).map((e) => ({
        seq: e.seq,
        type: e.type,
        source: e.source,
        t: e.t,
        payload: safeParse(e.payload),
      }));
      return reply.send({ events });
    },
  );

  app.post(
    '/v1/missions/:id/cancel',
    { preHandler: app.authenticate },
    async (req, reply) => {
      const { id } = IdBody.parse(req.params);
      const m = getMission(id, (req as any).userId);
      if (!m) return reply.code(404).send({ error: 'not_found' });
      // Best-effort — record cancel even if CALLE already finished.
      setStatus(m.id, 'canceled');
      return reply.send({ ok: true, status: 'canceled' });
    },
  );

  app.get(
    '/v1/missions',
    { preHandler: app.authenticate },
    async (req, reply) => {
      const q = z
        .object({ filter: z.enum(['live', 'scheduled', 'done']).optional() })
        .parse(req.query ?? {});
      const list = listMissions((req as any).userId, q.filter);
      return reply.send({ missions: list.map((m) => serializeMission(m, false)) });
    },
  );

  app.post(
    '/v1/missions/:id/retry',
    { preHandler: app.authenticate },
    async (req, reply) => {
      const { id } = IdBody.parse(req.params);
      const m = getMission(id, (req as any).userId);
      if (!m) return reply.code(404).send({ error: 'not_found' });
      const next = createMission({
        userId: m.user_id,
        e164: m.e164,
        displayName: m.display_name,
        goal: m.goal,
        language: m.language,
        archetype: m.archetype,
        scheduleAt: null,
        extractSchema: JSON.parse(m.extract_schema),
        consentSnapshot: JSON.parse(m.consent_snapshot),
      });
      appendEvent(next.id, 'afterhold', 'retried_from', { source_mission_id: m.id });
      return reply.code(201).send(serializeMission(next, false));
    },
  );
}

function serializeMission(m: any, withTaskString: boolean) {
  return {
    id: m.id,
    e164: env.LOG_LEVEL === 'debug' ? m.e164 : redactE164(m.e164),
    display_name: m.display_name,
    goal: m.goal,
    language: m.language,
    archetype: m.archetype,
    schedule_at: m.schedule_at,
    status: m.status,
    calle_call_id: m.calle_call_id,
    error: m.error,
    task_string: withTaskString ? m.task_string : undefined,
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
