import { calculateCalleCapabilities } from "../../../lib/calle/capabilities";
import type { CalleRuntimeConfig } from "../../../lib/calle/server";
import { getRuntimeBindings } from "../../../lib/runtime-bindings";

type RuntimeBindings = {
  CALLE_MODE?: string;
  CALLE_API_KEY?: string;
  CALLE_WEBHOOK_URL?: string;
  SPARESCOUT_APPROVAL_SECRET?: string;
  SPARESCOUT_OPERATOR_TOKEN?: string;
  SPARESCOUT_LIVE_RECIPIENT_ALLOWLIST?: string;
};

function bindings(): RuntimeBindings {
  return getRuntimeBindings() as RuntimeBindings;
}

export function getCalleRuntimeConfig(): CalleRuntimeConfig {
  const runtime = bindings();
  return {
    mode: runtime.CALLE_MODE === "live" ? "live" : "fixture",
    apiKey: runtime.CALLE_API_KEY,
    webhookUrl: runtime.CALLE_WEBHOOK_URL,
  };
}

export function getLiveSecurityBindings() {
  const runtime = bindings();
  return {
    SPARESCOUT_OPERATOR_TOKEN: runtime.SPARESCOUT_OPERATOR_TOKEN,
    SPARESCOUT_LIVE_RECIPIENT_ALLOWLIST: runtime.SPARESCOUT_LIVE_RECIPIENT_ALLOWLIST,
  };
}

export function getCalleCapabilities() {
  return calculateCalleCapabilities(bindings());
}

export function getApprovalSecret(mode: "fixture" | "live"): string {
  const secret = bindings().SPARESCOUT_APPROVAL_SECRET;
  if (secret) return secret;
  if (mode === "fixture") return "sparescout-fixture-approval-secret";
  throw new Error("Live calling is unavailable because SPARESCOUT_APPROVAL_SECRET is not configured.");
}
