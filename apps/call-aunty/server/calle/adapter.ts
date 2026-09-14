import { CalleGateway } from "./client";
import { calleConfig } from "./config";
import {
  CALL_E_RESULT_JSON_SCHEMA,
  callStructuredResultSchema,
  type CallFailureCode,
  type CallPurpose,
  type CallStructuredResult,
  type CallTask,
  type CallWorkflowStatus,
} from "./types";
import { normalizeStructuredResult } from "./normalize-result";
import { buildFollowUpTask } from "./call-plan";
import { isDemoMode } from "./demo-mode";
import { FakeCalleRuntime, type DemoScenarioId } from "./fake-runtime";
import { CalleError, toCallFailureCode } from "./errors";
import { createFailoverCalleAdapter } from "./provider-failover";

export type PlaceCallCommand = {
  workflowId: string;
  idempotencyKey: string;
  recipientE164: string;
  recipientRegion: string;
  purpose: CallPurpose;
  callLanguage: string;
  dryRun: boolean;
};

export type FailoverAttempt = {
  providerId: string;
  accepted: boolean;
  status: CallWorkflowStatus;
  failureCode: CallFailureCode | null;
  providerCallId: string | null;
};

export type ProviderCallResult = {
  providerCallId: string;
  status: CallWorkflowStatus;
  structuredResult: CallStructuredResult | null;
  failureCode: CallFailureCode | null;
  taskCompleted?: boolean | null;
  completionConfidence?: number | null;
  /** Winning phone API when failover is configured. */
  phoneProviderId?: string;
  failoverAttempts?: FailoverAttempt[];
};

export interface CalleAdapter {
  placeFollowUpCall(command: PlaceCallCommand): Promise<ProviderCallResult>;
  getStatus(providerCallId: string): Promise<ProviderCallResult>;
  cancel(providerCallId: string): Promise<ProviderCallResult>;
}

function dryRunResult(workflowId: string): ProviderCallResult {
  return {
    providerCallId: `dryrun_${workflowId}`,
    status: "dry_run_completed",
    structuredResult: callStructuredResultSchema.parse({
      reached: true,
      availability: "available",
      needsHumanFollowUp: true,
      appointmentConfirmed: null,
      preferredCallbackWindow: "afternoon",
      safetyEscalation: "none",
      summaryCode: "needs_chw",
      nextAction: "call_again",
      completionConfidence: 0.91,
    }),
    failureCode: null,
    taskCompleted: true,
    completionConfidence: 0.91,
  };
}

export class DryRunCalleAdapter implements CalleAdapter {
  async placeFollowUpCall(command: PlaceCallCommand): Promise<ProviderCallResult> {
    return dryRunResult(command.workflowId);
  }

  async getStatus(providerCallId: string): Promise<ProviderCallResult> {
    return dryRunResult(providerCallId.replace(/^dryrun_/, "") || "unknown");
  }

  async cancel(providerCallId: string): Promise<ProviderCallResult> {
    return {
      providerCallId,
      status: "cancelled",
      structuredResult: null,
      failureCode: "cancelled",
    };
  }
}

function mapProviderStatus(status: string | undefined, taskCompleted?: boolean | null): CallWorkflowStatus {
  const normalized = (status ?? "").toLowerCase();
  if (normalized.includes("cancel")) return "cancelled";
  if (normalized.includes("no_answer") || normalized.includes("no-answer")) return "no_answer";
  if (normalized.includes("fail") || normalized.includes("error")) return "failed";
  if (
    normalized.includes("progress") ||
    normalized.includes("ring") ||
    normalized.includes("active") ||
    normalized.includes("queued")
  ) {
    return "in_progress";
  }
  if (normalized.includes("complete") || normalized.includes("done") || taskCompleted) return "completed";
  return "unknown";
}

function confidenceToNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function readTaskField<T>(call: CallTask | Record<string, unknown>, snake: string, camel: string): T | undefined {
  const record = call as Record<string, unknown>;
  return (record[snake] as T | undefined) ?? (record[camel] as T | undefined);
}

function toProviderResult(call: CallTask, fallbackId: string): ProviderCallResult {
  const structured = readTaskField<unknown>(call, "structured_result", "structuredResult");
  const taskCompleted = readTaskField<boolean | null>(call, "task_completed", "taskCompleted");
  const failureCode = readTaskField<CallFailureCode | null>(call, "failure_code", "failureCode");
  const completion = readTaskField<{ score?: number } | number | null>(
    call,
    "completion_confidence",
    "completionConfidence",
  );
  const normalized = normalizeStructuredResult(structured);
  return {
    providerCallId: call.id ?? fallbackId,
    status: mapProviderStatus(call.status, taskCompleted),
    structuredResult: normalized,
    failureCode: normalized ? (failureCode ?? null) : "result_invalid",
    taskCompleted,
    completionConfidence: confidenceToNumber(
      completion && typeof completion === "object" ? completion.score : completion,
    ),
  };
}

export class LiveCalleAdapter implements CalleAdapter {
  constructor(private readonly apiKey: string) {}

  private gateway() {
    return new CalleGateway(calleConfig.transport === "sdk" ? "sdk" : "rest");
  }

  async placeFollowUpCall(command: PlaceCallCommand): Promise<ProviderCallResult> {
    if (command.dryRun) return dryRunResult(command.workflowId);
    try {
      const call = await this.gateway().createAndWait({
        task: buildFollowUpTask({
          recipientE164: command.recipientE164,
          purpose: command.purpose,
          callLanguage: command.callLanguage,
        }),
        recipients: [
          {
            phones: [command.recipientE164],
            region: command.recipientRegion,
            locale: command.callLanguage,
          },
        ],
        resultSchema: CALL_E_RESULT_JSON_SCHEMA as never,
        metadata: {
          workflowId: command.workflowId,
          purpose: command.purpose,
          product: "call-aunty",
        },
        idempotencyKey: command.idempotencyKey,
      });
      return toProviderResult(call, `calle_${command.workflowId}`);
    } catch (error) {
      const code = toCallFailureCode(error);
      return {
        providerCallId: `failed_${command.workflowId}`,
        status: "failed",
        structuredResult: null,
        failureCode: code,
      };
    }
  }

  async getStatus(providerCallId: string): Promise<ProviderCallResult> {
    if (providerCallId.startsWith("dryrun_")) {
      return dryRunResult(providerCallId.replace(/^dryrun_/, ""));
    }
    try {
      const call = await this.gateway().getCall(providerCallId);
      return toProviderResult(call, providerCallId);
    } catch (error) {
      return {
        providerCallId,
        status: "unknown",
        structuredResult: null,
        failureCode: toCallFailureCode(error),
      };
    }
  }

  async cancel(providerCallId: string): Promise<ProviderCallResult> {
    try {
      if (!providerCallId.trim()) {
        return {
          providerCallId: "unknown",
          status: "failed",
          structuredResult: null,
          failureCode: "result_invalid",
        };
      }
      // SDK has no cancel operation; keep local cancel so CHW stop is fail-safe.
      return {
        providerCallId,
        status: "cancelled",
        structuredResult: null,
        failureCode: "cancelled",
      };
    } catch (error) {
      return {
        providerCallId,
        status: "failed",
        structuredResult: null,
        failureCode: error instanceof CalleError ? toCallFailureCode(error) : "internal_error",
      };
    }
  }
}

export function createCalleAdapter(opts: {
  apiKey: string;
  liveCallsEnabled: boolean;
  demoScenario?: DemoScenarioId;
  fallbackAdapters?: CalleAdapter[];
}): CalleAdapter {
  let primary: CalleAdapter;
  if (isDemoMode()) {
    primary = new FakeCalleRuntime(opts.demoScenario ?? "instant_success");
  } else if (!opts.liveCallsEnabled || !opts.apiKey) {
    primary = new DryRunCalleAdapter();
  } else {
    primary = new LiveCalleAdapter(opts.apiKey);
  }

  const fallbacks = [...(opts.fallbackAdapters?.filter(Boolean) ?? [])];
  if (primary instanceof LiveCalleAdapter && fallbacks.length === 0 && calleConfig.fallbackMock !== false) {
    fallbacks.push(new FakeCalleRuntime(opts.demoScenario ?? "instant_success"));
  }
  if (fallbacks.length === 0) return primary;

  return createFailoverCalleAdapter({
    providers: [
      { id: "call-e", adapter: primary },
      ...fallbacks.map((adapter, index) => ({
        id: index === 0 ? "backup-phone-api" : `phone-api-${index + 2}`,
        adapter,
      })),
    ],
  });
}
