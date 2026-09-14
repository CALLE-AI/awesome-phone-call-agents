import {
  CalleClient,
  type Call,
  type CreateCallInput,
} from "@call-e/calle";

import { resolveCalleBaseUrl } from "./config";

type FetchLike = (input: Request) => Promise<Response>;

export interface CallPort {
  create(
    input: CreateCallInput,
    options: { idempotencyKey: string },
  ): Promise<Call>;
  waitForResult(callId: string, options: { timeoutMs: number }): Promise<Call>;
}

interface CallePortOptions {
  baseUrl?: string;
  environment?: string;
  fetch?: FetchLike;
}

export function createCallePort(
  apiKey: string,
  options: CallePortOptions = {},
): CallPort {
  const baseUrl = resolveCalleBaseUrl(
    options.baseUrl ?? process.env.CALLE_BASE_URL,
    options.environment ?? process.env.NODE_ENV ?? "development",
  );
  const client = new CalleClient({
    apiKey,
    baseUrl,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });

  return {
    create: (input, requestOptions) =>
      client.calls.create(input, requestOptions),
    waitForResult: (callId, waitOptions) =>
      client.calls.waitForResult(callId, waitOptions),
  };
}
