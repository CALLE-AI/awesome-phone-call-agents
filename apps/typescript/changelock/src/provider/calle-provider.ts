import {
  CalleAPIError,
  CalleAuthenticationError,
  CalleClient,
  CalleConnectionError,
  CalleRateLimitError,
  CalleTimeoutError,
  type Call,
} from "@call-e/calle";
import { livePolicyCheck } from "../application/live-policy";
import type {
  CallProvider,
  CreateCallOutcome,
  ProviderCallSnapshot,
  ReservedCallInput,
  SafeProviderErrorCode,
} from "./call-provider";

const CALLE_API_ORIGIN = "https://api.heycall-e.com";

function mapError(err: unknown): SafeProviderErrorCode {
  if (err instanceof CalleAuthenticationError) return "auth_invalid";
  if (err instanceof CalleRateLimitError) return "rate_limited";
  if (err instanceof CalleTimeoutError) return "network_error";
  if (err instanceof CalleConnectionError) return "network_error";
  if (err instanceof CalleAPIError) {
    if (err.status === 401 || err.status === 403) return "auth_invalid";
    if (err.status === 429) return "rate_limited";
    if (err.status >= 500) return "provider_unavailable";
    if (err.status >= 400) return "invalid_request";
  }
  return "unknown";
}

function toSnapshot(call: Call): ProviderCallSnapshot {
  const recipient = call.recipients[0];
  const lastAttempt = recipient?.attempts[recipient.attempts.length - 1];
  return {
    id: call.id,
    status: call.status,
    taskCompleted: call.taskCompleted,
    recipientStatus: recipient?.status ?? null,
    confidenceScore: call.completionConfidence?.score ?? null,
    structuredResult: recipient?.structuredResult ?? call.structuredResult,
    evidence: call.evidence,
    failureCode: call.failureCode ?? lastAttempt?.failureCode ?? null,
    dialedPhoneE164: lastAttempt?.phone ?? recipient?.phones[0] ?? null,
    metadata: call.metadata,
  };
}

export function createLiveCallProvider(): CallProvider {
  if (process.env.CHANGELOCK_MODE !== "live") {
    throw new Error("live provider requires CHANGELOCK_MODE=live");
  }
  const apiKey = process.env.CALLE_API_KEY;
  const client = new CalleClient({
    apiKey: apiKey ?? "missing",
    baseUrl: CALLE_API_ORIGIN,
  });
  return {
    async create(input: ReservedCallInput): Promise<CreateCallOutcome> {
      if (!apiKey) {
        return { kind: "rejected", code: "auth_missing" };
      }
      const policy = livePolicyCheck({ phoneE164: input.phoneE164, region: input.region });
      if (!policy.ok) {
        return { kind: "rejected", code: "not_allowlisted" };
      }
      try {
        const call = await client.calls.create(
          {
            task: input.task,
            recipient: {
              phone: input.phoneE164,
              region: input.region,
              locale: input.locale,
            },
            recipientResultSchema: input.recipientResultSchema,
            metadata: { ...input.metadata },
          },
          { idempotencyKey: input.idempotencyKey },
        );
        return { kind: "accepted", snapshot: toSnapshot(call) };
      } catch (err) {
        const code = mapError(err);
        if (err instanceof CalleAPIError && err.status < 500 && err.status !== 429) {
          return { kind: "rejected", code };
        }
        return { kind: "acceptance_unknown", code };
      }
    },
    async get(callId: string): Promise<ProviderCallSnapshot> {
      if (!apiKey) throw new Error("CALLE_API_KEY not configured");
      return toSnapshot(await client.calls.get(callId));
    },
  };
}
