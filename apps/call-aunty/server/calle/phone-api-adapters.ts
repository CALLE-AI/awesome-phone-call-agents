import type { CalleAdapter, PlaceCallCommand, ProviderCallResult } from "./adapter";
import type { CallFailureCode, CallStructuredResult, CallWorkflowStatus } from "./types";
import { callStructuredResultSchema } from "./types";

export const ROUTINE_SUCCESS_RESULT: CallStructuredResult = callStructuredResultSchema.parse({
  reached: true,
  availability: "available",
  needsHumanFollowUp: true,
  appointmentConfirmed: null,
  preferredCallbackWindow: "afternoon",
  safetyEscalation: "none",
  summaryCode: "needs_chw",
  nextAction: "call_again",
  completionConfidence: 0.9,
});

export type ScriptedPlaceOutcome =
  | ProviderCallResult
  | { throwError: true; message?: string };

export type ScriptedPhoneApiOpts = {
  providerId: string;
  onPlace: (command: PlaceCallCommand) => ScriptedPlaceOutcome;
  onStatus?: (providerCallId: string) => ProviderCallResult;
  onCancel?: (providerCallId: string) => ProviderCallResult;
};

/** Deterministic phone-API double used for failover and contract tests. */
export class ScriptedPhoneApiAdapter implements CalleAdapter {
  readonly providerId: string;
  placeCalls = 0;
  statusCalls = 0;
  cancelCalls = 0;

  constructor(private readonly opts: ScriptedPhoneApiOpts) {
    this.providerId = opts.providerId;
  }

  async placeFollowUpCall(command: PlaceCallCommand): Promise<ProviderCallResult> {
    this.placeCalls += 1;
    const outcome = this.opts.onPlace(command);
    if ("throwError" in outcome) {
      throw new Error(outcome.message ?? `${this.providerId} unavailable`);
    }
    return { ...outcome, phoneProviderId: outcome.phoneProviderId ?? this.providerId };
  }

  async getStatus(providerCallId: string): Promise<ProviderCallResult> {
    this.statusCalls += 1;
    if (this.opts.onStatus) {
      const result = this.opts.onStatus(providerCallId);
      return { ...result, phoneProviderId: result.phoneProviderId ?? this.providerId };
    }
    return {
      providerCallId,
      status: "unknown",
      structuredResult: null,
      failureCode: "provider_unavailable",
      phoneProviderId: this.providerId,
    };
  }

  async cancel(providerCallId: string): Promise<ProviderCallResult> {
    this.cancelCalls += 1;
    if (this.opts.onCancel) {
      const result = this.opts.onCancel(providerCallId);
      return { ...result, phoneProviderId: result.phoneProviderId ?? this.providerId };
    }
    return {
      providerCallId,
      status: "cancelled",
      structuredResult: null,
      failureCode: "cancelled",
      phoneProviderId: this.providerId,
    };
  }
}

export type PollingPhoneApiOpts = {
  providerId: string;
  pollsUntilTerminal?: number;
  terminalStatus?: CallWorkflowStatus;
  terminalFailureCode?: CallFailureCode | null;
  terminalResult?: CallStructuredResult | null;
  /** If set, placeFollowUpCall fails without accepting a live run. */
  placeFailure?: CallFailureCode | "throw";
};

/**
 * Phone API that returns a run_id immediately and reaches a terminal status
 * only after subsequent getStatus polls — matching CALL-E run_call / get_call_run.
 */
export class PollingPhoneApiAdapter implements CalleAdapter {
  readonly providerId: string;
  placeCalls = 0;
  statusCalls = 0;
  cancelCalls = 0;

  private readonly pollsUntilTerminal: number;
  private readonly byIdempotency = new Map<string, string>();
  private readonly runs = new Map<
    string,
    { polls: number; cancelled: boolean; command: PlaceCallCommand }
  >();

  constructor(private readonly opts: PollingPhoneApiOpts) {
    this.providerId = opts.providerId;
    this.pollsUntilTerminal = opts.pollsUntilTerminal ?? 2;
  }

  private runId(workflowId: string) {
    return `${this.providerId}_run_${workflowId}`;
  }

  private terminal(command: PlaceCallCommand, providerCallId: string): ProviderCallResult {
    const status =
      this.opts.terminalStatus ?? (command.dryRun ? "dry_run_completed" : "completed");
    const result = this.opts.terminalResult ?? ROUTINE_SUCCESS_RESULT;
    return {
      providerCallId,
      status,
      structuredResult: this.opts.terminalFailureCode ? null : result,
      failureCode: this.opts.terminalFailureCode ?? null,
      taskCompleted: status === "completed" || status === "dry_run_completed",
      completionConfidence: result.completionConfidence ?? null,
      phoneProviderId: this.providerId,
    };
  }

  async placeFollowUpCall(command: PlaceCallCommand): Promise<ProviderCallResult> {
    this.placeCalls += 1;
    if (this.opts.placeFailure === "throw") {
      throw new Error(`${this.providerId} down`);
    }
    if (this.opts.placeFailure) {
      return {
        providerCallId: `failed_${command.workflowId}`,
        status: "failed",
        structuredResult: null,
        failureCode: this.opts.placeFailure,
        phoneProviderId: this.providerId,
      };
    }

    const existing = this.byIdempotency.get(command.idempotencyKey);
    if (existing) return this.snapshot(existing);

    const providerCallId = this.runId(command.workflowId);
    this.byIdempotency.set(command.idempotencyKey, providerCallId);
    this.runs.set(providerCallId, { polls: 0, cancelled: false, command });
    return {
      providerCallId,
      status: "in_progress",
      structuredResult: null,
      failureCode: null,
      phoneProviderId: this.providerId,
    };
  }

  async getStatus(providerCallId: string): Promise<ProviderCallResult> {
    this.statusCalls += 1;
    return this.snapshot(providerCallId, true);
  }

  async cancel(providerCallId: string): Promise<ProviderCallResult> {
    this.cancelCalls += 1;
    const run = this.runs.get(providerCallId);
    if (run) run.cancelled = true;
    return {
      providerCallId,
      status: "cancelled",
      structuredResult: null,
      failureCode: "cancelled",
      phoneProviderId: this.providerId,
    };
  }

  private snapshot(providerCallId: string, incrementPoll = false): ProviderCallResult {
    const run = this.runs.get(providerCallId);
    if (!run) {
      return {
        providerCallId,
        status: "unknown",
        structuredResult: null,
        failureCode: "provider_unavailable",
        phoneProviderId: this.providerId,
      };
    }
    if (incrementPoll) run.polls += 1;
    if (run.cancelled) {
      return {
        providerCallId,
        status: "cancelled",
        structuredResult: null,
        failureCode: "cancelled",
        phoneProviderId: this.providerId,
      };
    }
    if (run.polls >= this.pollsUntilTerminal) {
      return this.terminal(run.command, providerCallId);
    }
    return {
      providerCallId,
      status: "in_progress",
      structuredResult: null,
      failureCode: null,
      phoneProviderId: this.providerId,
    };
  }
}
