import type {
  CallePlanContractResult,
  SanitizedCallePlanObservation,
} from '../../src/integrations/calle-plan-response-types';

export function classifyCallePlanResponse(response: unknown): CallePlanContractResult;
export function destroyCallePlanOpaqueValues(response: unknown): boolean;
export function sanitizeCallePlanText(value: unknown): string | null;
export function emptyCallePlanObservation(): SanitizedCallePlanObservation;
