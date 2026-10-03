import type { ApprovedPreferenceIntakeContract } from "../../domain/dining-preferences.js";
import type { IntakeExecutionContext } from "../../domain/execution-context.js";
import type { ProviderCallResult } from "./types.js";

export interface PreferenceIntakeProvider {
  readonly name: string;
  execute(
    contract: ApprovedPreferenceIntakeContract,
    idempotencyKey: string,
    context: IntakeExecutionContext,
  ): Promise<ProviderCallResult>;
  getResult?(providerCallId: string): Promise<ProviderCallResult>;
}
