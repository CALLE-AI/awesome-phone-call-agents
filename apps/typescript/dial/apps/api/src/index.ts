import { logger } from '@dial/observability';
import { createWiring, Runner } from '@dial/orchestrator';
import { buildApp } from './app.js';
import { RealtimeHub } from './realtime.js';

/**
 * API entrypoint.
 *
 * In production the worker is a separate process (apps/worker), so a web deploy
 * or crash cannot abandon calls in flight. In development the default database
 * is PGlite — an embedded, single-process Postgres that a second process cannot
 * open — so the job loop runs in-process instead. `RUN_WORKER_IN_API` overrides
 * the default either way.
 */
async function main(): Promise<void> {
  const hub = new RealtimeHub();
  const wiring = await createWiring({
    migrate: true,
    publish: (taskId, event) => hub.publish(taskId, event),
  });

  const app = await buildApp({
    db: wiring.db,
    config: wiring.config,
    ctx: wiring.ctx,
    hub,
  });

  let runner: Runner | null = null;
  if (wiring.config.runWorkerInApi) {
    runner = new Runner(wiring.ctx, { batchSize: wiring.config.limits.maxCallConcurrency });
    runner.start();
    logger.info('job worker running inside the API process', {
      reason: wiring.config.databaseUrl ? 'RUN_WORKER_IN_API' : 'embedded PGlite is single-process',
    });
  }

  await app.listen({ port: wiring.config.port, host: wiring.config.host });
  logger.info('api listening', {
    port: wiring.config.port,
    callMode: wiring.config.callMode,
    provider: wiring.ctx.provider.name,
    placesRealCalls: wiring.ctx.provider.placesRealCalls,
    workerInProcess: wiring.config.runWorkerInApi,
  });

  const shutdown = async (signal: string) => {
    logger.info('shutting down', { signal });
    await runner?.stop();
    await app.close();
    await wiring.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error) => {
  logger.error('api failed to start', { error: (error as Error).message });
  process.exit(1);
});
