import { createHash, randomBytes } from "node:crypto";

import type { W3CTraceContext } from "@muster/contracts";

import {
  mapCalleTerminalOutput,
  type CalleEvidencePersistence,
  type MappedCalleTerminalOutput,
} from "./calle-terminal-output.js";
import type { RunAuthorizationReservationBoundary } from "./run-authorization.js";
import type { DtmfSafetyStop } from "./dtmf-canary.js";
import { LiveSmokeEvidencePersistenceError } from "./live-smoke-evidence-coordinator.js";

export type LiveSmokeBlockedReason =
  | "production_forbidden"
  | "live_smoke_disabled"
  | "safety_configuration_invalid"
  | "run_gate_closed"
  | "kill_switch_blocked"
  | "synthetic_target_unauthorized"
  | "required_secret_unresolved"
  | "run_authorization_missing"
  | "authorization_store_unavailable"
  | "authorization_rejected"
  | "observability_unavailable"
  | "trace_context_unavailable"
  | "semantic_replay_conflict"
  | "concurrency_slot_occupied"
  | "call_budget_exhausted";

export type LiveSmokeResultPersistenceFailureReason =
  "evidence_timestamp_invalid" | "application_persistence_failed";

export class LiveSmokeResultPersistenceError extends Error {
  public readonly reason: LiveSmokeResultPersistenceFailureReason;

  public constructor(reason: LiveSmokeResultPersistenceFailureReason) {
    super("Live smoke result persistence failed");
    this.name = "LiveSmokeResultPersistenceError";
    this.reason = reason;
  }
}

type LiveSmokeTerminalSignalReason = "provider_failed" | "persistence_unavailable";

class LiveSmokeTerminalSignalError extends Error {
  public constructor(public readonly reason: LiveSmokeTerminalSignalReason) {
    super("Live smoke execution was terminalized");
    this.name = "LiveSmokeTerminalSignalError";
  }
}

class LiveSmokeRunnerDeadlineError extends Error {
  public constructor(
    public readonly reason: "provider_timeout" | "application_persistence_failed",
  ) {
    super("Live smoke runner deadline expired");
    this.name = "LiveSmokeRunnerDeadlineError";
  }
}

type LiveSmokeFailureReason =
  | "provider_timeout"
  | "provider_failed"
  | "dtmf_safety_stop"
  | "safety_blocked"
  | LiveSmokeResultPersistenceFailureReason;

export type LiveSmokeResult =
  | Readonly<{ status: "blocked"; reason: LiveSmokeBlockedReason }>
  | Readonly<{
      status: "completed";
      authorizationConsumed: true;
      mapped: MappedCalleTerminalOutput;
    }>
  | Readonly<{
      status: "failed";
      reason: LiveSmokeFailureReason;
      retryable: false;
      authorizationConsumed: true;
    }>;

export interface LiveSmokeDispatchRequest {
  readonly apiToken: string;
  readonly targetAddress: string;
  readonly endpointAlias: string;
  readonly operationId: string;
  readonly providerDispatchIdentity: string;
  readonly scenarioId: string;
  readonly scenarioRevision: number;
  readonly timeoutMs: number;
  readonly retryLimit: 0;
  readonly dtmfPolicy: Readonly<{ kind: "forbidden"; allowlist: readonly never[] }>;
  readonly traceContext: W3CTraceContext;
  readonly signal: AbortSignal;
}

export interface LiveSmokeRunner {
  execute(input: LiveSmokeExecutionInput): Promise<LiveSmokeResult>;
}

export interface LiveSmokeExecutionInput {
  readonly operationId: string;
  readonly scenarioId: string;
  readonly scenarioRevision: number;
  readonly runAuthorization: string;
  readonly predecessorOperationId?: string;
  readonly traceContext?: W3CTraceContext;
}

export type LiveSmokeEvent = Readonly<{
  event: "simulator.live_smoke";
  outcome:
    | "blocked"
    | "gate_passed"
    | "authorization_reserved"
    | "dispatch_attempted"
    | "evidence_persisted"
    | "completed"
    | "failed";
  traceId: string;
  spanId: string;
  reason?: LiveSmokeBlockedReason | SafeLiveSmokeTelemetryReason;
  providerResponseStatusCode?: number;
  providerResponseContentType?: SafeProviderResponseContentType;
  providerResponseBody?: SafeProviderResponseBody;
  providerResponseLocation?: SafeProviderResponseLocation;
  providerRequestIdPresent?: boolean;
}>;

type SafeProviderResponseContentType = "missing" | "json" | "text" | "other";
type SafeProviderResponseBody = "absent" | "present" | "unavailable";
type SafeProviderResponseLocation =
  "missing" | "invalid" | "cross_origin" | "invalid_call_resource" | "exact_call_resource";

type SafeProviderCreateResponseDiagnostics = Readonly<{
  providerResponseStatusCode: number;
  providerResponseContentType: SafeProviderResponseContentType;
  providerResponseBody: SafeProviderResponseBody;
  providerResponseLocation: SafeProviderResponseLocation;
  providerRequestIdPresent: boolean;
}>;

type SafeProviderTelemetryReason =
  | "provider_timeout"
  | "provider_failed"
  | "provider_authentication"
  | "provider_rate_limited"
  | "provider_insufficient_balance"
  | "provider_recipient_blocked"
  | "provider_invalid_recipient"
  | "provider_unsupported_region"
  | "provider_policy_violation"
  | "provider_create_response_invalid"
  | "provider_unavailable"
  | "provider_no_answer"
  | "provider_busy"
  | "provider_evidence_invalid"
  | "provider_evidence_invalid_terminal_shape"
  | "provider_evidence_invalid_reading_shape"
  | "provider_evidence_invalid_zone_identity"
  | "provider_evidence_invalid_anchor_value"
  | "provider_evidence_invalid_anchor_unit"
  | "provider_evidence_invalid_anchor_status"
  | "provider_evidence_invalid_auxiliary_status"
  | "provider_evidence_unavailable";

type SafeLiveSmokeTelemetryReason =
  SafeProviderTelemetryReason | LiveSmokeResultPersistenceFailureReason;

const safeProviderTelemetryReasons = new Set<SafeProviderTelemetryReason>([
  "provider_timeout",
  "provider_failed",
  "provider_authentication",
  "provider_rate_limited",
  "provider_insufficient_balance",
  "provider_recipient_blocked",
  "provider_invalid_recipient",
  "provider_unsupported_region",
  "provider_policy_violation",
  "provider_create_response_invalid",
  "provider_unavailable",
  "provider_no_answer",
  "provider_busy",
  "provider_evidence_invalid",
  "provider_evidence_invalid_terminal_shape",
  "provider_evidence_invalid_reading_shape",
  "provider_evidence_invalid_zone_identity",
  "provider_evidence_invalid_anchor_value",
  "provider_evidence_invalid_anchor_unit",
  "provider_evidence_invalid_anchor_status",
  "provider_evidence_invalid_auxiliary_status",
  "provider_evidence_unavailable",
]);

const safeStructuredAdmissionCauses = new Set([
  "terminal_shape",
  "reading_shape",
  "zone_identity",
  "anchor_value",
  "anchor_unit",
  "anchor_status",
  "auxiliary_status",
]);

function safeProviderTelemetryReason(error: unknown): SafeProviderTelemetryReason {
  if (!(error instanceof Error)) return "provider_failed";
  const match = /^CALL-E provider terminal: ([a-z_]+)$/u.exec(error.message);
  const reason = match?.[1] as SafeProviderTelemetryReason | undefined;
  if (
    reason === "provider_evidence_invalid" &&
    typeof error.cause === "string" &&
    safeStructuredAdmissionCauses.has(error.cause)
  ) {
    return `provider_evidence_invalid_${error.cause}` as SafeProviderTelemetryReason;
  }
  return reason !== undefined && safeProviderTelemetryReasons.has(reason)
    ? reason
    : error.message === "provider_timeout"
      ? "provider_timeout"
      : "provider_failed";
}

function safeResultPersistenceTelemetryReason(
  error: unknown,
): LiveSmokeResultPersistenceFailureReason {
  return error instanceof LiveSmokeResultPersistenceError
    ? error.reason
    : "application_persistence_failed";
}

function failureReasonForTerminalOutcome(
  outcome: LiveSmokeDurableTerminalFailureOutcome,
): LiveSmokeFailureReason {
  if (outcome === "evidence_unavailable") return "application_persistence_failed";
  if (outcome === "blocked") return "safety_blocked";
  return "provider_failed";
}

const safeProviderResponseContentTypes = new Set<SafeProviderResponseContentType>([
  "missing",
  "json",
  "text",
  "other",
]);
const safeProviderResponseBodies = new Set<SafeProviderResponseBody>([
  "absent",
  "present",
  "unavailable",
]);
const safeProviderResponseLocations = new Set<SafeProviderResponseLocation>([
  "missing",
  "invalid",
  "cross_origin",
  "invalid_call_resource",
  "exact_call_resource",
]);

function safeProviderCreateResponseDiagnostics(
  error: unknown,
): SafeProviderCreateResponseDiagnostics | undefined {
  if (!(error instanceof Error) || error.cause === null || typeof error.cause !== "object") {
    return undefined;
  }
  const cause = error.cause as Record<string, unknown>;
  if (cause["diagnostics"] === null || typeof cause["diagnostics"] !== "object") {
    return undefined;
  }
  const diagnostics = cause["diagnostics"] as Record<string, unknown>;
  const statusCode = diagnostics["statusCode"];
  const contentType = diagnostics["contentType"] as SafeProviderResponseContentType | undefined;
  const body = diagnostics["body"] as SafeProviderResponseBody | undefined;
  const location = diagnostics["location"] as SafeProviderResponseLocation | undefined;
  const requestIdPresent = diagnostics["requestIdPresent"];
  if (
    !Number.isInteger(statusCode) ||
    (statusCode as number) < 100 ||
    (statusCode as number) > 599 ||
    contentType === undefined ||
    !safeProviderResponseContentTypes.has(contentType) ||
    body === undefined ||
    !safeProviderResponseBodies.has(body) ||
    location === undefined ||
    !safeProviderResponseLocations.has(location) ||
    typeof requestIdPresent !== "boolean"
  ) {
    return undefined;
  }
  return Object.freeze({
    providerResponseStatusCode: statusCode as number,
    providerResponseContentType: contentType,
    providerResponseBody: body,
    providerResponseLocation: location,
    providerRequestIdPresent: requestIdPresent,
  });
}

export interface LiveSmokeObservability {
  establishTraceContext(input?: W3CTraceContext): W3CTraceContext;
  record(event: LiveSmokeEvent): void;
  runJobSpan?<T>(operation: () => Promise<T>): Promise<T>;
  runProviderSpan?<T>(operation: () => Promise<T>): Promise<T>;
}

export type LiveSmokeDurableTerminalFailureOutcome =
  "blocked" | "no_answer" | "busy" | "provider_failed" | "evidence_unavailable";

export type LiveSmokeTerminalPersistenceResult = Readonly<{
  terminalOutcome: "observation_recorded" | LiveSmokeDurableTerminalFailureOutcome;
}>;

export interface LiveSmokeTerminalAttemptPersistence {
  recordFailure(input: {
    readonly operationId: string;
    readonly outcome: "blocked" | "no_answer" | "busy" | "provider_failed" | "evidence_unavailable";
    readonly retryable: false;
  }): Promise<void | LiveSmokeTerminalPersistenceResult>;
}

export interface LiveSmokeKillSwitch {
  assertDispatchAllowed(): void;
}

export interface LiveSmokeRunGate {
  assertOpen(): void;
}

export interface LiveSmokeRunnerEvidenceCoordinator {
  claimTerminalPersistence?(input: { readonly operationId: string }): "runner" | "coordinator";
  onTerminal?(
    input: { readonly operationId: string },
    listener: (reason: LiveSmokeTerminalSignalReason) => void,
  ): () => void;
  begin?(input: {
    readonly operationId: string;
    readonly deadlineMs: number;
    readonly terminalDeadlineMs: number;
  }): void;
  recordCalleTerminal(input: {
    readonly operationId: string;
    readonly providerOutput: unknown;
    readonly traceId: string;
    readonly providerCallDigest: string;
  }): Promise<void>;
  assertReady(input: { readonly operationId: string }): Promise<
    | Readonly<{
        outcome: "ready";
        dtmfActions: 0;
        twilioReconciliation: "1 matching call";
      }>
    | Readonly<{ outcome: "blocked"; reason?: string }>
  >;
  settle?(input: { readonly operationId: string }): "runner" | "coordinator" | void;
  completeTerminalPersistence?(input: { readonly operationId: string }): Promise<void>;
}

export interface LiveSmokeDispatchAttemptPersistence {
  claim(input: { readonly operationId: string }): Promise<{
    readonly outcome?: "claimed" | "reconcile";
    readonly providerDispatchIdentity: string;
    readonly adapterVersionId: string;
  }>;
  recordDisposition?(input: {
    readonly operationId: string;
    readonly outcome: "provider_returned" | "provider_failed";
  }): Promise<void>;
}

export interface LiveSmokeResultPersistence {
  /** The persistence adapter owns this atomic canary/commit arbitration boundary. */
  commitAtomically(
    input: {
      readonly operationId: string;
      readonly result: MappedCalleTerminalOutput["result"];
    },
    canCommit: () => boolean,
  ): Promise<
    | Readonly<{ disposition: "blocked" }>
    | Readonly<{ disposition: "committed"; winner: "observation_recorded" }>
    | Readonly<{
        disposition: "committed";
        winner: "terminal_failure";
        terminalOutcome: LiveSmokeDurableTerminalFailureOutcome;
      }>
  >;
}

interface LiveSmokeConfiguration {
  readonly runtimeProfile?: "development" | "test" | "ci" | "production";
  readonly enabled?: boolean;
  readonly killSwitchAllows?: boolean;
  readonly syntheticTargetAuthorized?: boolean;
  readonly callBudget?: number;
  readonly concurrency?: number;
  readonly timeoutMs?: number;
  readonly providerTerminalTimeoutMs?: number;
  readonly endpointAlias?: string;
  readonly authorizationAudience?: string;
  readonly requireCallbackEvidence?: boolean;
}

const liveSmokeSettlementGraceMs = 5_000;

export function calculateLiveSmokeProviderOperationTimeoutMs(input: {
  readonly callbackDeadlineMs: number;
  readonly providerTerminalTimeoutMs: number;
}): number {
  if (
    !Number.isSafeInteger(input.callbackDeadlineMs) ||
    input.callbackDeadlineMs < 1 ||
    input.callbackDeadlineMs > 120_000 ||
    !Number.isSafeInteger(input.providerTerminalTimeoutMs) ||
    input.providerTerminalTimeoutMs < input.callbackDeadlineMs ||
    input.providerTerminalTimeoutMs > 180_000
  ) {
    throw new Error("Live-smoke timeout configuration is invalid");
  }
  return input.callbackDeadlineMs + input.providerTerminalTimeoutMs;
}

export function calculateLiveSmokeEvidenceTimeoutMs(input: {
  readonly callbackDeadlineMs: number;
  readonly providerTerminalTimeoutMs: number;
}): number {
  return calculateLiveSmokeProviderOperationTimeoutMs(input) + liveSmokeSettlementGraceMs;
}

export function calculateLiveSmokeRunnerTimeoutMs(input: {
  readonly callbackDeadlineMs: number;
  readonly providerTerminalTimeoutMs: number;
}): number {
  return calculateLiveSmokeEvidenceTimeoutMs(input) + liveSmokeSettlementGraceMs;
}

export function calculateLiveSmokeWorkerTimeoutMs(input: {
  readonly callbackDeadlineMs: number;
  readonly providerTerminalTimeoutMs: number;
}): number {
  return calculateLiveSmokeRunnerTimeoutMs(input) + liveSmokeSettlementGraceMs;
}

export function calculateLiveSmokeProjectionTimeoutMs(input: {
  readonly callbackDeadlineMs: number;
  readonly providerTerminalTimeoutMs: number;
}): number {
  return calculateLiveSmokeWorkerTimeoutMs(input) + liveSmokeSettlementGraceMs;
}

const traceparentPattern = /^00-(?!0{32})([0-9a-f]{32})-(?!0{16})[0-9a-f]{16}-[0-9a-f]{2}$/u;

function blocked(reason: LiveSmokeBlockedReason): LiveSmokeResult {
  return Object.freeze({ status: "blocked", reason });
}

function semanticFingerprint(input: LiveSmokeExecutionInput): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        input.operationId,
        input.scenarioId,
        input.scenarioRevision,
        input.predecessorOperationId ?? null,
        createHash("sha256").update(input.runAuthorization, "utf8").digest("hex"),
      ]),
      "utf8",
    )
    .digest("hex");
}

function traceDetails(
  context: W3CTraceContext,
): Readonly<{ context: W3CTraceContext; traceId: string; spanId: string }> {
  const traceparent = context.traceparent.trim().toLowerCase();
  const match = traceparentPattern.exec(traceparent);
  if (match?.[1] === undefined) throw new Error("Invalid trace context");
  return Object.freeze({
    context: Object.freeze({
      traceparent,
      ...(context.tracestate === undefined ? {} : { tracestate: context.tracestate }),
    }),
    traceId: match[1],
    spanId: traceparent.split("-")[2]!,
  });
}

function fallbackTraceContext(): W3CTraceContext {
  return Object.freeze({
    traceparent: `00-${randomBytes(16).toString("hex")}-${randomBytes(8).toString("hex")}-01`,
  });
}

async function runWithSafeTelemetrySpan<T>(
  runSpan: ((operation: () => Promise<T>) => Promise<T>) | undefined,
  operation: () => Promise<T>,
): Promise<T> {
  let operationPromise: Promise<T> | undefined;
  const runOnce = (): Promise<T> =>
    (operationPromise ??= Promise.resolve().then(async () => await operation()));
  if (runSpan !== undefined) {
    try {
      await runSpan(runOnce);
    } catch {
      // The authoritative operation result is returned below from the same promise.
    }
  }
  return await runOnce();
}

export function createLiveSmokeRunner(input: {
  readonly configuration: LiveSmokeConfiguration;
  readonly resolvedSecrets?: Readonly<{ calleApiToken: string; targetAddress: string }>;
  readonly authorizationBoundary?: RunAuthorizationReservationBoundary;
  readonly evidencePersistence?: CalleEvidencePersistence;
  readonly reviewedConfidenceTokens?: readonly string[];
  readonly observability?: LiveSmokeObservability;
  readonly terminalAttempts?: LiveSmokeTerminalAttemptPersistence;
  readonly killSwitch?: LiveSmokeKillSwitch;
  readonly runGate?: LiveSmokeRunGate;
  readonly evidenceCoordinator?: LiveSmokeRunnerEvidenceCoordinator;
  readonly dtmfSafetyStop?: DtmfSafetyStop;
  readonly dispatchAttempts?: LiveSmokeDispatchAttemptPersistence;
  readonly resultPersistence?: LiveSmokeResultPersistence;
  readonly dispatch: (request: LiveSmokeDispatchRequest) => Promise<unknown>;
  readonly reconcile?: (request: LiveSmokeDispatchRequest) => Promise<unknown>;
}): LiveSmokeRunner {
  const completedRuns = new Map<
    string,
    Readonly<{ fingerprint: string; operation: Promise<LiveSmokeResult> }>
  >();
  const providerCompletions = new Map<
    string,
    Readonly<{
      fingerprint: string;
      providerDispatchIdentity: string;
      output: unknown;
    }>
  >();
  let activeOperationId: string | undefined;
  let dispatchedOperationId: string | undefined;
  const preflight = (runAuthorization: string): LiveSmokeBlockedReason | undefined => {
    const config = input.configuration;
    const providerTerminalTimeoutMs = config.providerTerminalTimeoutMs ?? config.timeoutMs;
    if (config.runtimeProfile === "production") return "production_forbidden";
    if (config.enabled !== true) return "live_smoke_disabled";
    if (
      config.callBudget !== 1 ||
      config.concurrency !== 1 ||
      config.timeoutMs === undefined ||
      !Number.isSafeInteger(config.timeoutMs) ||
      config.timeoutMs < 1 ||
      config.timeoutMs > 120_000 ||
      providerTerminalTimeoutMs === undefined ||
      !Number.isSafeInteger(providerTerminalTimeoutMs) ||
      providerTerminalTimeoutMs < config.timeoutMs ||
      providerTerminalTimeoutMs > 180_000 ||
      config.endpointAlias === undefined ||
      !/^[a-z][a-z0-9-]{0,62}$/u.test(config.endpointAlias) ||
      config.authorizationAudience === undefined ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(config.authorizationAudience)
    ) {
      return "safety_configuration_invalid";
    }
    if (input.killSwitch === undefined && config.killSwitchAllows !== true) {
      return "kill_switch_blocked";
    }
    if (config.requireCallbackEvidence === true && input.evidenceCoordinator === undefined) {
      return "safety_configuration_invalid";
    }
    const terminalOwnershipHooks = [
      input.evidenceCoordinator?.claimTerminalPersistence,
      input.evidenceCoordinator?.onTerminal,
      input.evidenceCoordinator?.settle,
      input.evidenceCoordinator?.completeTerminalPersistence,
    ];
    const terminalOwnershipHookCount = terminalOwnershipHooks.filter(
      (hook) => typeof hook === "function",
    ).length;
    if (
      terminalOwnershipHookCount !== 0 &&
      terminalOwnershipHookCount !== terminalOwnershipHooks.length
    ) {
      return "safety_configuration_invalid";
    }
    if (
      config.requireCallbackEvidence === true &&
      (terminalOwnershipHookCount !== terminalOwnershipHooks.length ||
        typeof input.evidenceCoordinator?.begin !== "function")
    ) {
      return "safety_configuration_invalid";
    }
    if (config.requireCallbackEvidence === true && input.runGate === undefined) {
      return "run_gate_closed";
    }
    if (input.runGate !== undefined) {
      try {
        input.runGate.assertOpen();
      } catch {
        return "run_gate_closed";
      }
    }
    if (config.syntheticTargetAuthorized === false) return "synthetic_target_unauthorized";
    if (
      input.resolvedSecrets === undefined ||
      input.resolvedSecrets.calleApiToken.length === 0 ||
      input.resolvedSecrets.targetAddress.length === 0
    ) {
      return "required_secret_unresolved";
    }
    if (runAuthorization.length === 0) return "run_authorization_missing";
    if (input.authorizationBoundary === undefined) return "authorization_store_unavailable";
    if (input.observability === undefined) return "observability_unavailable";
    if (input.evidencePersistence === undefined) return "safety_configuration_invalid";
    if (input.reviewedConfidenceTokens === undefined) return "safety_configuration_invalid";
    if (input.terminalAttempts === undefined) return "safety_configuration_invalid";
    if (input.dtmfSafetyStop === undefined) return "safety_configuration_invalid";
    if (input.dispatchAttempts === undefined) return "safety_configuration_invalid";
    return undefined;
  };

  const terminalBlocked = async (
    operationId: string,
    reason: LiveSmokeBlockedReason,
  ): Promise<LiveSmokeResult> => {
    if (input.terminalAttempts === undefined) return blocked(reason);
    await input.terminalAttempts.recordFailure({
      operationId,
      outcome: "blocked",
      retryable: false,
    });
    return blocked(reason);
  };

  return Object.freeze({
    execute(execution: LiveSmokeExecutionInput): Promise<LiveSmokeResult> {
      const fingerprint = semanticFingerprint(execution);
      const replay = completedRuns.get(execution.operationId);
      if (replay !== undefined) {
        return replay.fingerprint === fingerprint
          ? replay.operation
          : Promise.resolve(blocked("semantic_replay_conflict"));
      }
      const reason = preflight(execution.runAuthorization);
      if (reason !== undefined) {
        return reason === "kill_switch_blocked"
          ? terminalBlocked(execution.operationId, reason)
          : Promise.resolve(blocked(reason));
      }
      const config = input.configuration as Required<LiveSmokeConfiguration>;
      const providerTerminalTimeoutMs = config.providerTerminalTimeoutMs ?? config.timeoutMs;
      const providerOperationTimeoutMs =
        input.configuration.providerTerminalTimeoutMs === undefined
          ? config.timeoutMs
          : calculateLiveSmokeProviderOperationTimeoutMs({
              callbackDeadlineMs: config.timeoutMs,
              providerTerminalTimeoutMs,
            });
      const timeoutInput = Object.freeze({
        callbackDeadlineMs: config.timeoutMs,
        providerTerminalTimeoutMs,
      });
      const evidenceTimeoutMs =
        input.configuration.providerTerminalTimeoutMs === undefined
          ? config.timeoutMs
          : calculateLiveSmokeEvidenceTimeoutMs(timeoutInput);
      const runnerTimeoutMs =
        input.configuration.providerTerminalTimeoutMs === undefined
          ? config.timeoutMs
          : calculateLiveSmokeRunnerTimeoutMs(timeoutInput);
      const secrets = input.resolvedSecrets!;
      const authorizationBoundary = input.authorizationBoundary!;
      const evidencePersistence = input.evidencePersistence!;
      const observability = input.observability!;
      let trace: ReturnType<typeof traceDetails>;
      try {
        let establishedTrace: W3CTraceContext | undefined;
        try {
          establishedTrace = observability.establishTraceContext(execution.traceContext);
        } catch {
          // A local trace keeps business execution observable without trusting failed telemetry.
        }
        try {
          trace = traceDetails(
            establishedTrace ?? execution.traceContext ?? fallbackTraceContext(),
          );
        } catch {
          trace = traceDetails(fallbackTraceContext());
        }
      } catch {
        return Promise.resolve(blocked("trace_context_unavailable"));
      }
      const record = (
        outcome: LiveSmokeEvent["outcome"],
        eventReason?: LiveSmokeEvent["reason"],
        createResponseDiagnostics?: SafeProviderCreateResponseDiagnostics,
      ): void => {
        try {
          observability.record(
            Object.freeze({
              event: "simulator.live_smoke",
              outcome,
              traceId: trace.traceId,
              spanId: trace.spanId,
              ...(eventReason === undefined ? {} : { reason: eventReason }),
              ...createResponseDiagnostics,
            }),
          );
        } catch {
          // Event telemetry is best effort and never changes gate or dispatch behavior.
        }
      };
      if (activeOperationId !== undefined) {
        record("blocked", "concurrency_slot_occupied");
        return terminalBlocked(execution.operationId, "concurrency_slot_occupied");
      }
      if (dispatchedOperationId !== undefined && dispatchedOperationId !== execution.operationId) {
        record("blocked", "call_budget_exhausted");
        return terminalBlocked(execution.operationId, "call_budget_exhausted");
      }
      record("gate_passed");
      activeOperationId = execution.operationId;
      const coreOperation = async (): Promise<LiveSmokeResult> => {
        const abortController = new AbortController();
        const unsubscribeDtmf = input.dtmfSafetyStop!.onBlocked?.(() => abortController.abort());
        let unsubscribeEvidenceTerminal: (() => void) | undefined;
        let rejectActiveSignal:
          | ((reason: LiveSmokeTerminalSignalError | LiveSmokeRunnerDeadlineError) => void)
          | undefined;
        const activeSignalPromise = new Promise<never>((_resolve, reject) => {
          rejectActiveSignal = reject;
        });
        void activeSignalPromise.catch(() => undefined);
        let activeSignalError:
          LiveSmokeTerminalSignalError | LiveSmokeRunnerDeadlineError | undefined;
        let providerTimeout: ReturnType<typeof setTimeout> | undefined;
        let runnerDeadlineTimeout: ReturnType<typeof setTimeout> | undefined;
        let providerReturned = false;
        let mappedForDurableWinner: MappedCalleTerminalOutput | undefined;
        let authorizationConsumed = false;
        const latchActiveSignal = (
          error: LiveSmokeTerminalSignalError | LiveSmokeRunnerDeadlineError,
        ): void => {
          if (activeSignalError !== undefined) return;
          activeSignalError = error;
          abortController.abort();
          rejectActiveSignal?.(error);
        };
        const awaitActive = async <T>(operation: () => Promise<T>): Promise<T> => {
          if (activeSignalError !== undefined) throw activeSignalError;
          const operationPromise = operation();
          const result = await Promise.race([operationPromise, activeSignalPromise]);
          if (activeSignalError !== undefined) throw activeSignalError;
          return result;
        };
        const persistFailure = async (
          reason: LiveSmokeFailureReason,
          telemetryReason: SafeLiveSmokeTelemetryReason = reason === "provider_timeout"
            ? "provider_timeout"
            : "provider_failed",
          createResponseDiagnostics?: SafeProviderCreateResponseDiagnostics,
          terminalPersistenceAlreadyAttempted = false,
        ): Promise<LiveSmokeResult> => {
          let terminalPersistenceOwnedByCoordinator = false;
          try {
            terminalPersistenceOwnedByCoordinator =
              input.evidenceCoordinator?.settle?.({ operationId: execution.operationId }) ===
              "coordinator";
          } catch {
            // Settling is best effort; the safe terminal result still owns retry behavior.
          }
          let effectiveReason: LiveSmokeFailureReason = input.dtmfSafetyStop!.isBlocked()
            ? "dtmf_safety_stop"
            : reason;
          let effectiveTelemetryReason: SafeLiveSmokeTelemetryReason =
            effectiveReason === "dtmf_safety_stop" ? "provider_failed" : telemetryReason;
          const requestedTerminalOutcome =
            effectiveReason === "evidence_timestamp_invalid" ||
            effectiveReason === "application_persistence_failed"
              ? ("evidence_unavailable" as const)
              : effectiveReason === "provider_failed" || effectiveReason === "provider_timeout"
                ? ("provider_failed" as const)
                : ("blocked" as const);
          let terminalResult: void | LiveSmokeTerminalPersistenceResult = undefined;
          if (!terminalPersistenceAlreadyAttempted && !terminalPersistenceOwnedByCoordinator) {
            try {
              terminalResult = await input.terminalAttempts!.recordFailure({
                operationId: execution.operationId,
                outcome: requestedTerminalOutcome,
                retryable: false,
              });
            } catch {
              if (effectiveReason !== "dtmf_safety_stop" && !input.dtmfSafetyStop!.isBlocked()) {
                effectiveReason = "application_persistence_failed";
                effectiveTelemetryReason = "application_persistence_failed";
              } else {
                effectiveReason = "dtmf_safety_stop";
                effectiveTelemetryReason = "provider_failed";
              }
            }
          }
          if (
            terminalResult?.terminalOutcome === "observation_recorded" &&
            mappedForDurableWinner?.result.kind === "evidence"
          ) {
            record("completed");
            return Object.freeze({
              status: "completed",
              authorizationConsumed: true,
              mapped: mappedForDurableWinner,
            });
          }
          if (
            terminalResult !== undefined &&
            terminalResult.terminalOutcome !== "observation_recorded" &&
            terminalResult.terminalOutcome !== requestedTerminalOutcome
          ) {
            effectiveReason = failureReasonForTerminalOutcome(terminalResult.terminalOutcome);
            effectiveTelemetryReason =
              effectiveReason === "application_persistence_failed"
                ? "application_persistence_failed"
                : "provider_failed";
          }
          try {
            await input.evidenceCoordinator?.completeTerminalPersistence?.({
              operationId: execution.operationId,
            });
          } catch {
            // Terminal cleanup cannot change the safe, nonretryable runner result.
          }
          record("failed", effectiveTelemetryReason, createResponseDiagnostics);
          return Object.freeze({
            status: "failed",
            reason: effectiveReason,
            retryable: false,
            authorizationConsumed: true,
          });
        };
        const persistPostProviderApplicationFailure = async (
          reason: LiveSmokeResultPersistenceFailureReason = "application_persistence_failed",
          terminalPersistenceAlreadyAttempted = false,
        ): Promise<LiveSmokeResult> =>
          input.dtmfSafetyStop!.isBlocked()
            ? await persistFailure(
                "dtmf_safety_stop",
                "provider_failed",
                undefined,
                terminalPersistenceAlreadyAttempted,
              )
            : await persistFailure(reason, reason, undefined, terminalPersistenceAlreadyAttempted);
        const persistActiveSignal = async (): Promise<LiveSmokeResult> => {
          if (input.dtmfSafetyStop!.isBlocked()) {
            return await persistFailure("dtmf_safety_stop");
          }
          if (activeSignalError instanceof LiveSmokeRunnerDeadlineError) {
            return activeSignalError.reason === "application_persistence_failed"
              ? await persistPostProviderApplicationFailure()
              : await persistFailure("provider_timeout", "provider_timeout");
          }
          return activeSignalError?.reason === "persistence_unavailable"
            ? await persistPostProviderApplicationFailure()
            : await persistFailure("provider_failed");
        };
        try {
          input.killSwitch?.assertDispatchAllowed();
          input.runGate?.assertOpen();
          input.dtmfSafetyStop!.assertDispatchAllowed();
          let reservation: Awaited<ReturnType<RunAuthorizationReservationBoundary["reserve"]>>;
          try {
            reservation = await authorizationBoundary.reserve({
              token: execution.runAuthorization,
              runId: execution.operationId,
              scenarioId: execution.scenarioId,
              scenarioRevision: execution.scenarioRevision,
              audience: config.authorizationAudience,
              endpointAlias: config.endpointAlias,
              ...(execution.predecessorOperationId === undefined
                ? {}
                : { predecessorOperationId: execution.predecessorOperationId }),
            });
          } catch {
            record("blocked", "authorization_store_unavailable");
            return blocked("authorization_store_unavailable");
          }
          if (reservation !== "reserved" && reservation !== "replayed") {
            record("blocked", "authorization_rejected");
            return await terminalBlocked(execution.operationId, "authorization_rejected");
          }
          authorizationConsumed = true;
          record("authorization_reserved");
          runnerDeadlineTimeout = setTimeout(
            () =>
              latchActiveSignal(
                new LiveSmokeRunnerDeadlineError(
                  providerReturned ? "application_persistence_failed" : "provider_timeout",
                ),
              ),
            runnerTimeoutMs,
          );
          const terminalPersistenceOwner =
            input.evidenceCoordinator?.claimTerminalPersistence?.({
              operationId: execution.operationId,
            }) ?? "runner";
          if (input.evidenceCoordinator?.onTerminal !== undefined) {
            unsubscribeEvidenceTerminal = input.evidenceCoordinator.onTerminal(
              { operationId: execution.operationId },
              (reason) => {
                latchActiveSignal(new LiveSmokeTerminalSignalError(reason));
              },
            );
          }
          if (terminalPersistenceOwner === "coordinator") {
            return await persistActiveSignal();
          }
          input.evidenceCoordinator?.begin?.({
            operationId: execution.operationId,
            deadlineMs: config.timeoutMs!,
            terminalDeadlineMs: evidenceTimeoutMs,
          });
          try {
            input.killSwitch?.assertDispatchAllowed();
            input.runGate?.assertOpen();
            input.dtmfSafetyStop!.assertDispatchAllowed();
          } catch (error: unknown) {
            return await persistFailure(
              error instanceof Error && /DTMF/u.test(error.message)
                ? "dtmf_safety_stop"
                : "safety_blocked",
            );
          }
          if (
            dispatchedOperationId !== undefined &&
            dispatchedOperationId !== execution.operationId
          ) {
            return await persistFailure("safety_blocked");
          }
          dispatchedOperationId = execution.operationId;
          const dispatchAttempt = await awaitActive(
            async () =>
              await input.dispatchAttempts!.claim({
                operationId: execution.operationId,
              }),
          );
          const reconcileExisting = dispatchAttempt.outcome === "reconcile";
          if (reconcileExisting && input.reconcile === undefined) {
            return await persistFailure("safety_blocked");
          }
          const establishedProvider = providerCompletions.get(execution.operationId);
          if (
            establishedProvider !== undefined &&
            (establishedProvider.fingerprint !== fingerprint ||
              establishedProvider.providerDispatchIdentity !==
                dispatchAttempt.providerDispatchIdentity)
          ) {
            return await persistFailure("safety_blocked");
          }
          let providerOutput: unknown;
          if (establishedProvider === undefined) {
            if (!reconcileExisting) record("dispatch_attempted");
            const timeoutPromise = new Promise<never>((_resolve, reject) => {
              providerTimeout = setTimeout(() => {
                abortController.abort();
                reject(new Error("provider_timeout"));
              }, providerOperationTimeoutMs);
            });
            const providerRequest = Object.freeze({
              apiToken: secrets.calleApiToken,
              targetAddress: secrets.targetAddress,
              endpointAlias: config.endpointAlias,
              operationId: execution.operationId,
              providerDispatchIdentity: dispatchAttempt.providerDispatchIdentity,
              scenarioId: execution.scenarioId,
              scenarioRevision: execution.scenarioRevision,
              timeoutMs: providerOperationTimeoutMs,
              retryLimit: 0 as const,
              dtmfPolicy: Object.freeze({
                kind: "forbidden" as const,
                allowlist: Object.freeze([]),
              }),
              traceContext: trace.context,
              signal: abortController.signal,
            });
            const providerOperation = async (): Promise<unknown> =>
              await (reconcileExisting
                ? input.reconcile!(providerRequest)
                : input.dispatch(providerRequest));
            try {
              providerOutput = await awaitActive(
                async () =>
                  await Promise.race([
                    runWithSafeTelemetrySpan<unknown>(
                      observability.runProviderSpan,
                      providerOperation,
                    ),
                    timeoutPromise,
                  ]),
              );
            } catch (error: unknown) {
              if (
                error instanceof LiveSmokeTerminalSignalError ||
                error instanceof LiveSmokeRunnerDeadlineError
              ) {
                throw error;
              }
              if (!reconcileExisting) {
                try {
                  await awaitActive(async () => {
                    await input.dispatchAttempts!.recordDisposition?.({
                      operationId: execution.operationId,
                      outcome: "provider_failed",
                    });
                  });
                } catch (dispositionError: unknown) {
                  if (dispositionError instanceof LiveSmokeTerminalSignalError) {
                    throw dispositionError;
                  }
                  // Preserve the provider transport failure; disposition persistence is separate.
                }
              }
              throw error;
            } finally {
              if (providerTimeout !== undefined) {
                clearTimeout(providerTimeout);
                providerTimeout = undefined;
              }
            }
            providerReturned = true;
            providerCompletions.set(
              execution.operationId,
              Object.freeze({
                fingerprint,
                providerDispatchIdentity: dispatchAttempt.providerDispatchIdentity,
                output: providerOutput,
              }),
            );
            if (!reconcileExisting) {
              try {
                await awaitActive(async () => {
                  await input.dispatchAttempts!.recordDisposition?.({
                    operationId: execution.operationId,
                    outcome: "provider_returned",
                  });
                });
              } catch (error: unknown) {
                if (error instanceof LiveSmokeTerminalSignalError) throw error;
                return await persistPostProviderApplicationFailure();
              }
            }
          } else {
            providerOutput = establishedProvider.output;
            providerReturned = true;
          }
          if (input.evidenceCoordinator !== undefined) {
            try {
              await awaitActive(
                async () =>
                  await input.evidenceCoordinator!.recordCalleTerminal({
                    operationId: execution.operationId,
                    providerOutput,
                    traceId: trace.traceId,
                    providerCallDigest: createHash("sha256")
                      .update(dispatchAttempt.providerDispatchIdentity, "utf8")
                      .digest("hex"),
                  }),
              );
            } catch (error: unknown) {
              if (error instanceof LiveSmokeTerminalSignalError) throw error;
              if (error instanceof LiveSmokeEvidencePersistenceError) {
                return await persistPostProviderApplicationFailure();
              }
              throw error;
            }
            let readiness: Awaited<ReturnType<LiveSmokeRunnerEvidenceCoordinator["assertReady"]>>;
            try {
              readiness = await awaitActive(
                async () =>
                  await input.evidenceCoordinator!.assertReady({
                    operationId: execution.operationId,
                  }),
              );
            } catch (error: unknown) {
              if (error instanceof LiveSmokeTerminalSignalError) throw error;
              if (error instanceof LiveSmokeEvidencePersistenceError) {
                return await persistPostProviderApplicationFailure();
              }
              throw error;
            }
            if (readiness.outcome !== "ready") {
              return readiness.reason === "persistence_unavailable"
                ? await persistPostProviderApplicationFailure()
                : readiness.reason === "provider_failed"
                  ? await persistFailure("provider_failed")
                  : await persistFailure("safety_blocked");
            }
          }
          try {
            input.killSwitch?.assertDispatchAllowed();
            input.runGate?.assertOpen();
            input.dtmfSafetyStop!.assertDispatchAllowed();
          } catch (error: unknown) {
            return await persistFailure(
              error instanceof Error && /DTMF/u.test(error.message)
                ? "dtmf_safety_stop"
                : "safety_blocked",
            );
          }
          const mapped = await awaitActive(
            async () =>
              await mapCalleTerminalOutput(
                providerOutput,
                {
                  operationId: execution.operationId,
                  adapterVersionId: dispatchAttempt.adapterVersionId,
                  simulationRunId: execution.operationId,
                },
                {
                  reviewedConfidenceTokens: input.reviewedConfidenceTokens!,
                  persistAdmission: async (admission) => {
                    try {
                      await awaitActive(
                        async () => await evidencePersistence.persistAdmission(admission),
                      );
                    } catch (error: unknown) {
                      if (
                        error instanceof LiveSmokeTerminalSignalError ||
                        error instanceof LiveSmokeRunnerDeadlineError
                      ) {
                        throw error;
                      }
                      throw new LiveSmokeResultPersistenceError("application_persistence_failed");
                    }
                    record("evidence_persisted");
                  },
                },
              ),
          );
          mappedForDurableWinner = mapped;
          try {
            input.killSwitch?.assertDispatchAllowed();
            input.dtmfSafetyStop!.assertDispatchAllowed();
          } catch (error: unknown) {
            return await persistFailure(
              error instanceof Error && /DTMF/u.test(error.message)
                ? "dtmf_safety_stop"
                : "safety_blocked",
            );
          }
          let terminalFailureCommitted = false;
          if (input.resultPersistence !== undefined) {
            let disposition: Awaited<ReturnType<LiveSmokeResultPersistence["commitAtomically"]>>;
            try {
              // This promise resolves only after the persistence adapter's transaction has either
              // committed or rolled back. Signals close the final barrier but never abandon COMMIT.
              disposition = await input.resultPersistence.commitAtomically(
                { operationId: execution.operationId, result: mapped.result },
                () => !input.dtmfSafetyStop!.isBlocked() && activeSignalError === undefined,
              );
            } catch (error: unknown) {
              if (activeSignalError !== undefined) return await persistActiveSignal();
              const reason = safeResultPersistenceTelemetryReason(error);
              return await persistPostProviderApplicationFailure(reason);
            }
            if (disposition.disposition === "blocked") {
              return activeSignalError !== undefined
                ? await persistActiveSignal()
                : input.dtmfSafetyStop!.isBlocked()
                  ? await persistFailure("dtmf_safety_stop")
                  : await persistPostProviderApplicationFailure();
            }
            if (disposition.winner === "terminal_failure") {
              terminalFailureCommitted = true;
              if (
                mapped.result.kind !== "terminal_failure" ||
                mapped.result.outcome !== disposition.terminalOutcome
              ) {
                const winnerReason = failureReasonForTerminalOutcome(disposition.terminalOutcome);
                return await persistFailure(
                  winnerReason,
                  winnerReason === "application_persistence_failed"
                    ? "application_persistence_failed"
                    : "provider_failed",
                  undefined,
                  true,
                );
              }
            } else if (mapped.result.kind !== "evidence") {
              return await persistPostProviderApplicationFailure();
            }
          } else if (activeSignalError !== undefined) {
            return await persistActiveSignal();
          }
          if (mapped.result.kind === "terminal_failure" && !terminalFailureCommitted) {
            try {
              const terminalResult = await input.terminalAttempts!.recordFailure({
                operationId: execution.operationId,
                outcome: mapped.result.outcome,
                retryable: false,
              });
              if (terminalResult?.terminalOutcome === "observation_recorded") {
                return await persistPostProviderApplicationFailure(
                  "application_persistence_failed",
                  true,
                );
              }
            } catch {
              return await persistPostProviderApplicationFailure(
                "application_persistence_failed",
                true,
              );
            }
          }
          try {
            input.evidenceCoordinator?.settle?.({ operationId: execution.operationId });
          } catch {
            // Settlement only cancels coordinator bookkeeping after the durable winner is known.
          }
          record("completed");
          return Object.freeze({ status: "completed", authorizationConsumed: true, mapped });
        } catch (error: unknown) {
          if (!authorizationConsumed) {
            const reason =
              error instanceof Error && /DTMF/u.test(error.message)
                ? "kill_switch_blocked"
                : "kill_switch_blocked";
            record("blocked", reason);
            return await terminalBlocked(execution.operationId, reason);
          }
          if (error instanceof LiveSmokeResultPersistenceError) {
            return await persistPostProviderApplicationFailure(error.reason);
          }
          if (error instanceof LiveSmokeTerminalSignalError) {
            return error.reason === "persistence_unavailable"
              ? await persistPostProviderApplicationFailure()
              : await persistFailure("provider_failed");
          }
          if (error instanceof LiveSmokeRunnerDeadlineError) {
            return await persistActiveSignal();
          }
          const failureReason = input.dtmfSafetyStop!.isBlocked()
            ? "dtmf_safety_stop"
            : error instanceof Error && error.message === "provider_timeout"
              ? "provider_timeout"
              : "provider_failed";
          const telemetryReason = safeProviderTelemetryReason(error);
          return await persistFailure(
            failureReason,
            telemetryReason,
            telemetryReason === "provider_create_response_invalid"
              ? safeProviderCreateResponseDiagnostics(error)
              : undefined,
          );
        } finally {
          if (providerTimeout !== undefined) clearTimeout(providerTimeout);
          if (runnerDeadlineTimeout !== undefined) clearTimeout(runnerDeadlineTimeout);
          unsubscribeEvidenceTerminal?.();
          unsubscribeDtmf?.();
          abortController.abort();
          activeOperationId = undefined;
        }
      };
      const operation = runWithSafeTelemetrySpan<LiveSmokeResult>(
        observability.runJobSpan,
        coreOperation,
      );
      completedRuns.set(execution.operationId, Object.freeze({ fingerprint, operation }));
      void operation.then(
        (result) => {
          if ("authorizationConsumed" in result && result.authorizationConsumed) {
            completedRuns.set(
              execution.operationId,
              Object.freeze({ fingerprint, operation: Promise.resolve(result) }),
            );
          } else {
            completedRuns.delete(execution.operationId);
          }
        },
        () => {
          if (completedRuns.get(execution.operationId)?.operation === operation) {
            completedRuns.delete(execution.operationId);
          }
        },
      );
      return operation;
    },
  });
}
