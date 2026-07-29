/**
 * CALL-E access.
 *
 * The gate talks to CALL-E through a small port so tests can point it at a
 * local fake server and the live path stays one adapter. The SDK is imported
 * lazily, which keeps `preview` and `verify` runnable with nothing installed.
 */

import type { CallSnapshot, JsonSchema } from "./types.js";

export interface CallRecipientInput {
  phones: string[];
  region?: string;
  locale?: string;
}

export interface CreateCallInput {
  task: string;
  recipients: CallRecipientInput[];
  resultSchema: JsonSchema;
  metadata: Record<string, string | number>;
}

export interface WaitOptions {
  timeoutMs: number;
  intervalMs: number;
}

export interface CallePort {
  createCall(input: CreateCallInput, idempotencyKey: string): Promise<CallSnapshot>;
  waitForResult(callId: string, options: WaitOptions): Promise<CallSnapshot>;
  getCall(callId: string): Promise<CallSnapshot>;
}

export class GateApiError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export class GateTimeoutError extends Error {}

export const DEFAULT_BASE_URL = "https://api.heycall-e.com";

/**
 * Live adapter over `@call-e/calle`. The SDK is the supported server path for
 * the Developer API, so the gate does not hand-roll HTTP.
 */
export async function createSdkPort(options: {
  apiKey: string;
  baseUrl?: string;
}): Promise<CallePort> {
  const { CalleClient, CalleTimeoutError } = await import("@call-e/calle");
  const client = new CalleClient({
    apiKey: options.apiKey,
    baseUrl: options.baseUrl ?? DEFAULT_BASE_URL,
  });

  const rethrow = (error: unknown): never => {
    if (error instanceof CalleTimeoutError) {
      throw new GateTimeoutError(error.message);
    }
    const value = error as { code?: string; message?: string };
    throw new GateApiError(value?.code ?? "sdk_error", value?.message ?? String(error));
  };

  return {
    async createCall(input, idempotencyKey) {
      try {
        return (await client.calls.create(
          {
            task: input.task,
            recipients: input.recipients,
            resultSchema: input.resultSchema as unknown as Record<string, unknown>,
            metadata: input.metadata,
          },
          { idempotencyKey },
        )) as unknown as CallSnapshot;
      } catch (error) {
        return rethrow(error);
      }
    },
    async waitForResult(callId, waitOptions) {
      try {
        return (await client.calls.waitForResult(callId, {
          timeoutMs: waitOptions.timeoutMs,
          intervalMs: waitOptions.intervalMs,
        })) as unknown as CallSnapshot;
      } catch (error) {
        return rethrow(error);
      }
    },
    async getCall(callId) {
      try {
        return (await client.calls.get(callId)) as unknown as CallSnapshot;
      } catch (error) {
        return rethrow(error);
      }
    },
  };
}
