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
  if (url.protocol !== "https:") throw new Error("CALLE_API_BASE_URL_INVALID");
  return url.toString().replace(/\/$/, "");
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
  const providerCode = firstString(payload.code, nested.code) || `http_${status}`;
  const providerMessage = firstString(payload.detail, payload.message, typeof payload.error === "string" ? payload.error : undefined, nested.detail, nested.message);

  if (status === 401) return {
    code: "invalid_api_key",
    message: "مفتاح CALL‑E غير صالح أو منتهي. حدّثه من الإعدادات ثم اختبر الاتصال؛ لم يُستخدم أي رصيد.",
  };
  if (status === 403) return {
    code: providerCode,
    message: "حساب CALL‑E أو المفتاح الحالي لا يملك صلاحية هذا الطلب. راجع صلاحيات الحساب والمنطقة؛ لم يُستخدم أي رصيد.",
  };
  if (status === 429) return {
    code: providerCode,
    message: "رفض CALL‑E الطلب بسبب حد الاستخدام أو معدل الطلبات. لم يضف التطبيق إعادة محاولة تلقائية.",
  };
  if (status === 400 || status === 409 || status === 422) return {
    code: providerCode,
    message: providerMessage ? `رفض CALL‑E بيانات الطلب: ${providerMessage.slice(0, 300)}` : "رفض CALL‑E بيانات الطلب. راجع إعدادات الخدمة والمستلم؛ لم يُستخدم أي رصيد.",
  };
  return {
    code: providerCode,
    message: providerMessage ? `تعذر إكمال طلب CALL‑E: ${providerMessage.slice(0, 300)}` : `تعذر إكمال طلب CALL‑E (HTTP ${status}). لم يُجدول التطبيق إعادة محاولة تلقائية.`,
  };
}

export async function testCalleApiKey(apiKey: string) {
  let response: Response;
  try {
    response = await fetch(`${calleApiBaseUrl()}/v1/goals?limit=1`, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: "no-store",
    });
  } catch {
    throw new CalleApiError(502, "calle_unreachable", "تعذر الوصول إلى CALL‑E لاختبار الاتصال. حاول مرة أخرى.");
  }
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const details = calleErrorDetails(response.status, payload);
    throw new CalleApiError(response.status, details.code, details.message);
  }
  const data = Array.isArray(payload.data) ? payload.data : [];
  return { connected: true as const, publishedGoalCountOnFirstPage: data.length };
}
