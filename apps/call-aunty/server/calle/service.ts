import { createHash, randomUUID } from "node:crypto";

import { createCalleAdapter, type CalleAdapter, type ProviderCallResult } from "./adapter";
import { assertJobTransition, isTerminalWorkflowStatus } from "./call-job";
import { loadCalleConfig, toPolicyEnv, type CalleConfig } from "./config";
import { getCapabilitySnapshot } from "./capabilities";
import { listDemoBeneficiaries, getDemoBeneficiary } from "./demo-data";
import { DEMO_SCENARIO_IDS, FakeCalleRuntime, type DemoScenarioId } from "./fake-runtime";
import {
  filterCommandCenterRows,
  summarizeCommandCenter,
  workflowToCommandRow,
  type CommandCenterFilters,
} from "./command-center";
import { compileCallIntent, compileFromColloquial } from "./intent-compiler";
import { advanceConversation, getConversationState, resetConversation } from "./conversation-state";
import { resolveProviderCapabilities } from "./provider-capabilities";
import { getPublicV4Flags, assertCallEEnabled } from "./v4-flags";
import { getPublicV5Flags, loadV5FeatureFlags } from "./v5-flags";
import { validateCalleConfig } from "./config-validator";
import { recordCallEvent, listCallEvents } from "./call-events";
import {
  attachProviderCallId,
  createCorrelationBundle,
  getCorrelationBundle,
} from "./correlation";
import { nowIso } from "./clock";
import { normalizeCallStatus } from "./status-normalize";
import { buildCallBrief } from "../ai/call-brief";
import { billingService } from "../billing/service";
import { mapStructuredResultToFollowUp, type FollowUpMapping } from "./map-to-follow-up";
import { createPhoneCallOrchestrator } from "./orchestrator";
import { evaluateCallPolicy, type PolicyEnv } from "./policy";
import { runPreflight } from "./preflight";
import { evaluateRetry } from "./retry-policy";
import {
  confirmCallInputSchema,
  prepareCallInputSchema,
  type CallFailureCode,
  type CallWorkflow,
  type CallWorkflowStatus,
  type ConfirmCallInput,
  type PrepareCallInput,
} from "./types";

export type CalleServiceEnv = PolicyEnv & {
  apiKey: string;
};

const globalStore = new Map<string, CallWorkflow>();
const globalIdempotency = new Map<string, string>();

export function maskE164(value: string): string {
  if (value.length < 6) return "***";
  return `${value.slice(0, 3)}***${value.slice(-2)}`;
}

function makeIdempotencyKey(input: PrepareCallInput, initiatorUserId: number) {
  return createHash("sha256")
    .update(
      [initiatorUserId, input.womanId, input.purpose, input.recipientE164, input.actionToken].join("|"),
    )
    .digest("hex")
    .slice(0, 48);
}

function setWorkflowStatus(workflow: CallWorkflow, next: CallWorkflowStatus) {
  assertJobTransition(workflow.status, next);
  workflow.status = next;
}

function toPublic(workflow: CallWorkflow) {
  const retry = evaluateRetry({
    status: workflow.status,
    failureCode: workflow.failureCode,
    attemptCount: workflow.attemptCount,
  });

  return {
    id: workflow.id,
    purpose: workflow.purpose,
    womanId: workflow.womanId,
    recipientE164Masked: maskE164(workflow.recipientE164),
    recipientRegion: workflow.recipientRegion,
    callLanguage: workflow.callLanguage,
    triageState: workflow.triageState,
    callConsentGranted: workflow.callConsentGranted,
    consentSource: workflow.consentSource,
    attemptCount: workflow.attemptCount,
    canRetry: retry.canRetry,
    retryReason: retry.reason,
    policyDecision: workflow.policyDecision,
    policyReasonCode: workflow.policyReasonCode,
    policyExplanation: workflow.policyExplanation,
    prepareToken: workflow.prepareToken,
    providerCallId: workflow.providerCallId,
    phoneProviderId: workflow.phoneProviderId ?? null,
    status: workflow.status,
    dryRun: workflow.dryRun,
    structuredResult: workflow.structuredResult,
    failureCode: workflow.failureCode,
    createdAt: workflow.createdAt,
    updatedAt: workflow.updatedAt,
    startedAt: workflow.startedAt,
    completedAt: workflow.completedAt,
    sideEffects: workflow.dryRun
      ? ["No live phone call will be placed.", "A deterministic dry-run result will update follow-up state."]
      : [
          "A live phone call will be placed to the masked recipient.",
          "Structured results will update follow-up state.",
        ],
  };
}

function resolveEnv(opts?: { env?: Partial<CalleServiceEnv>; config?: CalleConfig }): CalleServiceEnv {
  if (opts?.env) {
    const { apiKey: envApiKey, hasApiKey: _ignored, ...rest } = opts.env;
    const apiKey = envApiKey ?? "";
    return {
      liveCallsEnabled: false,
      killSwitch: false,
      ...rest,
      apiKey,
      hasApiKey: Boolean(apiKey),
    };
  }

  const config = opts?.config ?? loadCalleConfig();
  return toPolicyEnv(config);
}

export function createCalleService(opts?: {
  env?: Partial<CalleServiceEnv>;
  config?: CalleConfig;
  adapter?: CalleAdapter;
  fallbackAdapters?: CalleAdapter[];
  store?: Map<string, CallWorkflow>;
  idempotency?: Map<string, string>;
}) {
  const config = opts?.config ?? loadCalleConfig();
  const env = resolveEnv(opts?.env ? opts : { config });

  const adapter =
    opts?.adapter ??
    createCalleAdapter({
      apiKey: env.apiKey,
      liveCallsEnabled: env.liveCallsEnabled && !env.killSwitch,
      fallbackAdapters: opts?.fallbackAdapters,
    });

  const store = opts?.store ?? globalStore;
  const idempotency = opts?.idempotency ?? globalIdempotency;
  const orchestrator = createPhoneCallOrchestrator({ policyEnv: env, adapter, store });

  async function prepare(raw: PrepareCallInput, initiatorUserId: number) {
    assertCallEEnabled();
    const input = prepareCallInputSchema.parse(raw);
    const idempotencyKey = makeIdempotencyKey(input, initiatorUserId);
    const existingId = idempotency.get(idempotencyKey);
    if (existingId) {
      const existing = store.get(existingId);
      if (existing) {
        return {
          workflow: toPublic(existing),
          reused: true as const,
          explanation: "Returning existing workflow for this idempotency key.",
        };
      }
    }

    const policy = evaluateCallPolicy(input, env);
    const preflight = runPreflight(input, env);
    const { plan: callPlan } = orchestrator.validateBeforeCall(input);
    const timestamp = nowIso();
    const denied = policy.decision === "deny";
    const workflow: CallWorkflow = {
      id: randomUUID().replace(/-/g, "").slice(0, 24),
      purpose: input.purpose,
      womanId: input.womanId,
      recipientE164: input.recipientE164,
      recipientRegion: input.recipientRegion.toUpperCase(),
      callLanguage: input.callLanguage,
      initiatorUserId,
      triageState: input.triageState,
      callConsentGranted: input.callConsentGranted,
      consentSource: input.consentSource ?? null,
      attemptCount: 0,
      policyDecision: policy.decision,
      policyReasonCode: policy.reasonCode,
      policyExplanation: policy.explanation,
      idempotencyKey,
      prepareToken: randomUUID().replace(/-/g, ""),
      providerCallId: null,
      phoneProviderId: null,
      status: "prepared",
      dryRun: policy.dryRun || policy.decision !== "allow",
      structuredResult: null,
      failureCode: denied && policy.reasonCode !== "ok" ? policy.reasonCode : null,
      createdAt: timestamp,
      updatedAt: timestamp,
      startedAt: null,
      completedAt: null,
    };

    store.set(workflow.id, workflow);
    idempotency.set(idempotencyKey, workflow.id);

    const correlation = createCorrelationBundle({
      chwTaskId: input.womanId,
      workflowId: workflow.id,
    });
    recordCallEvent({
      eventId: `evt_${workflow.id}_intent`,
      eventType: "intent_created",
      correlationId: correlation.correlationId,
      workflowId: workflow.id,
      at: nowIso(),
      actor: "chw",
      summary: `Prepared ${input.purpose} for ${input.womanId}`,
      meta: { dryRun: workflow.dryRun, policy: policy.decision },
    });
    recordCallEvent({
      eventId: `evt_${workflow.id}_policy`,
      eventType: "policy_decided",
      correlationId: correlation.correlationId,
      workflowId: workflow.id,
      at: nowIso(),
      actor: "system",
      summary: policy.explanation,
      code: policy.reasonCode,
    });
    recordCallEvent({
      eventId: `evt_${workflow.id}_preflight`,
      eventType: "preflight_completed",
      correlationId: correlation.correlationId,
      workflowId: workflow.id,
      at: nowIso(),
      actor: "system",
      summary: preflight.summary,
      meta: { allowed: preflight.allowed },
    });

    orchestrator.emit({
      workflow,
      fromStatus: null,
      toStatus: "prepared",
      actor: "chw",
      source: "prepare",
    });
    resetConversation(workflow.id);
    advanceConversation(workflow.id, "start");
    let billingPreview: ReturnType<typeof billingService.getUsageSummary> | null = null;
    try {
      billingPreview = billingService.getUsageSummary(initiatorUserId);
    } catch {
      billingPreview = null;
    }
    return {
      workflow: toPublic(workflow),
      reused: false as const,
      explanation: policy.explanation,
      preflight,
      callPlan,
      billingPreview,
    };
  }

  function confirmResponse(workflow: CallWorkflow) {
    const followUp: FollowUpMapping | null = workflow.structuredResult
      ? mapStructuredResultToFollowUp(workflow.structuredResult)
      : null;
    const outcome = isTerminalWorkflowStatus(workflow.status)
      ? orchestrator.buildOutcome(workflow)
      : null;
    return { ok: true as const, workflow: toPublic(workflow), followUp, outcome };
  }

  function applyProviderUpdate(
    workflow: CallWorkflow,
    provider: ProviderCallResult,
    initiatorUserId: number,
    opts: { source: "adapter" | "status" },
  ) {
    const priorStatus = workflow.status;
    workflow.providerCallId = provider.providerCallId || workflow.providerCallId;
    workflow.phoneProviderId = provider.phoneProviderId ?? workflow.phoneProviderId ?? null;
    if (workflow.providerCallId) {
      attachProviderCallId(workflow.id, workflow.providerCallId);
    }

    const correlation = getCorrelationBundle(workflow.id);
    if (correlation) {
      const attempts = provider.failoverAttempts ?? [];
      if (attempts.length > 1) {
        const winner = attempts.find((attempt) => attempt.accepted) ?? attempts[attempts.length - 1];
        recordCallEvent({
          eventId: `evt_${workflow.id}_failover`.slice(0, 64),
          eventType: "provider_failover",
          correlationId: correlation.correlationId,
          workflowId: workflow.id,
          at: nowIso(),
          actor: "provider",
          summary: `Phone API failover to ${winner.providerId} after ${attempts.length} attempts`,
          code: winner.failureCode ?? undefined,
          meta: {
            from: attempts[0]?.providerId ?? "call-e",
            to: winner.providerId,
            attempts: attempts.length,
          },
        });
      }
      recordCallEvent({
        eventId: `evt_${workflow.id}_${opts.source}_${randomUUID().replace(/-/g, "").slice(0, 8)}`.slice(
          0,
          64,
        ),
        eventType: opts.source === "adapter" ? "provider_requested" : "provider_status",
        correlationId: correlation.correlationId,
        workflowId: workflow.id,
        at: nowIso(),
        actor: "provider",
        summary: `Provider ${provider.phoneProviderId ?? "call-e"} status ${provider.status}`,
        code: provider.failureCode ?? undefined,
      });
    }

    if (provider.status !== workflow.status) {
      setWorkflowStatus(workflow, provider.status);
      orchestrator.emit({
        workflow,
        fromStatus: priorStatus,
        toStatus: provider.status,
        actor: "provider",
        source: opts.source === "status" ? "status" : "adapter",
        code: provider.failureCode ?? undefined,
      });
    }

    if (provider.structuredResult) {
      workflow.structuredResult = provider.structuredResult;
    }
    workflow.failureCode = provider.failureCode;
    workflow.updatedAt = nowIso();

    const settledNow =
      isTerminalWorkflowStatus(workflow.status) && !isTerminalWorkflowStatus(priorStatus);
    if (settledNow) {
      workflow.completedAt = workflow.updatedAt;
      billingService.finalizeCallBilling({
        userId: initiatorUserId,
        workflowId: workflow.id,
        status: workflow.status,
        dryRun: workflow.dryRun,
      });
      const outcome = orchestrator.buildOutcome(workflow);
      if (correlation) {
        recordCallEvent({
          eventId: `evt_${workflow.id}_outcome`,
          eventType:
            outcome.confidenceGate === "review_required" ? "review_required" : "outcome_extracted",
          correlationId: correlation.correlationId,
          workflowId: workflow.id,
          at: nowIso(),
          actor: "ai",
          summary: `Disposition ${outcome.extracted.disposition}; gate ${outcome.confidenceGate}`,
          meta: { confidence: outcome.extracted.confidence },
        });
        recordCallEvent({
          eventId: `evt_${workflow.id}_done`,
          eventType: workflow.status === "failed" ? "failed" : "completed",
          correlationId: correlation.correlationId,
          workflowId: workflow.id,
          at: nowIso(),
          actor: "system",
          summary: normalizeCallStatus(workflow.status).label,
        });
      }
      if (provider.structuredResult?.safetyEscalation === "urgent_in_person_care") {
        advanceConversation(workflow.id, "escalate");
      } else if (workflow.status === "no_answer") {
        advanceConversation(workflow.id, "voicemail_detected");
      } else if (workflow.status !== "cancelled" && workflow.status !== "failed") {
        advanceConversation(workflow.id, "identity_verified");
        advanceConversation(workflow.id, "purpose_acknowledged");
        advanceConversation(workflow.id, "close_requested");
        advanceConversation(workflow.id, "close_requested");
      }
    }

    store.set(workflow.id, workflow);
  }

  async function refreshFromProvider(workflow: CallWorkflow, initiatorUserId: number) {
    if (!workflow.providerCallId) return;
    if (isTerminalWorkflowStatus(workflow.status)) return;
    const provider = await adapter.getStatus(workflow.providerCallId);
    applyProviderUpdate(workflow, provider, initiatorUserId, { source: "status" });
  }

  async function confirm(raw: ConfirmCallInput, initiatorUserId: number) {
    const input = confirmCallInputSchema.parse(raw);
    const workflow = store.get(input.workflowId);
    if (!workflow || workflow.initiatorUserId !== initiatorUserId) {
      return { ok: false as const, code: "unauthorized" as CallFailureCode };
    }
    if (workflow.prepareToken !== input.prepareToken) {
      return { ok: false as const, code: "unauthorized" as CallFailureCode };
    }
    if (workflow.policyDecision === "deny") {
      return {
        ok: false as const,
        code: (workflow.failureCode ?? "calls_disabled") as CallFailureCode,
        workflow: toPublic(workflow),
      };
    }
    if (isTerminalWorkflowStatus(workflow.status)) {
      return confirmResponse(workflow);
    }

    // Persist run_id and resume get_call_run — never place the call twice.
    if (workflow.providerCallId) {
      await refreshFromProvider(workflow, initiatorUserId);
      return confirmResponse(workflow);
    }

    if (workflow.status === "starting" || workflow.status === "in_progress") {
      return {
        ok: false as const,
        code: "duplicate_in_flight" as CallFailureCode,
        workflow: toPublic(workflow),
      };
    }

    const priorStatus = workflow.status;

    const budget = billingService.validateLiveCallBudget(initiatorUserId, {
      dryRun: workflow.dryRun,
      workflowId: workflow.id,
    });
    if (!budget.ok) {
      return {
        ok: false as const,
        code: budget.code as CallFailureCode,
        workflow: toPublic(workflow),
        billingMessage: budget.message,
        upgradePlanId: budget.upgradePlanId,
      };
    }

    setWorkflowStatus(workflow, "starting");
    workflow.startedAt = nowIso();
    workflow.updatedAt = workflow.startedAt;
    workflow.attemptCount += 1;
    store.set(workflow.id, workflow);
    orchestrator.emit({
      workflow,
      fromStatus: priorStatus,
      toStatus: "starting",
      actor: "system",
      source: "confirm",
    });

    const provider = await adapter.placeFollowUpCall({
      workflowId: workflow.id,
      idempotencyKey: workflow.idempotencyKey,
      recipientE164: workflow.recipientE164,
      recipientRegion: workflow.recipientRegion,
      purpose: workflow.purpose,
      callLanguage: workflow.callLanguage,
      dryRun: workflow.dryRun,
    });

    applyProviderUpdate(workflow, provider, initiatorUserId, { source: "adapter" });
    return confirmResponse(workflow);
  }

  async function getStatus(workflowId: string, initiatorUserId: number) {
    const workflow = store.get(workflowId);
    if (!workflow || workflow.initiatorUserId !== initiatorUserId) return null;
    await refreshFromProvider(workflow, initiatorUserId);
    return toPublic(workflow);
  }

  async function cancel(workflowId: string, initiatorUserId: number) {
    const workflow = store.get(workflowId);
    if (!workflow || workflow.initiatorUserId !== initiatorUserId) {
      return { ok: false as const, code: "unauthorized" as CallFailureCode };
    }
    if (workflow.providerCallId) {
      try {
        const cancelled = await adapter.cancel(workflow.providerCallId);
        if (cancelled.failureCode && cancelled.failureCode !== "cancelled" && cancelled.status !== "cancelled") {
          return { ok: false as const, code: cancelled.failureCode };
        }
      } catch {
        return { ok: false as const, code: "provider_unavailable" as CallFailureCode };
      }
    }
    setWorkflowStatus(workflow, "cancelled");
    workflow.failureCode = "cancelled";
    workflow.updatedAt = nowIso();
    workflow.completedAt = workflow.updatedAt;
    store.set(workflow.id, workflow);
    return { ok: true as const, workflow: toPublic(workflow) };
  }

  function getCapabilities() {
    return {
      ...getCapabilitySnapshot(),
      providerCapabilities: resolveProviderCapabilities(config),
      v4Flags: getPublicV4Flags(),
      v5Flags: getPublicV5Flags(),
      publicConfig: {
        configured: config.configured,
        liveCallsEnabled: config.liveCallsEnabled,
        killSwitch: config.killSwitch,
        demoMode: config.demoMode,
        mode: config.mode,
        indicator: getPublicV5Flags().indicator,
      },
      demoScenarios: DEMO_SCENARIO_IDS,
    };
  }

  function validateConfig() {
    return validateCalleConfig();
  }

  async function runHeroDemo(initiatorUserId: number) {
    return runDemoScenario("demo-ben-001", initiatorUserId, { store, idempotency });
  }

  function getReleaseReport() {
    return {
      version: "v5-hackathon",
      generatedAt: nowIso(),
      flags: loadV5FeatureFlags(),
      configValidation: validateCalleConfig(),
      testCommands: ["pnpm run test:calle", "pnpm run calle:health", "pnpm check"],
      heroDemoBeneficiary: "demo-ben-001",
      limitations: [
        "In-memory workflow store",
        "Rule-based AI only",
        "SDK transfer/cancel not exposed",
      ],
    };
  }

  function getDemoCatalog() {
    return {
      beneficiaries: listDemoBeneficiaries(),
      scenarios: DEMO_SCENARIO_IDS,
      publicConfig: getCapabilities().publicConfig,
    };
  }

  async function runDemoScenario(
    beneficiaryId: string,
    initiatorUserId: number,
    opts?: { store?: Map<string, CallWorkflow>; idempotency?: Map<string, string> },
  ) {
    const beneficiary = getDemoBeneficiary(beneficiaryId);
    if (!beneficiary) {
      return { ok: false as const, code: "invalid_recipient" as CallFailureCode };
    }

    const scenario = beneficiary.scenario as DemoScenarioId;
    const scenarioService = createCalleService({
      config: { ...config, demoMode: true, mode: "demo" },
      adapter: new FakeCalleRuntime(scenario),
      store: opts?.store ?? new Map(),
      idempotency: opts?.idempotency ?? new Map(),
    });

    const actionToken = randomUUID();
    const prepared = await scenarioService.prepare(
      {
        womanId: beneficiary.id,
        purpose: beneficiary.purpose,
        recipientE164: beneficiary.demoE164,
        recipientRegion: beneficiary.region,
        callLanguage: beneficiary.locale,
        triageState: beneficiary.triageState,
        callConsentGranted: beneficiary.consent === "granted",
        consentSource: beneficiary.consent === "granted" ? "woman_record" : "unknown",
        actionToken,
        forceDryRun: true,
      },
      initiatorUserId,
    );

    if (prepared.workflow.policyDecision === "deny") {
      return {
        ok: false as const,
        code: (prepared.workflow.policyReasonCode as CallFailureCode) ?? "calls_disabled",
        prepared,
        beneficiary: listDemoBeneficiaries().find((b) => b.id === beneficiaryId),
      };
    }

    const confirmed = await scenarioService.confirm(
      { workflowId: prepared.workflow.id, prepareToken: prepared.workflow.prepareToken },
      initiatorUserId,
    );

    return {
      ok: confirmed.ok,
      scenario,
      beneficiary: listDemoBeneficiaries().find((b) => b.id === beneficiaryId),
      prepared,
      confirmed,
      timeline: scenarioService.getCallTimeline(prepared.workflow.id),
    };
  }

  function getCallTimeline(workflowId: string) {
    return orchestrator.getTimeline(workflowId);
  }

  function getQueueHealth() {
    return orchestrator.getQueueHealth();
  }

  function listCommandCenter(initiatorUserId: number, filters: CommandCenterFilters = {}) {
    const rows = [...store.values()]
      .filter((w) => w.initiatorUserId === initiatorUserId)
      .map((w) => {
        const retry = evaluateRetry({
          status: w.status,
          failureCode: w.failureCode,
          attemptCount: w.attemptCount,
        });
        return workflowToCommandRow(w, maskE164, retry.canRetry);
      })
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));

    const filtered = filterCommandCenterRows(rows, filters);
    return {
      summary: summarizeCommandCenter(filtered),
      calls: filtered,
    };
  }

  async function getCallDetail(workflowId: string, initiatorUserId: number) {
    const workflow = store.get(workflowId);
    if (!workflow || workflow.initiatorUserId !== initiatorUserId) return null;
    await refreshFromProvider(workflow, initiatorUserId);

    const publicWorkflow = toPublic(workflow);
    const timeline = orchestrator.getTimeline(workflowId);
    const outcome = workflow.structuredResult ? orchestrator.buildOutcome(workflow) : null;
    const compiled = compileCallIntent({
      womanId: workflow.womanId,
      purpose: workflow.purpose,
      recipientE164: workflow.recipientE164,
      recipientRegion: workflow.recipientRegion,
      callLanguage: workflow.callLanguage,
      triageState: workflow.triageState,
      callConsentGranted: workflow.callConsentGranted,
      consentSource: workflow.consentSource ?? undefined,
      actionToken: workflow.idempotencyKey,
    });
    const brief = await buildCallBrief({
      beneficiaryId: workflow.womanId,
      purpose: workflow.purpose,
      locale: workflow.callLanguage,
    });

    return {
      workflow: publicWorkflow,
      timeline,
      outcome,
      compiledIntent: compiled.ok ? compiled.intent : null,
      compileIssues: compiled.ok ? compiled.issues : compiled.issues,
      conversationState: getConversationState(workflowId),
      callBrief: brief,
      providerCapabilities: resolveProviderCapabilities(config),
      correlation: getCorrelationBundle(workflowId) ?? null,
      events: listCallEvents(workflowId),
      normalizedStatus: normalizeCallStatus(workflow.status),
    };
  }

  function compileIntent(raw: PrepareCallInput) {
    return compileCallIntent(prepareCallInputSchema.parse(raw));
  }

  function compileColloquial(text: string) {
    return compileFromColloquial(text);
  }

  function preflight(raw: PrepareCallInput) {
    const input = prepareCallInputSchema.parse(raw);
    return runPreflight(input, env);
  }

  return {
    prepare,
    confirm,
    getStatus,
    cancel,
    getCapabilities,
    getDemoCatalog,
    runDemoScenario,
    getCallTimeline,
    getQueueHealth,
    listCommandCenter,
    getCallDetail,
    compileIntent,
    compileColloquial,
    validateConfig,
    runHeroDemo,
    getReleaseReport,
    preflight,
  };
}

export type CalleWorkflowService = ReturnType<typeof createCalleService>;

/** Shared default service for tRPC routers (dry-run unless env enables live calls). */
export const calleService = createCalleService();

/** REST/SDK gateway service used by `/api/calle`. */
export { CalleService } from "./api-service";
