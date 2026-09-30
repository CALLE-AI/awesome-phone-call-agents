import { randomUUID } from "node:crypto";

export type CorrelationBundle = {
  correlationId: string;
  chwTaskId: string;
  workflowId: string;
  conversationSessionId: string;
  providerCallId: string | null;
  aiRunId: string | null;
  attemptNumber: number;
  createdAt: string;
};

const byWorkflow = new Map<string, CorrelationBundle>();

export function createCorrelationBundle(input: {
  chwTaskId: string;
  workflowId: string;
  attemptNumber?: number;
}): CorrelationBundle {
  const bundle: CorrelationBundle = {
    correlationId: `corr_${randomUUID().replace(/-/g, "").slice(0, 20)}`,
    chwTaskId: input.chwTaskId,
    workflowId: input.workflowId,
    conversationSessionId: `sess_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
    providerCallId: null,
    aiRunId: `ai_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
    attemptNumber: input.attemptNumber ?? 1,
    createdAt: new Date().toISOString(),
  };
  byWorkflow.set(input.workflowId, bundle);
  return bundle;
}

export function getCorrelationBundle(workflowId: string): CorrelationBundle | undefined {
  return byWorkflow.get(workflowId);
}

export function attachProviderCallId(workflowId: string, providerCallId: string) {
  const bundle = byWorkflow.get(workflowId);
  if (!bundle) return;
  bundle.providerCallId = providerCallId;
  byWorkflow.set(workflowId, bundle);
}

export function resetCorrelationStore() {
  byWorkflow.clear();
}
