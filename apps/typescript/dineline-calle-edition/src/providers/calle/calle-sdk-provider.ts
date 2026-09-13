import { CalleClient } from "@call-e/calle";

import type { ApprovedBookingContract } from "../../domain/booking-contract.js";
import type { BookingExecutionContext } from "../../domain/execution-context.js";
import { calleResultJsonSchema } from "../../domain/call-result.js";
import {
  createAndWaitForCalleCall,
  readCalleCall,
} from "./call-runner.js";
import type {
  BookingCallProvider,
  ProviderCallResult,
} from "./types.js";
import { assertAllowedPhoneNumber } from "./phone-allowlist.js";

export interface CalleSdkProviderOptions {
  apiKey: string;
  allowRealCalls: boolean;
  allowedPhoneNumbers: ReadonlySet<string>;
  timeoutMs?: number;
}

export const CALLE_BOUNDED_TIMEOUT_MS = 300_000;

export class CalleSdkProvider implements BookingCallProvider {
  readonly name = "call-e-sdk";
  readonly #client: CalleClient;
  readonly #allowRealCalls: boolean;
  readonly #allowedPhoneNumbers: ReadonlySet<string>;
  readonly #timeoutMs: number;

  constructor(options: CalleSdkProviderOptions) {
    if (!options.apiKey.trim()) {
      throw new Error("CALLE_API_KEY is required for the real CALL-E provider");
    }

    this.#client = new CalleClient({ apiKey: options.apiKey });
    this.#allowRealCalls = options.allowRealCalls;
    this.#allowedPhoneNumbers = options.allowedPhoneNumbers;
    this.#timeoutMs = options.timeoutMs ?? CALLE_BOUNDED_TIMEOUT_MS;
  }

  async execute(
    contract: ApprovedBookingContract,
    idempotencyKey: string,
    context: BookingExecutionContext,
  ): Promise<ProviderCallResult> {
    if (!this.#allowRealCalls) {
      throw new Error("Real CALL-E calls are disabled by policy");
    }

    assertAllowedPhoneNumber(
      contract.restaurant.phone,
      this.#allowedPhoneNumbers,
      "Agent Jake",
    );

    return createAndWaitForCalleCall(
      this.#client,
      {
        task: buildBookingTask(contract),
        recipient: {
          phone: contract.restaurant.phone,
          region: "US",
          locale: "en-US",
        },
        resultSchema: calleResultJsonSchema,
        metadata: {
          application: "dineline-calle-edition",
          contractId: contract.contractId,
          correlationId: context.correlationId,
          ...(context.n8nExecutionId
            ? { n8nExecutionId: context.n8nExecutionId }
            : {}),
          ...(context.sourceCallId ? { sourceCallId: context.sourceCallId } : {}),
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

function buildBookingTask(contract: ApprovedBookingContract): string {
  const requests = contract.reservation.specialRequests || "none";

  return [
    "You are Agent Jake, an AI assistant calling on behalf of a diner.",
    "At the start of the conversation, clearly disclose that you are an AI assistant.",
    "Conduct the entire conversation in clear United States English. Do not switch languages.",
    "This is a controlled demonstration with an authorized participant. Ask them to role-play the restaurant; do not imply that the test line belongs to the real business.",
    `Call ${contract.restaurant.name} at ${contract.restaurant.address}.`,
    `Request a reservation for ${contract.reservation.guestName}.`,
    `Date: ${contract.reservation.date}.`,
    `Time: ${contract.reservation.time} in ${contract.reservation.timeZone}.`,
    `Party size: ${contract.reservation.partySize}.`,
    `Special requests: ${requests}.`,
    "Do not accept a different date, time, or party size.",
    "If the requested slot is unavailable, ask once whether an alternative is available, record it, but do not book it.",
    "Do not leave a voicemail and do not make promises outside this reservation request.",
    "Return only evidence-supported structured fields. If the outcome is ambiguous, use uncertain.",
  ].join("\n");
}
