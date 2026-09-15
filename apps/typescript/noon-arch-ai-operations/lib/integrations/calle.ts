import { maskPhoneText } from "./redact";
const DEFAULT_CALLE_API_BASE_URL = "https://api.heycall-e.com";
const DEFAULT_CALLE_BILLING_DASHBOARD_URL = "https://dashboard.heycall-e.com/account/billing";

export class CalleApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
    this.name = "CalleApiError";
  }
}

export function calleApiBaseUrl() {
  const configured = String(process.env.CALLE_API_BASE_URL || DEFAULT_CALLE_API_BASE_URL).trim().replace(/\/+$/, "");
  const url = new URL(configured);
  const approved = new Set([DEFAULT_CALLE_API_BASE_URL, ...String(process.env.CALLE_APPROVED_API_ORIGINS || "").split(",").map((value) => value.trim()).filter(Boolean)]);
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash || !approved.has(url.origin)) {
    throw new Error("CALLE_API_BASE_URL_INVALID");
  }
  return url.origin;
}

/** Never send a bearer token to a response redirect or an unapproved origin. */
export function calleFetch(path: string, init: RequestInit = {}) {
  if (!path.startsWith("/v1/") || path.startsWith("//")) throw new Error("CALLE_PATH_INVALID");
  return fetch(`${calleApiBaseUrl()}${path}`, { ...init, redirect: "error" });
}

export function calleBillingDashboardUrl() {
  const configured = String(process.env.CALLE_BILLING_DASHBOARD_URL || DEFAULT_CALLE_BILLING_DASHBOARD_URL).trim();
  try {
    const url = new URL(configured);
    return url.protocol === "https:" ? url.toString() : DEFAULT_CALLE_BILLING_DASHBOARD_URL;
  } catch {
    return DEFAULT_CALLE_BILLING_DASHBOARD_URL;
  }
}

/**
 * CALL-E's published OpenAPI contract currently has calls, goals, goal-runs,
 * and webhooks, but no account, usage, credit, or billing endpoint. Keep this
 * boundary explicit so a locally counted call is never presented as provider
 * balance. When CALL-E publishes a billing endpoint, this capability can be
 * replaced with a server-side fetch without changing the UI contract.
 */
export function calleBalanceCapability() {
  return {
    available: false as const,
    reason: "public_api_has_no_balance_endpoint" as const,
    dashboardUrl: calleBillingDashboardUrl(),
    checkedAgainst: "CALL-E public OpenAPI",
  };
}

function firstString(...values: unknown[]) {
  return values.find((value): value is string => typeof value === "string" && Boolean(value.trim()))?.trim();
}

function nestedError(payload: Record<string, unknown>) {
  const error = payload.error;
  if (!error || typeof error !== "object" || Array.isArray(error)) return {} as Record<string, unknown>;
  return error as Record<string, unknown>;
}

export function calleErrorDetails(status: number, payload: Record<string, unknown> = {}) {
  const nested = nestedError(payload);
  const rawCode = firstString(payload.code, nested.code) || `http_${status}`;
  const providerCode = /^[a-z][a-z0-9_-]{0,80}$/i.test(rawCode) ? rawCode : "provider_rejected";
  const providerMessage = firstString(payload.detail, payload.message, typeof payload.error === "string" ? payload.error : undefined, nested.detail, nested.message);

  if (status === 401) return {
    code: "invalid_api_key",
    message: "The CALL-E API key is invalid or expired. Update it in settings and retest; this request used no credit.",
  };
  if (status === 403) return {
    code: providerCode,
    message: "This CALL-E account or key cannot make that request. Check permissions and region; this request used no credit.",
  };
  if (status === 429) return {
    code: providerCode,
    message: "CALL-E rejected the request because of a usage or rate limit. The app will not retry automatically.",
  };
  if (status === 400 || status === 409 || status === 422) return {
    code: providerCode,
    message: providerMessage ? `CALL-E rejected the request: ${maskPhoneText(providerMessage).slice(0, 300)}` : "CALL-E rejected the request. Check service and recipient settings; this request used no credit.",
  };
  return {
    code: providerCode,
    message: providerMessage ? `CALL-E could not complete the request: ${maskPhoneText(providerMessage).slice(0, 300)}` : `CALL-E could not complete the request (HTTP ${status}). The app will not retry automatically.`,
  };
}

export async function testCalleApiKey(apiKey: string) {
  let response: Response;
  try {
    response = await calleFetch("/v1/goals?limit=1", {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: "no-store",
    });
  } catch {
    throw new CalleApiError(502, "calle_unreachable", "CALL-E could not be reached for the read-only connection test.");
  }
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const details = calleErrorDetails(response.status, payload);
    throw new CalleApiError(response.status, details.code, details.message);
  }
  const data = Array.isArray(payload.data) ? payload.data : [];
  return { connected: true as const, publishedGoalCountOnFirstPage: data.length };
}
