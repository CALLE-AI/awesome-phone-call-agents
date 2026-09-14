import { config, type DialConfig } from '@dial/config';
import { logger } from '@dial/observability';
import { CalleCallProvider } from './calle-provider.js';
import { FakeCallProvider } from './fake-provider.js';
import type { CallProvider } from './provider.js';

export * from './provider.js';
export * from './planner.js';
export { CalleCallProvider, normalizeCall, toProviderError } from './calle-provider.js';
export { FakeCallProvider } from './fake-provider.js';

/**
 * Resolves the calling backend. There are exactly two outcomes and no third
 * "fall back quietly" path:
 *
 *   TEST_PROVIDER=real -> CALL-E, and the config layer has already refused to
 *                         boot if the API key is missing.
 *   TEST_PROVIDER=mock -> the deterministic fake, which never dials.
 *
 * Section 31: production must not secretly use the mock, and the mock must not
 * be presented as production.
 */
export function resolveCallProvider(cfg: DialConfig = config()): CallProvider {
  if (cfg.callMode === 'real') {
    logger.warn('call provider is LIVE — real phone calls will be placed', {
      baseUrl: cfg.calle.baseUrl,
    });
    return new CalleCallProvider(cfg.calle.apiKey, cfg.calle.baseUrl);
  }
  logger.info('call provider is DRY RUN — no real phone calls will be placed');
  return new FakeCallProvider();
}

/**
 * A stable idempotency key. Derived from the workflow, never randomly generated
 * per attempt: CALL-E's guidance is explicit that a fresh UUID on each retry
 * defeats the mechanism, and the point here is that a retried worker cannot
 * dial the same business twice.
 */
export function callIdempotencyKey(taskId: string, candidateId: string, attempt = 1): string {
  return `dial:${taskId}:${candidateId}:${attempt}`;
}
