/**
 * A reusable CALL-E adapter.
 *
 * Everything here is workflow-agnostic: MCP transport, run-status semantics, and
 * phone-number masking. Appointment Recovery is one consumer of this layer, not
 * a dependency of it — nothing in `src/calle/` may import from
 * `src/workflows/`. That direction is what makes a second workflow cheap.
 */

export {
  createCalleClient,
  parseMcpBody,
  CalleError,
  MCP_PROTOCOL_VERSION,
} from "./client";
export type {
  CalleActivity,
  CalleClient,
  CalleClientOptions,
  CallePlan,
  CalleRun,
  CalleRunOutcome,
  CalleRunResult,
  PlanCallInput,
} from "./client";

export { classifyDelivery, isTerminalStatus, normalizeStatus, TERMINAL_STATUSES } from "./status";
export type { Delivery } from "./status";

export { maskE164 } from "./mask";
