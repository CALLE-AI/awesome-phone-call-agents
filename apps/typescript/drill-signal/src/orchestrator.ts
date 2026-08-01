/**
 * Drill orchestration — places calls, evaluates results, advances state machine.
 */

import { CalleApiError, CalleWaitTimeout, type CallePort } from "./calle.js";
import { excerptTranscript, maskPhone, redactEvidenceLine } from "./masking.js";
import { parseStructuredResult } from "./schema.js";
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

export interface OrchestratorOptions {
  port: CallePort;
  pollIntervalMs?: number;
  perCallTimeoutMs?: number;
  onUpdate?: (drill: DrillRecord) => void;
  onActiveCall?: (callId: string | null) => void;
  context?: OrchestratorContext;
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

function structuredFromSnapshot(snapshot: CallSnapshot): StructuredDrillResult | null {
  const raw =
    snapshot.structuredResult ??
    snapshot.recipients[0]?.structuredResult ??
    snapshot.recipients[0]?.attempts[0]?.transcriptTurns.length
      ? snapshot.recipients[0]?.structuredResult
      : null;
  return parseStructuredResult(raw);
}

function outcomeFromSnapshot(snapshot: CallSnapshot, parsed: StructuredDrillResult | null): CallOutcomeKind {
  const status = snapshot.status.toLowerCase();
  if (status === "canceled") return "cancelled";
  if (status === "failed") {
    const code = snapshot.failureCode ?? snapshot.recipients[0]?.attempts[0]?.failureCode ?? "";
    if (code.includes("voicemail")) return "voicemail";
    if (code.includes("no_answer")) return "no_answer";
    return "unknown";
  }
  if (!isTerminalCallStatus(snapshot.status)) return "unknown";
  if (parsed === null) return "malformed_result";
  if (parsed.opt_out) return "opt_out";
  if (!parsed.reached_live_person) return "no_answer";
  if (!parsed.can_take_ownership) return "refused_ownership";
  return "success";
}

function attemptFromSnapshot(
  role: ContactRole,
  snapshot: CallSnapshot,
  outcome: CallOutcomeKind,
  ambiguous: boolean,
): CallAttemptRecord {
  const parsed = structuredFromSnapshot(snapshot);
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
): Promise<{ snapshot: CallSnapshot | null; error: CallOutcomeKind | null; ambiguous: boolean }> {
  const ctx = options.context;
  if (ctx?.signal.aborted || ctx?.isCancelled()) {
    return { snapshot: null, error: "cancelled", ambiguous: false };
  }
  const contact = contactForRole(drill, role);
  if (!contact?.phone) {
    return { snapshot: null, error: "api_error", ambiguous: false };
  }
  const input = {
    task: buildTask(drill, role),
    recipients: [{ phones: [contact.phone], region: "US", locale: "en-US" }],
    resultSchema: resultSchema(),
    metadata: buildMetadata(drill, role),
  };
  const key = idempotencyKey(drill.id, role);
  try {
    if (ctx?.signal.aborted || ctx?.isCancelled()) {
      return { snapshot: null, error: "cancelled", ambiguous: false };
    }
    const created = await options.port.createCall(input, key);
    options.onActiveCall?.(created.id);
    const snapshot = await cancellableWaitForResult(
      options.port,
      created.id,
      {
        timeoutMs: options.perCallTimeoutMs ?? 45_000,
        intervalMs: options.pollIntervalMs ?? 500,
      },
      ctx,
    );
    options.onActiveCall?.(null);
    const parsed = structuredFromSnapshot(snapshot);
    const outcome = outcomeFromSnapshot(snapshot, parsed);
    return { snapshot, error: outcome, ambiguous: false };
  } catch (error) {
    options.onActiveCall?.(null);
    if (error instanceof OrchestrationCancelled) {
      return { snapshot: null, error: "cancelled", ambiguous: false };
    }
    if (error instanceof CalleWaitTimeout) {
      return { snapshot: null, error: "timeout", ambiguous: true };
    }
    if (error instanceof CalleApiError) {
      return { snapshot: null, error: "api_error", ambiguous: error.ambiguous };
    }
    return { snapshot: null, error: "unknown", ambiguous: true };
  }
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
    return push(applyTerminalStatus({ ...current, report: finalizeReport(current) }, "cancelled"), event("warn", "Cancelled before first call."));
  }

  current = push(transitionToCalling(current, "primary"), event("info", "Calling primary role."));
  const primaryResult = await placeCall(current, "primary", options);
  if (primaryResult.error === "cancelled" || cancelled()) {
    return push(
      applyTerminalStatus({ ...current, report: finalizeReport(current) }, "cancelled"),
      event("warn", "Cancelled during primary call wait."),
    );
  }
  if (primaryResult.snapshot) {
    const parsed = structuredFromSnapshot(primaryResult.snapshot);
    const classified = classifyPrimaryOutcome(primaryResult.error ?? "unknown", parsed);
    const attempt = attemptFromSnapshot("primary", primaryResult.snapshot, classified, primaryResult.ambiguous);
    current = push(recordAttempt(current, attempt), event("info", `Primary attempt finished: ${classified}.`));
  } else {
    const attempt: CallAttemptRecord = {
      role: "primary",
      callId: null,
      phoneMasked: current.primary.phoneMasked,
      status: "failed",
      outcome: primaryResult.error ?? "api_error",
      structuredResult: null,
      evidenceExcerpt: [],
      failureCode: primaryResult.error,
      ambiguous: primaryResult.ambiguous,
      startedAt: null,
      completedAt: null,
    };
    current = push(recordAttempt(current, attempt), event("error", `Primary attempt failed: ${attempt.outcome}.`));
  }

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
    const backupResult = await placeCall(current, "backup", options);
    if (backupResult.error === "cancelled" || cancelled()) {
      return push(
        applyTerminalStatus({ ...current, report: finalizeReport(current) }, "cancelled"),
        event("warn", "Cancelled during backup call wait."),
      );
    }
    if (backupResult.snapshot) {
      const parsed = structuredFromSnapshot(backupResult.snapshot);
      const outcome = outcomeFromSnapshot(backupResult.snapshot, parsed);
      const attempt = attemptFromSnapshot("backup", backupResult.snapshot, outcome, backupResult.ambiguous);
      current = push(recordAttempt(current, attempt), event("info", `Backup attempt finished: ${outcome}.`));
    } else {
      const attempt: CallAttemptRecord = {
        role: "backup",
        callId: null,
        phoneMasked: current.backup?.phoneMasked ?? "****",
        status: "failed",
        outcome: backupResult.error ?? "api_error",
        structuredResult: null,
        evidenceExcerpt: [],
        failureCode: backupResult.error,
        ambiguous: backupResult.ambiguous,
        startedAt: null,
        completedAt: null,
      };
      current = push(recordAttempt(current, attempt), event("error", `Backup attempt failed: ${attempt.outcome}.`));
    }
    current = push(transitionToEvaluating(current, "backup"), event("info", "Evaluating backup result."));
    nextStatus = nextStatusAfterBackupEvaluation(current, current.attempts.at(-1)?.outcome ?? "unknown");
  }

  if (cancelled() && nextStatus !== "cancelled") {
    nextStatus = "cancelled";
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
