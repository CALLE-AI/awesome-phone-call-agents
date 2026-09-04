import { CalleClient } from "@call-e/calle";
import { approvalFingerprint } from "./approval.ts";
import { normalizeCall, type SourcingCallPlan, type SourcingExecution } from "./contracts.ts";
import { executeFixture } from "./fixtures.ts";

export type CalleRuntimeConfig = {
  mode: "fixture" | "live";
  apiKey?: string;
  baseUrl?: string;
  webhookUrl?: string;
  fetch?: (request: Request) => Promise<Response>;
};

export const OFFICIAL_CALLE_ORIGIN = "https://api.heycall-e.com";

export function safeCalleBaseUrl(baseUrl = OFFICIAL_CALLE_ORIGIN): string {
  const url = new URL(baseUrl);
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  const official = url.protocol === "https:" && url.origin === OFFICIAL_CALLE_ORIGIN;
  if ((!loopback && !official) || url.username || url.password || url.search || url.hash) {
    throw new Error("CALL-E credentials may only be sent to the official HTTPS API origin or a loopback test server.");
  }
  if (url.pathname !== "/" && url.pathname !== "") {
    throw new Error("The CALL-E base URL must not contain a path.");
  }
  return url.origin;
}

export async function executeSourcingPlan(
  plan: SourcingCallPlan,
  approvalToken: string,
  config: CalleRuntimeConfig,
): Promise<SourcingExecution> {
  if (plan.request.executionMode === "fixture") return executeFixture(plan);
  if (!plan.request.recipientConsentConfirmed || !plan.request.authorizedCallWindow.trim()) {
    throw new Error("Live calling is blocked because recipient consent and the authorized call window are missing.");
  }
  if (config.mode !== "live") {
    throw new Error("Live calling is unavailable. Keep this request in fixture mode or configure the trusted server first.");
  }
  if (!config.apiKey) throw new Error("Live calling is unavailable because CALLE_API_KEY is not configured.");

  const client = new CalleClient({
    apiKey: config.apiKey,
    baseUrl: safeCalleBaseUrl(config.baseUrl),
    fetch: config.fetch,
  });
  const idempotencyKey = `sparescout_${await approvalFingerprint(approvalToken)}`;
  const call = await client.calls.create(
    {
      task: plan.task,
      recipients: plan.request.suppliers.map((supplier) => ({
        phones: [supplier.phone],
        region: plan.request.countryCode,
        locale: plan.request.locale,
      })),
      resultSchema: plan.aggregateResultSchema,
      recipientResultSchema: plan.recipientResultSchema,
      metadata: { sparescout_plan_id: plan.id },
      webhookUrl: config.webhookUrl,
    },
    { idempotencyKey },
  );
  return normalizeCall(call, plan.request.suppliers);
}

export async function getSourcingExecution(
  callId: string,
  suppliers: SourcingCallPlan["request"]["suppliers"],
  config: CalleRuntimeConfig,
): Promise<SourcingExecution> {
  if (config.mode !== "live" || !config.apiKey) {
    throw new Error("Only live CALL-E runs can be polled.");
  }
  const client = new CalleClient({
    apiKey: config.apiKey,
    baseUrl: safeCalleBaseUrl(config.baseUrl),
    fetch: config.fetch,
  });
  return normalizeCall(await client.calls.get(callId), suppliers);
}
