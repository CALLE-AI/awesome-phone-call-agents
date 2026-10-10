import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  addAuthorizedNumber,
  listAuthorizedNumbers,
  removeAuthorizedNumber,
} from '../services/auth.js';

const CreateBody = z.object({
  e164: z.string().regex(/^\+[1-9]\d{7,14}$/),
  label: z.string().min(1).max(40).optional(),
});

export async function numberRoutes(app: FastifyInstance) {
  app.get('/v1/numbers', { preHandler: app.authenticate }, async (req) => {
    return { numbers: listAuthorizedNumbers((req as any).userId) };
  });

  app.post('/v1/numbers', { preHandler: app.authenticate }, async (req, reply) => {
    const body = CreateBody.parse(req.body);
    const id = addAuthorizedNumber((req as any).userId, body.e164, body.label);
    return reply.code(201).send({ id });
  });

  app.delete('/v1/numbers/:id', { preHandler: app.authenticate }, async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    removeAuthorizedNumber((req as any).userId, id);
    return reply.send({ ok: true });
  });
}
