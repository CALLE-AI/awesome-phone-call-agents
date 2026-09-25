import { randomUUID } from "node:crypto";

import type { CalleAdapter } from "./adapter";
import { planCallRuleBased } from "../ai/call-planner";
import {
  extractOutcomeFromStructuredResult,
  gateConfidence,
} from "../ai/outcome-extractor";
import { evaluateCallPolicy, type PolicyEnv } from "./policy";
import { runPreflight } from "./preflight";
import { createCallQueue, type CallQueue } from "./queue";
import { workflowStatusToPhoneStatus } from "./phone-state";
import type { PhoneTaskEvent } from "./phone-task";
import { mapStructuredResultToFollowUp, type FollowUpMapping } from "./map-to-follow-up";
import type {
  CallWorkflow,
  CallWorkflowStatus,
  PrepareCallInput,
} from "./types";

export type OrchestratorDeps = {
  policyEnv: PolicyEnv;
  adapter: CalleAdapter;
  store: Map<string, CallWorkflow>;
  queue?: CallQueue;
};

export type OrchestratorEvent = PhoneTaskEvent & {
  workflowId: string;
  phoneStatus: string;
};

function nowIso() {
  return new Date().toISOString();
}

export function createPhoneCallOrchestrator(deps: OrchestratorDeps) {
  const queue = deps.queue ?? createCallQueue();
  const events: OrchestratorEvent[] = [];

  function emit(opts: {
    workflow: CallWorkflow;
    fromStatus: CallWorkflowStatus | null;
    toStatus: CallWorkflowStatus;
    actor: OrchestratorEvent["actor"];
    source: string;
    code?: string;
  }) {
    const event: OrchestratorEvent = {
      eventId: randomUUID().replace(/-/g, "").slice(0, 20),
      taskId: opts.workflow.id,
      workflowId: opts.workflow.id,
      fromStatus: opts.fromStatus ? workflowStatusToPhoneStatus(opts.fromStatus) : null,
      toStatus: workflowStatusToPhoneStatus(opts.toStatus),
      phoneStatus: workflowStatusToPhoneStatus(opts.toStatus),
      actor: opts.actor,
      source: opts.source,
      at: nowIso(),
      code: opts.code,
    };
    events.push(event);
    return event;
  }

  function validateBeforeCall(input: PrepareCallInput) {
    const policy = evaluateCallPolicy(input, deps.policyEnv);
    const preflight = runPreflight(input, deps.policyEnv);
    const plan = planCallRuleBased({
      purpose: input.purpose,
      locale: input.callLanguage,
      triageState: input.triageState,
      beneficiaryId: input.womanId,
    });
    return { policy, preflight, plan };
  }

  function buildOutcome(workflow: CallWorkflow) {
    const extracted = extractOutcomeFromStructuredResult({
      result: workflow.structuredResult,
      status: workflow.status,
      sourceEventId: workflow.id,
    });
    return {
      extracted,
      confidenceGate: gateConfidence(extracted.confidence),
      followUp: workflow.structuredResult
        ? mapStructuredResultToFollowUp(workflow.structuredResult)
        : null,
    };
  }

  function getTimeline(workflowId: string) {
    return events.filter((e) => e.workflowId === workflowId);
  }

  function getQueueHealth() {
    return queue.debugSnapshot();
  }

  return {
    validateBeforeCall,
    buildOutcome,
    emit,
    getTimeline,
    getQueueHealth,
    enqueueRetry(workflowId: string, delayMs = 0) {
      return queue.enqueue({ taskId: workflowId, delayMs });
    },
  };
}

export type PhoneCallOrchestrator = ReturnType<typeof createPhoneCallOrchestrator>;
