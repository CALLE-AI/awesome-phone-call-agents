import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  createUser,
  getUser,
  getUserByEmail,
  issueRefresh,
  setPassword,
  setConsent,
  verifyPassword,
  findRefresh,
  revokeRefresh,
} from '../services/auth.js';
import { env } from '../lib/env.js';

const RegisterBody = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1).max(80),
});
const LoginBody = z.object({ email: z.string().email(), password: z.string().min(8) });
const ConsentBody = z.object({ version: z.string(), granted: z.boolean() });

export async function authRoutes(app: FastifyInstance) {
  app.post('/v1/auth/register', async (req, reply) => {
    const body = RegisterBody.parse(req.body);
    if (getUserByEmail(body.email)) return reply.code(409).send({ error: 'email_taken' });
    const u = createUser({ email: body.email, name: body.name });
    if (!u) return reply.code(500).send({ error: 'create_user_failed' });
    await setPassword(u.id, body.password);
    return issueTokens(app, reply, u.id);
  });

  app.post('/v1/auth/login', async (req, reply) => {
    const body = LoginBody.parse(req.body);
    const user = getUserByEmail(body.email);
    if (!user || !(await verifyPassword(body.password, user.password_hash))) {
      return reply.code(401).send({ error: 'invalid_credentials' });
    }
    return issueTokens(app, reply, user.id);
  });

  app.post('/v1/auth/refresh', async (req, reply) => {
    const body = z.object({ refresh_token: z.string() }).parse(req.body);
    const row = findRefresh(body.refresh_token);
    if (!row || row.revoked || row.expires_at < Date.now()) {
      return reply.code(401).send({ error: 'invalid_refresh' });
    }
    revokeRefresh(body.refresh_token);
    return issueTokens(app, reply, row.user_id);
  });

  app.post('/v1/auth/logout', async (req, reply) => {
    const body = z.object({ refresh_token: z.string() }).parse(req.body);
    revokeRefresh(body.refresh_token);
    return reply.send({ ok: true });
  });

  app.post(
    '/v1/auth/consent',
    { preHandler: app.authenticate },
    async (req, reply) => {
      const body = ConsentBody.parse(req.body);
      if (!body.granted) return reply.code(400).send({ error: 'consent_required' });
      setConsent((req as any).userId, body);
      return reply.send({ ok: true });
    },
  );

  app.get('/v1/me', { preHandler: app.authenticate }, async (req) => {
    const u = getUser((req as any).userId)!;
    return {
      id: u.id,
      email: u.email,
      name: u.name,
      default_language: u.default_language,
      default_region: u.default_region,
      quiet_hours_start: u.quiet_hours_start,
      quiet_hours_end: u.quiet_hours_end,
      transcript_retention: !!u.transcript_retention,
      consent_granted: !!u.consent_snapshot,
    };
  });

  app.patch(
    '/v1/me',
    { preHandler: app.authenticate },
    async (req, reply) => {
      const u = getUser((req as any).userId)!;
      const body = z
        .object({
          default_language: z.string().optional(),
          default_region: z.string().optional(),
          quiet_hours_start: z.number().int().min(0).max(23).optional(),
          quiet_hours_end: z.number().int().min(0).max(23).optional(),
          transcript_retention: z.boolean().optional(),
        })
        .parse(req.body);
      const patch = { ...u, ...body };
      const { db } = await import('../lib/db.js');
      db.prepare(
        `UPDATE users SET default_language = ?, default_region = ?,
          quiet_hours_start = ?, quiet_hours_end = ?,
          transcript_retention = ?, updated_at = ?
         WHERE id = ?`,
      ).run(
        patch.default_language,
        patch.default_region,
        patch.quiet_hours_start,
        patch.quiet_hours_end,
        patch.transcript_retention ? 1 : 0,
        Date.now(),
        u.id,
      );
      return reply.send({ ok: true });
    },
  );
}

async function issueTokens(app: FastifyInstance, reply: any, userId: string) {
  const access = await app.jwt.sign({ sub: userId }, { expiresIn: env.JWT_ACCESS_TTL });
  const refresh = issueRefresh(userId);
  return reply.send({
    access_token: access,
    refresh_token: refresh.jti,
    user_id: userId,
  });
}
