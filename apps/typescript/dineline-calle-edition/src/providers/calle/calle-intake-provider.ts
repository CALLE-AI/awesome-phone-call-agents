import { CalleClient } from "@call-e/calle";

import {
  diningPreferencesJsonSchema,
  type ApprovedPreferenceIntakeContract,
} from "../../domain/dining-preferences.js";
import type { IntakeExecutionContext } from "../../domain/execution-context.js";
import {
  createAndWaitForCalleCall,
  readCalleCall,
} from "./call-runner.js";
import { CALLE_BOUNDED_TIMEOUT_MS } from "./calle-sdk-provider.js";
import type { PreferenceIntakeProvider } from "./intake-types.js";
import { assertAllowedPhoneNumber } from "./phone-allowlist.js";
import type { ProviderCallResult } from "./types.js";

export interface CalleIntakeProviderOptions {
  apiKey: string;
  allowRealCalls: boolean;
  allowedPhoneNumbers: ReadonlySet<string>;
  timeoutMs?: number;
}

export class CalleIntakeProvider implements PreferenceIntakeProvider {
  readonly name = "call-e-intake-sdk";
  readonly #client: CalleClient;
  readonly #allowRealCalls: boolean;
  readonly #allowedPhoneNumbers: ReadonlySet<string>;
  readonly #timeoutMs: number;

  constructor(options: CalleIntakeProviderOptions) {
    if (!options.apiKey.trim()) {
      throw new Error("CALLE_API_KEY is required for the real CALL-E intake provider");
    }

    this.#client = new CalleClient({ apiKey: options.apiKey });
    this.#allowRealCalls = options.allowRealCalls;
    this.#allowedPhoneNumbers = options.allowedPhoneNumbers;
    this.#timeoutMs = options.timeoutMs ?? CALLE_BOUNDED_TIMEOUT_MS;
  }

  async execute(
    contract: ApprovedPreferenceIntakeContract,
    idempotencyKey: string,
    context: IntakeExecutionContext,
  ): Promise<ProviderCallResult> {
    if (!this.#allowRealCalls) {
      throw new Error("Real CALL-E preference calls are disabled by policy");
    }

    assertAllowedPhoneNumber(
      contract.phone,
      this.#allowedPhoneNumbers,
      "DineLine Concierge",
    );

    return createAndWaitForCalleCall(
      this.#client,
      {
        task: buildPreferenceTask(contract),
        recipient: { phone: contract.phone, region: "US", locale: "en-US" },
        resultSchema: diningPreferencesJsonSchema,
        metadata: {
          application: "dineline-calle-edition",
          agentRole: "dining-preference-intake",
          requestId: contract.requestId,
          correlationId: context.correlationId,
          ...(context.n8nExecutionId
            ? { n8nExecutionId: context.n8nExecutionId }
            : {}),
        },
      },
      idempotencyKey,
      this.#timeoutMs,
    );
  }

  async getResult(providerCallId: string): Promise<ProviderCallResult> {
    return readCalleCall(this.#client, providerCallId);
  }
}

function buildPreferenceTask(contract: ApprovedPreferenceIntakeContract): string {
  const referenceDate = contract.requestedAt.slice(0, 10);

  return [
    "You are the DineLine Concierge, an AI assistant helping a diner plan one restaurant visit.",
    "At the start of the call, clearly disclose that you are an AI assistant.",
    "Conduct the entire conversation in clear United States English. Do not switch languages.",
    "Begin with an open question about the dinner they have in mind instead of reading a form.",
    "Naturally collect the location, cuisine, date, time, party size, budget, atmosphere, dietary needs, and any useful notes.",
    "Ask only the follow-up questions needed to make the request usable.",
    "Capture conversational preferences such as quiet enough to talk, celebratory but not stuffy, or a cuisine they want to avoid.",
    `The reference date for relative dates is ${referenceDate}. Return dates as YYYY-MM-DD and times as 24-hour HH:MM.`,
    "If the diner does not know a text field, return unknown. Use none for optional notes and 0 for an unknown party size rather than inventing a value.",
    "Briefly repeat the captured request and let the diner correct it before ending.",
    "Do not search for restaurants, recommend a specific business, make a reservation, or contact anyone else.",
    "Close by saying that DineLine will prepare five options for the diner to review.",
    "Return only evidence-supported structured fields.",
  ].join("\n");
}
