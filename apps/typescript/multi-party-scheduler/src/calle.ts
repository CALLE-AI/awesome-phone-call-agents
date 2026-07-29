/**
 * CALL-E access.
 *
 * One small port so the tests can point the real SDK client at a local fake
 * server and so `plan` and `replay` run with nothing installed. The SDK is
 * imported lazily for that reason.
 */

import type { CallSnapshot, JsonSchema } from "./types.js";

export interface CreateCallInput {
  task: string;
  recipients: { phones: string[]; region?: string; locale?: string }[];
  resultSchema: JsonSchema;
  metadata: Record<string, string | number>;
}

export interface CallePort {
  createCall(input: CreateCallInput, idempotencyKey: string): Promise<CallSnapshot>;
  waitForResult(callId: string, options: { timeoutMs: number; intervalMs: number }): Promise<CallSnapshot>;
  getCall(callId: string): Promise<CallSnapshot>;
}

export class CalleCallError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export class CalleWaitTimeout extends Error {}

export const DEFAULT_BASE_URL = "https://api.heycall-e.com";

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
      throw new CalleWaitTimeout(error.message);
    }
    const value = error as { code?: string; message?: string };
    throw new CalleCallError(value?.code ?? "sdk_error", value?.message ?? String(error));
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
        return (await client.calls.waitForResult(callId, waitOptions)) as unknown as CallSnapshot;
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
