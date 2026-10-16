import { logger } from '@dial/observability';
import { Runner, createWiring } from '@dial/orchestrator';
import { config as loadConfig } from '@dial/config';

/**
 * Worker entrypoint. Runs the durable job loop that does all phone work.
 *
 * Deliberately a separate process from the API: a deploy or crash of the web
 * tier must not abandon calls in flight, and the queue makes restarts resumable.
 * Progress reaches clients via the `task_events` table, which the API's SSE
 * endpoint tails, so no direct channel between the two is needed.
 */
async function main(): Promise<void> {
  const cfg = loadConfig();

  // PGlite is embedded and single-process: the API already has the data
  // directory open, and a second process silently aborts inside the WASM
  // runtime. Fail with an explanation rather than that.
  if (!cfg.databaseUrl) {
    logger.error(
      'The standalone worker needs a real PostgreSQL server. The default embedded ' +
        'database (PGlite) cannot be opened by two processes at once. Either set ' +
        'DATABASE_URL, or leave RUN_WORKER_IN_API unset and let the API run the job ' +
        'loop in-process for local development.',
    );
    process.exit(1);
  }

  const wiring = await createWiring({ migrate: false });
  const runner = new Runner(wiring.ctx, { batchSize: wiring.config.limits.maxCallConcurrency });

  runner.start();
  logger.info('worker running', {
    provider: wiring.ctx.provider.name,
    placesRealCalls: wiring.ctx.provider.placesRealCalls,
  });

  const shutdown = async (signal: string) => {
    logger.info('worker shutting down', { signal });
    await runner.stop();
    await wiring.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error) => {
  logger.error('worker failed to start', { error: (error as Error).message });
  process.exit(1);
});
