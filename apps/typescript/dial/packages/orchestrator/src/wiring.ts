import { config as loadConfig, type DialConfig } from '@dial/config';
import { getDatabase, runMigrations, type Db } from '@dial/database';
import { resolveCallProvider } from '@dial/calle';
import { DiscoveryService } from '@dial/search';
import { resolveInterpreter, isInterpreterConfigured, resolveQuestionGenerator } from '@dial/ai';
import { logger } from '@dial/observability';
import type { OrchestratorContext, RealtimeEvent } from './context.js';

/**
 * Builds the orchestrator context from configuration. Shared by the API and the
 * worker so the two processes are guaranteed to be looking at the same database,
 * the same provider and the same limits.
 *
 * `publish` differs between them: the API pushes into its in-process SSE hub for
 * immediacy, while the worker passes a no-op — its progress reaches clients
 * through the `task_events` table, which the SSE endpoint tails. That table is
 * the durable, cross-process transport; the hub is only a latency optimisation.
 */
export interface Wiring {
  ctx: OrchestratorContext;
  db: Db;
  config: DialConfig;
  close: () => Promise<void>;
}

export async function createWiring(options: {
  publish?: (taskId: string, event: RealtimeEvent) => void;
  migrate?: boolean;
} = {}): Promise<Wiring> {
  const cfg = loadConfig();
  const handle = await getDatabase();

  if (options.migrate) {
    const applied = await runMigrations(handle.db);
    if (applied.length) logger.info('migrations applied at boot', { count: applied.length });
  }

  const interpreter = isInterpreterConfigured(cfg) ? resolveInterpreter(cfg) : null;
  if (!interpreter) {
    logger.warn('LLM_API_KEY is not set — Dial cannot interpret new requests until it is');
  }
  if (!cfg.discovery.osmContactEmail && !cfg.discovery.googlePlacesApiKey) {
    logger.warn(
      'Neither OSM_CONTACT_EMAIL nor GOOGLE_PLACES_API_KEY is set — OpenStreetMap requires a contact address in its usage policy',
    );
  }

  const ctx: OrchestratorContext = {
    db: handle.db,
    config: cfg,
    provider: resolveCallProvider(cfg),
    discovery: new DiscoveryService(cfg),
    interpreter,
    questionGenerator: resolveQuestionGenerator(cfg),
    publish: options.publish ?? (() => undefined),
  };

  return {
    ctx,
    db: handle.db,
    config: cfg,
    close: async () => {
      await handle.close();
    },
  };
}
