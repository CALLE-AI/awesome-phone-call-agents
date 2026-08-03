/**
 * Drill orchestration — places calls, evaluates results, advances state machine.
 *
 * Safety rules (conservative, no second call when uncertain):
 * - Accepted provider call IDs are durably checkpointed before the first poll.
 * - Timeout / unknown / malformed / conflicting / incomplete evidence stop without backup.
 * - Reconciliation state retains the accepted ID; never auto-retry after interrupt.
 * - Clear active-call checkpoint only after a terminal result is safely evaluated.
 */

import { CalleApiError, CalleWaitTimeout, type CallePort } from "./calle.js";
import { excerptTranscript, maskPhone, redactEvidenceLine } from "./masking.js";
import {
  acceptedStructuredFromSnapshot,
  classifyFailedSnapshot,
  isCompletedSnapshotAmbiguous,
  structuredFromSnapshot,
} from "./structured-trust.js";
import { buildRecommendations, buildScores, buildSummary } from "./scoring.js";
import { buildMetadata, buildTask, idempotencyKey, resultSchema } from "./script.js";
import {
  applyTerminalStatus,
  classifyPrimaryOutcome,
  contactForRole,
  nextStatusAfterBackupEvaluation,
  nextStatusAfterPrimaryEvaluation,
  recordAttempt,
  transitionToCalling,
  transitionToEvaluating,
  transitionToLaunching,
} from "./state-machine.js";
import type {
  AfterActionReport,
  CallAttemptRecord,
  CallOutcomeKind,
  CallSnapshot,
  ContactRole,
  DrillEvent,
  DrillRecord,
  ReconciliationReason,
  StructuredDrillResult,
} from "./types.js";
import { isTerminalCallStatus } from "./types.js";

export class OrchestrationCancelled extends Error {
  readonly code = "orchestration_cancelled";
}

export interface OrchestratorContext {
  signal: AbortSignal;
  isCancelled: () => boolean;
}

/** Local result-monitoring window per placed call (not telephony ring duration). */
export const DEFAULT_PER_CALL_RESULT_MONITORING_TIMEOUT_MS = 1_800_000;

export function resolvePerCallTimeoutMs(perCallTimeoutMs?: number): number {
  return perCallTimeoutMs ?? DEFAULT_PER_CALL_RESULT_MONITORING_TIMEOUT_MS;
}

export interface OrchestratorOptions {
  port: CallePort;
  pollIntervalMs?: number;
  perCallTimeoutMs?: number;
  onUpdate?: (drill: DrillRecord) => void;
  onActiveCall?: (callId: string | null) => void;
  /**
   * Invoked synchronously after createCall accepts an ID and before the first getCall/poll.
   * Hosts must persist the checkpoint durably inside this callback.
   */
  onProviderCallAccepted?: (info: { callId: string; role: ContactRole }) => void;
  context?: OrchestratorContext;
}

interface PlaceCallResult {
  snapshot: CallSnapshot | null;
  error: CallOutcomeKind | null;
  ambiguous: boolean;
  providerCallId: string | null;
  reconciliationReason: ReconciliationReason | null;
}

function event(level: DrillEvent["level"], message: string, detail?: string): DrillEvent {
  return { at: new Date().toISOString(), level, message, detail };
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new OrchestrationCancelled());
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new OrchestrationCancelled());
      },
      { once: true },
    );
  });
}

function outcomeFromSnapshot(
  snapshot: CallSnapshot,
  parsed: StructuredDrillResult | null,
  trusted: boolean,
): { outcome: CallOutcomeKind; ambiguous: boolean; reason: ReconciliationReason | null } {
  const status = snapshot.status.toLowerCase();
  if (status === "canceled") {
    return { outcome: "cancelled", ambiguous: false, reason: null };
  }
  if (status === "failed") {
    const failed = classifyFailedSnapshot(snapshot);
    return {
      outcome: failed.outcome,
      ambiguous: failed.ambiguous,
      reason: failed.reason,
    };
  }
  if (!isTerminalCallStatus(snapshot.status)) {
    return { outcome: "unknown", ambiguous: true, reason: "unknown" };
  }
  if (!trusted) {
    return { outcome: "unknown", ambiguous: true, reason: "untrusted_completed" };
  }
  if (parsed === null) {
    return { outcome: "malformed_result", ambiguous: true, reason: "malformed_result" };
  }
  if (parsed.opt_out) {
    return { outcome: "opt_out", ambiguous: false, reason: null };
  }
  if (!parsed.reached_live_person) {
    return { outcome: "no_answer", ambiguous: false, reason: null };
  }
  if (!parsed.can_take_ownership) {
    return { outcome: "refused_ownership", ambiguous: false, reason: null };
  }
  return { outcome: "success", ambiguous: false, reason: null };
}

function attemptFromSnapshot(
  role: ContactRole,
  snapshot: CallSnapshot,
  outcome: CallOutcomeKind,
  ambiguous: boolean,
): CallAttemptRecord {
  const parsed = acceptedStructuredFromSnapshot(snapshot);
  const attempt = snapshot.recipients[0]?.attempts[0];
  const turns = attempt?.transcriptTurns ?? [];
  const fromEvidence = snapshot.evidence?.map(redactEvidenceLine) ?? [];
  const fromTranscript = excerptTranscript(turns).map(redactEvidenceLine);
  const evidenceExcerpt = fromTranscript.length > 0 ? fromTranscript : fromEvidence;
  return {
    role,
    callId: snapshot.id,
    phoneMasked: maskPhone(attempt?.phone ?? snapshot.recipients[0]?.phones[0] ?? ""),
    status: snapshot.status,
    outcome,
    structuredResult: parsed,
    evidenceExcerpt,
    failureCode: snapshot.failureCode ?? attempt?.failureCode ?? null,
    ambiguous,
    startedAt: attempt?.startedAt ?? snapshot.createdAt,
    completedAt: attempt?.completedAt ?? snapshot.completedAt,
  };
}

function finalizeReport(drill: DrillRecord): AfterActionReport {
  const scores = buildScores(drill, drill.attempts);
  return {
    generatedAt: new Date().toISOString(),
    scenario: drill.scenario,
    mode: drill.mode,
    status: drill.status,
    attempts: drill.attempts,
    scores,
    summary: buildSummary(drill, drill.attempts),
    recommendations: buildRecommendations(drill, drill.attempts),
    evidence: drill.attempts.flatMap((attempt) => attempt.evidenceExcerpt).slice(0, 6),
  };
}

async function cancellableWaitForResult(
  port: CallePort,
  callId: string,
  options: { timeoutMs: number; intervalMs: number },
  ctx?: OrchestratorContext,
): Promise<CallSnapshot> {
  const started = Date.now();
  while (Date.now() - started < options.timeoutMs) {
    if (ctx?.signal.aborted || ctx?.isCancelled()) {
      if (port.cancelCall) {
        await port.cancelCall(callId);
      }
      throw new OrchestrationCancelled();
    }
    const snapshot = await port.getCall(callId);
    if (isTerminalCallStatus(snapshot.status)) {
      return snapshot;
    }
    await sleep(options.intervalMs, ctx?.signal);
  }
  throw new CalleWaitTimeout("wait_for_result_timeout");
}

async function placeCall(
  drill: DrillRecord,
  role: ContactRole,
  options: OrchestratorOptions,
): Promise<PlaceCallResult> {
  const ctx = options.context;
  if (ctx?.signal.aborted || ctx?.isCancelled()) {
    return { snapshot: null, error: "cancelled", ambiguous: false, providerCallId: null, reconciliationReason: null };
  }
  const contact = contactForRole(drill, role);
  if (!contact?.phone) {
    return { snapshot: null, error: "api_error", ambiguous: false, providerCallId: null, reconciliationReason: null };
  }
  const input = {
    task: buildTask(drill, role),
    recipients: [{ phones: [contact.phone], region: "US", locale: "en-US" }],
    resultSchema: resultSchema(),
    metadata: buildMetadata(drill, role),
  };
  const key = idempotencyKey(drill.id, role);
  let providerCallId: string | null = null;
  try {
    if (ctx?.signal.aborted || ctx?.isCancelled()) {
      return { snapshot: null, error: "cancelled", ambiguous: false, providerCallId: null, reconciliationReason: null };
    }
    const created = await options.port.createCall(input, key);
    providerCallId = created.id;
    options.onActiveCall?.(created.id);
    // Durable checkpoint MUST land before the first getCall/poll.
    options.onProviderCallAccepted?.({ callId: created.id, role });
    const snapshot = await cancellableWaitForResult(
      options.port,
      created.id,
      {
        timeoutMs: resolvePerCallTimeoutMs(options.perCallTimeoutMs),
        intervalMs: options.pollIntervalMs ?? 500,
      },
      ctx,
    );
    options.onActiveCall?.(null);
    const trusted = !isCompletedSnapshotAmbiguous(snapshot);
    const parsed = trusted ? structuredFromSnapshot(snapshot) : null;
    const classified = outcomeFromSnapshot(snapshot, parsed, trusted);
    return {
      snapshot,
      error: classified.outcome,
      ambiguous: classified.ambiguous,
      providerCallId,
      reconciliationReason: classified.reason,
    };
  } catch (error) {
    options.onActiveCall?.(null);
    if (error instanceof OrchestrationCancelled) {
      return {
        snapshot: null,
        error: "cancelled",
        ambiguous: providerCallId !== null,
        providerCallId,
        reconciliationReason: providerCallId !== null ? "cancelled_with_active_call" : null,
      };
    }
    if (error instanceof CalleWaitTimeout) {
      return {
        snapshot: null,
        error: "timeout",
        ambiguous: true,
        providerCallId,
        reconciliationReason: "timeout",
      };
    }
    if (error instanceof CalleApiError) {
      return {
        snapshot: null,
        error: error.ambiguous ? "unknown" : "api_error",
        ambiguous: error.ambiguous,
        providerCallId,
        reconciliationReason: error.ambiguous ? "provider_error" : null,
      };
    }
    // Crash-like / unexpected polling exceptions — retain ID, require recon, no backup.
    return {
      snapshot: null,
      error: "unknown",
      ambiguous: true,
      providerCallId,
      reconciliationReason: providerCallId !== null ? "interrupted" : "unknown",
    };
  }
}

function reconciliationDetail(providerCallId: string | null): string | undefined {
  return providerCallId ? `providerCallId=${providerCallId}` : undefined;
}

function clearedCheckpoint(): Pick<
  DrillRecord,
  "activeProviderCallId" | "activeProviderCallRole" | "reconciliationRequired" | "reconciliationReason"
> {
  return {
    activeProviderCallId: null,
    activeProviderCallRole: null,
    reconciliationRequired: false,
    reconciliationReason: null,
  };
}

function retainedReconciliation(
  providerCallId: string | null,
  role: ContactRole,
  reason: ReconciliationReason | null,
): Pick<
  DrillRecord,
  "activeProviderCallId" | "activeProviderCallRole" | "reconciliationRequired" | "reconciliationReason"
> {
  return {
    activeProviderCallId: providerCallId,
    activeProviderCallRole: providerCallId ? role : null,
    reconciliationRequired: true,
    reconciliationReason: reason ?? "unknown",
  };
}

export async function runDrill(drill: DrillRecord, options: OrchestratorOptions): Promise<DrillRecord> {
  let current = drill;
  const push = (update: Partial<DrillRecord>, evt: DrillEvent): DrillRecord => {
    current = { ...current, ...update, events: [...current.events, evt], updatedAt: new Date().toISOString() };
    options.onUpdate?.(current);
    return current;
  };

  const cancelled = (): boolean => options.context?.isCancelled() === true || options.context?.signal.aborted === true;

  if (current.launchClaim === null) {
    throw new Error("Launch claim missing.");
  }

  current = push(transitionToLaunching(current, current.launchClaim), event("info", "Launch claim accepted."));
  if (cancelled()) {
    return push(
      applyTerminalStatus({ ...current, report: finalizeReport(current) }, "cancelled"),
      event("warn", "Cancelled before first call."),
    );
  }

  const placeWithCheckpoint = async (role: ContactRole): Promise<PlaceCallResult> => {
    return placeCall(current, role, {
      ...options,
      onProviderCallAccepted: (info) => {
        // Synchronous durable checkpoint via onUpdate before first poll.
        current = push(
          {
            activeProviderCallId: info.callId,
            activeProviderCallRole: info.role,
            reconciliationRequired: false,
            reconciliationReason: null,
          },
          event(
            "info",
            "Provider call accepted; durable checkpoint recorded before result monitoring.",
            reconciliationDetail(info.callId),
          ),
        );
        options.onProviderCallAccepted?.(info);
      },
    });
  };

  const applyPlaceOutcome = (
    role: ContactRole,
    result: PlaceCallResult,
    level: DrillEvent["level"],
    message: string,
  ): void => {
    if (result.snapshot) {
      const parsed = structuredFromSnapshot(result.snapshot);
      const trusted = !result.ambiguous && !isCompletedSnapshotAmbiguous(result.snapshot);
      const classified =
        role === "primary"
          ? classifyPrimaryOutcome(result.error ?? "unknown", trusted ? parsed : null)
          : (result.error ?? "unknown");
      const attempt = attemptFromSnapshot(role, result.snapshot, classified, result.ambiguous);
      if (result.ambiguous) {
        current = push(
          {
            ...recordAttempt(current, attempt),
            ...retainedReconciliation(result.providerCallId, role, result.reconciliationReason),
          },
          event(level, message),
        );
        if (result.providerCallId) {
          current = push(
            current,
            event(
              "warn",
              "Reconcile the retained provider call ID with CALL-E before placing any new call.",
              reconciliationDetail(result.providerCallId),
            ),
          );
        }
      } else {
        current = push(
          {
            ...recordAttempt(current, attempt),
            ...clearedCheckpoint(),
          },
          event(level, message),
        );
      }
      return;
    }

    const attempt: CallAttemptRecord = {
      role,
      callId: result.providerCallId,
      phoneMasked: role === "primary" ? current.primary.phoneMasked : (current.backup?.phoneMasked ?? "****"),
      status: "failed",
      outcome: result.error ?? "api_error",
      structuredResult: null,
      evidenceExcerpt: [],
      failureCode: result.error,
      ambiguous: result.ambiguous,
      startedAt: null,
      completedAt: null,
    };
    if (result.ambiguous || result.error === "timeout" || result.error === "unknown") {
      current = push(
        {
          ...recordAttempt(current, attempt),
          ...retainedReconciliation(
            result.providerCallId,
            role,
            result.reconciliationReason ??
              (result.error === "timeout" ? "timeout" : result.error === "unknown" ? "unknown" : "provider_error"),
          ),
        },
        event(level === "info" ? "error" : level, message),
      );
      if (result.providerCallId) {
        current = push(
          current,
          event(
            "warn",
            "Reconcile the retained provider call ID with CALL-E before placing any new call.",
            reconciliationDetail(result.providerCallId),
          ),
        );
      }
    } else if (result.error === "cancelled" && result.providerCallId) {
      current = push(
        {
          ...recordAttempt(current, attempt),
          ...retainedReconciliation(result.providerCallId, role, "cancelled_with_active_call"),
        },
        event("warn", message),
      );
    } else {
      current = push(
        {
          ...recordAttempt(current, attempt),
          ...clearedCheckpoint(),
        },
        event(level === "info" ? "error" : level, message),
      );
    }
  };

  current = push(transitionToCalling(current, "primary"), event("info", "Calling primary role."));
  const primaryResult = await placeWithCheckpoint("primary");
  if (primaryResult.error === "cancelled" || cancelled()) {
    const withRecon =
      primaryResult.providerCallId !== null
        ? retainedReconciliation(primaryResult.providerCallId, "primary", "cancelled_with_active_call")
        : {};
    return push(
      applyTerminalStatus({ ...current, ...withRecon, report: finalizeReport({ ...current, ...withRecon }) }, "cancelled"),
      event("warn", "Cancelled during primary call wait."),
    );
  }
  applyPlaceOutcome(
    "primary",
    primaryResult,
    primaryResult.snapshot ? "info" : "error",
    primaryResult.snapshot
      ? `Primary attempt finished: ${primaryResult.error ?? "unknown"}.`
      : `Primary attempt failed: ${primaryResult.error ?? "api_error"}.`,
  );

  current = push(transitionToEvaluating(current, "primary"), event("info", "Evaluating primary result."));
  const primaryOutcome = current.attempts.at(-1)?.outcome ?? "unknown";
  let nextStatus = nextStatusAfterPrimaryEvaluation(current, primaryOutcome);

  if (nextStatus === "calling_backup") {
    if (cancelled()) {
      return push(
        applyTerminalStatus({ ...current, report: finalizeReport(current) }, "cancelled"),
        event("warn", "Cancelled before backup escalation."),
      );
    }
    current = push({ ...current, status: "calling_backup" }, event("info", "Escalating to approved backup."));
    const backupResult = await placeWithCheckpoint("backup");
    if (backupResult.error === "cancelled" || cancelled()) {
      const withRecon =
        backupResult.providerCallId !== null
          ? retainedReconciliation(backupResult.providerCallId, "backup", "cancelled_with_active_call")
          : {};
      return push(
        applyTerminalStatus({ ...current, ...withRecon, report: finalizeReport({ ...current, ...withRecon }) }, "cancelled"),
        event("warn", "Cancelled during backup call wait."),
      );
    }
    applyPlaceOutcome(
      "backup",
      backupResult,
      backupResult.snapshot ? "info" : "error",
      backupResult.snapshot
        ? `Backup attempt finished: ${backupResult.error ?? "unknown"}.`
        : `Backup attempt failed: ${backupResult.error ?? "api_error"}.`,
    );
    current = push(transitionToEvaluating(current, "backup"), event("info", "Evaluating backup result."));
    nextStatus = nextStatusAfterBackupEvaluation(current, current.attempts.at(-1)?.outcome ?? "unknown");
  }

  if (cancelled() && nextStatus !== "cancelled") {
    nextStatus = "cancelled";
  }

  // Terminal ambiguous always keeps recon state; never clear accepted IDs on stop-unknown paths.
  if (nextStatus === "ambiguous" && current.activeProviderCallId === null && primaryResult.providerCallId) {
    current = {
      ...current,
      ...retainedReconciliation(primaryResult.providerCallId, "primary", primaryResult.reconciliationReason ?? "unknown"),
    };
  }

  const report = finalizeReport({ ...current, status: nextStatus });
  return push(applyTerminalStatus({ ...current, report }, nextStatus), event("info", `Drill finished with status ${nextStatus}.`));
}

export function previewPlan(drill: DrillRecord): string[] {
  const lines = [
    `Scenario: ${drill.scenario}`,
    `Mode: ${drill.mode} (locked at creation — launch cannot change mode)`,
    `Primary: ${drill.primary.label} (${drill.primary.phoneMasked})`,
    `Max calls: ${drill.maxCalls}`,
  ];
  if (drill.backup) {
    lines.push(`Backup: ${drill.backup.label} (${drill.backup.phoneMasked})`);
  }
  if (drill.simulationPreset) {
    lines.push(`Simulation preset: ${drill.simulationPreset} (locked at creation)`);
  }
  if (drill.mode === "live") {
    lines.push("Live mode will place real outbound phone calls via CALL-E.");
  }
  lines.push("Structured result fields: reached_live_person, acknowledged_scenario, can_take_ownership, first_action, escalation_target, needs_help, follow_up_required, opt_out.");
  return lines;
}
