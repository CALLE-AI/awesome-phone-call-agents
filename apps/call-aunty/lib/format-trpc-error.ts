import { TRPCClientError } from "@trpc/client";

import type { AppRouter } from "@/server/routers";

type TrpcError = TRPCClientError<AppRouter>;

type ErrorCause = {
  code?: string;
  upgradePlanId?: string;
  upgrade?: boolean;
};

const UPGRADE_MESSAGE_PATTERNS = [
  /call credit/i,
  /paid plan/i,
  /upgrade/i,
  /allowance reached/i,
  /insufficient_call_credits/i,
  /upgrade_required/i,
  /monthly_call_limit/i,
];

function readCause(error: TrpcError): ErrorCause | undefined {
  const fromCause = error.cause as ErrorCause | undefined;
  if (fromCause?.code) return fromCause;
  const data = error.data as ErrorCause | undefined;
  if (data?.code) return data;
  return undefined;
}

export function formatTrpcError(error: unknown, fallback: string): string {
  if (error instanceof TRPCClientError) {
    const trpcError = error as TrpcError;
    if (trpcError.message && trpcError.message !== "Unexpected error") {
      return trpcError.message;
    }
    const cause = readCause(trpcError);
    if (cause?.code) return cause.code;
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
}

export function getTrpcErrorCode(error: unknown): string | undefined {
  if (error instanceof TRPCClientError) {
    const trpcError = error as TrpcError;
    const cause = readCause(trpcError);
    if (cause?.code) return cause.code;
    const msg = trpcError.message ?? "";
    for (const pattern of [
      "insufficient_call_credits",
      "upgrade_required",
      "monthly_call_limit",
      "unauthorized",
      "missing_consent",
    ]) {
      if (msg.includes(pattern)) return pattern;
    }
  }
  return undefined;
}

export function getTrpcUpgradePlanId(error: unknown): string | undefined {
  if (error instanceof TRPCClientError) {
    return readCause(error as TrpcError)?.upgradePlanId;
  }
  return undefined;
}

export function isUpgradeRelatedError(error: unknown): boolean {
  if (error instanceof TRPCClientError) {
    const cause = readCause(error as TrpcError);
    if (cause?.upgrade) return true;
    if (cause?.code && UPGRADE_MESSAGE_PATTERNS.some((p) => p.test(cause.code!))) return true;
  }
  const message = formatTrpcError(error, "");
  return UPGRADE_MESSAGE_PATTERNS.some((p) => p.test(message));
}

export function isNetworkOrServerError(error: unknown): boolean {
  if (error instanceof TRPCClientError) {
    const code = (error as TrpcError).data?.code;
    return code === "INTERNAL_SERVER_ERROR" || code === "TIMEOUT" || code === "CLIENT_CLOSED_REQUEST";
  }
  if (error instanceof TypeError) return true;
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return (
      message.includes("network") ||
      message.includes("failed to fetch") ||
      message.includes("timeout") ||
      message.includes("econnrefused") ||
      message.includes("enotfound")
    );
  }
  return false;
}
