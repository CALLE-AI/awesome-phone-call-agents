import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import sensible from '@fastify/sensible';
import { env } from './lib/env.js';
import { authRoutes } from './routes/auth.js';
import { missionRoutes } from './routes/missions.js';
import { numberRoutes } from './routes/numbers.js';
import { tickAllLive } from './workers/missionWorker.js';

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: any;
  }
}

export async function buildServer() {
  const app = Fastify({
    logger: { level: env.LOG_LEVEL },
    disableRequestLogging: env.LOG_LEVEL === 'info' || env.LOG_LEVEL === 'warn',
  });

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    origin: [env.APP_ORIGIN, 'http://localhost:8086', 'http://localhost:19006'],
    credentials: true,
  });
  await app.register(sensible);
  await app.register(jwt, { secret: env.JWT_SECRET });

  app.decorate('authenticate', async (req: any, reply: any) => {
    try {
      await req.jwtVerify();
      req.userId = (req.user as any).sub;
    } catch {
      return reply.code(401).send({ error: 'unauthorized' });
    }
  });

  app.get('/health', async () => ({
    ok: true,
    mock: env.CALLE_MOCK,
    calle_enabled: env.CALLE_ENABLED,
    t: new Date().toISOString(),
  }));

  await app.register(authRoutes);
  await app.register(missionRoutes);
  await app.register(numberRoutes);

  // Background sweeper — drives live missions forward.
  const sweeper = setInterval(() => {
    tickAllLive().catch((e) => app.log.error({ err: e }, 'tickAllLive failed'));
  }, 5000);
  app.addHook('onClose', async () => clearInterval(sweeper));

  return app;
}

async function main() {
  const app = await buildServer();
  try {
    await app.listen({ port: env.PORT, host: env.HOST });
    app.log.info(
      `AfterHold API ready on http://${env.HOST}:${env.PORT}  (CALLE_MOCK=${env.CALLE_MOCK}, CALLE_ENABLED=${env.CALLE_ENABLED})`,
    );
  } catch (e) {
    app.log.error(e);
    process.exit(1);
  }
}

const isMain = process.argv[1] && process.argv[1].endsWith('server.ts');
if (isMain) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
