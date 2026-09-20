import { z } from "zod";

export const CorrelationIdSchema = z
  .string()
  .regex(/^dle_[a-f0-9]{24}$/, "Use the DineLine correlation ID from preview");

export const IntakeCorrelationIdSchema = z
  .string()
  .regex(
    /^dli_[a-f0-9]{24}$/,
    "Use the DineLine intake correlation ID from preview",
  );

export const ExternalExecutionIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(
    /^[a-zA-Z0-9_.:-]+$/,
    "Execution IDs may contain letters, numbers, dots, colons, underscores, and hyphens",
  );

export interface BookingExecutionContext {
  correlationId: string;
  n8nExecutionId: string | null;
  sourceCallId: string | null;
  toolCallId: string | null;
}

export type IntakeExecutionContext = BookingExecutionContext;

export function createCorrelationId(contractId: string): string {
  if (!/^[a-f0-9]{64}$/.test(contractId)) {
    throw new Error("A valid booking contract ID is required");
  }

  return `dle_${contractId.slice(0, 24)}`;
}

export function createExecutionContext(
  contractId: string,
  overrides: Partial<Omit<BookingExecutionContext, "correlationId">> = {},
): BookingExecutionContext {
  return {
    correlationId: createCorrelationId(contractId),
    n8nExecutionId: overrides.n8nExecutionId ?? null,
    sourceCallId: overrides.sourceCallId ?? null,
    toolCallId: overrides.toolCallId ?? null,
  };
}

export function createIntakeCorrelationId(requestId: string): string {
  if (!/^[a-f0-9]{64}$/.test(requestId)) {
    throw new Error("A valid preference request ID is required");
  }

  return `dli_${requestId.slice(0, 24)}`;
}

export function createIntakeExecutionContext(
  requestId: string,
  overrides: Partial<Omit<IntakeExecutionContext, "correlationId">> = {},
): IntakeExecutionContext {
  return {
    correlationId: createIntakeCorrelationId(requestId),
    n8nExecutionId: overrides.n8nExecutionId ?? null,
    sourceCallId: overrides.sourceCallId ?? null,
    toolCallId: overrides.toolCallId ?? null,
  };
}
