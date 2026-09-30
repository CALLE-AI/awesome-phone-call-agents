import type { CallPlan, StructuredOutcome } from '../domain/models';
import type { ProviderRunStatus } from './call-provider';

export interface OutcomeExtractor {
  extract(status: ProviderRunStatus, plan: CallPlan): StructuredOutcome;
}
