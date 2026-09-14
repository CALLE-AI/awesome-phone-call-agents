/**
 * The Switchboard-facing telephony interface.
 *
 * Both the mock (mock/calle-mock.ts) and the real SDK wrapper implement this,
 * so the executor never knows which one it's driving. Swapping is controlled by
 * the USE_MOCK env flag in src/index.ts.
 */

import type { CalleCallOutcome, ResultSchema } from "../graph/types.js";

export interface CalleCallRequest {
  /** The full task string handed to CALL-E (goal + policy instructions). */
  task: string;
  phone: string;
  region: string;
  locale: string;
  resultSchema: ResultSchema;
  /** Opaque node id, useful for the mock to pick a canned scenario. */
  nodeId?: string;
  /**
   * Idempotency key for this specific call attempt. Must be distinct per real
   * dial: a language-retry of the same node uses a different key (it includes
   * the locale and attempt index) so it is a genuinely new call, not a cached
   * replay of the first attempt.
   */
  idempotencyKey?: string;
}

export interface CalleClient {
  /**
   * Place a call and wait for it to complete. Mirrors the real SDK's
   * client.calls.createAndWait({ task, resultSchema }) shape, narrowed to what
   * Switchboard uses.
   */
  createAndWait(req: CalleCallRequest): Promise<CalleCallOutcome>;
}
