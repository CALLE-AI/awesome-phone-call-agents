import { HARBOR_ACCOUNT_ID, HARBOR_PUBLIC_SDK_KEY, SUNDIALS_API_KEY_HEADER } from "./public-key.ts";

export function sdkKeyFromHeaders(headers: Headers): string {
  return headers.get(SUNDIALS_API_KEY_HEADER)?.trim() || "";
}

export function accountIdForSdkKey(apiKey: string): string | null {
  if (apiKey === HARBOR_PUBLIC_SDK_KEY) return HARBOR_ACCOUNT_ID;
  return null;
}

export function authenticateSdkRequest(
  headers: Headers,
  requestedAccountId?: string
): { ok: true; accountId: string } | { ok: false; message: string; status: 401 } {
  const accountId = accountIdForSdkKey(sdkKeyFromHeaders(headers));
  if (!accountId) {
    return { ok: false, message: "Invalid SDK key.", status: 401 };
  }
  const requested = requestedAccountId?.trim();
  if (requested && requested !== accountId) {
    return { ok: false, message: "Invalid SDK key.", status: 401 };
  }
  return { ok: true, accountId };
}
