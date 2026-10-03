import { maskedDestination, safeDashboardText } from "../dashboard/workspace";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const COMPONENTS = ["realtime", "search", "sms", "reminder", "call", "post_call"] as const;
const OUTCOMES = ["started", "completed", "failed", "canceled", "unknown"] as const;

export interface SafeWorkflowEvent {
  readonly at: string;
  readonly component: (typeof COMPONENTS)[number];
  readonly correlationId: string;
  readonly destination?: string;
  readonly latencyMs?: number;
  readonly outcome: (typeof OUTCOMES)[number];
  readonly providerCode?: string;
}

export function createSafeWorkflowEvent(input: {
  at?: string;
  component: string;
  correlationId: string;
  destinationE164?: string;
  latencyMs?: number;
  outcome: string;
  providerCode?: unknown;
}): SafeWorkflowEvent {
  if (!UUID_V4.test(input.correlationId)) throw new Error("safe event correlation ID must be UUID v4");
  if (!COMPONENTS.includes(input.component as SafeWorkflowEvent["component"])) throw new Error("invalid safe event component");
  if (!OUTCOMES.includes(input.outcome as SafeWorkflowEvent["outcome"])) throw new Error("invalid safe event outcome");
  const at = input.at ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(at))) throw new Error("invalid safe event timestamp");
  if (input.latencyMs !== undefined && (!Number.isInteger(input.latencyMs) || input.latencyMs < 0 || input.latencyMs > 300_000)) throw new Error("invalid safe event latency");
  const providerCode = input.providerCode === undefined ? undefined : safeDashboardText(input.providerCode, 80).replace(/[^a-z0-9_.-]/giu, "_");
  return {
    at,
    component: input.component as SafeWorkflowEvent["component"],
    correlationId: input.correlationId,
    destination: input.destinationE164 ? maskedDestination(input.destinationE164) : undefined,
    latencyMs: input.latencyMs,
    outcome: input.outcome as SafeWorkflowEvent["outcome"],
    providerCode: providerCode || undefined,
  };
}
