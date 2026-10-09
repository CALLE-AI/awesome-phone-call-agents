/**
 * Hybrid CALL-E client.
 *
 * Routes designated node ids to the REAL CALL-E SDK and everything else to the
 * MOCK. This powers the "one real call among many simulated ones" demo: a
 * single fan-out run places one genuine phone call (your .env number) in
 * parallel with staggered mock calls that trickle in over time.
 *
 * Both underlying clients implement the same CalleClient interface, so the
 * executor drives this exactly like any other client.
 */

import type { CalleClient, CalleCallRequest } from "./client.js";
import type { CalleCallOutcome } from "../graph/types.js";
import { MockCalleClient } from "../../mock/calle-mock.js";
import { RealCalleClient } from "./real-client.js";

export interface HybridOptions {
  /** Node ids that should be placed as REAL calls. All others use the mock. */
  realNodeIds: Set<string>;
  real: RealCalleClient;
  mock: MockCalleClient;
}

export class HybridCalleClient implements CalleClient {
  constructor(private readonly opts: HybridOptions) {}

  createAndWait(req: CalleCallRequest): Promise<CalleCallOutcome> {
    const useReal = req.nodeId !== undefined && this.opts.realNodeIds.has(req.nodeId);
    const client = useReal ? this.opts.real : this.opts.mock;
    return client.createAndWait(req);
  }
}
