import { getSundialsDb, type SundialsDatabase } from "../db.ts";
import { SUNDIALS_API_KEY_HEADER } from "./public-key.ts";

export type SdkKeyStore = Pick<SundialsDatabase, "getAccountBySdkKey">;

export function sdkKeyFromHeaders(headers: Headers): string {
  return headers.get(SUNDIALS_API_KEY_HEADER)?.trim() || "";
}

export function accountIdForSdkKey(apiKey: string, store: SdkKeyStore = getSundialsDb()): string | null {
  const account = store.getAccountBySdkKey(apiKey);
  return account?.id ?? null;
}

export function authenticateSdkRequest(
  headers: Headers,
  requestedAccountId?: string,
  store: SdkKeyStore = getSundialsDb()
): { ok: true; accountId: string } | { ok: false; message: string; status: 401 } {
  const accountId = accountIdForSdkKey(sdkKeyFromHeaders(headers), store);
  if (!accountId) {
    return { ok: false, message: "Invalid SDK key.", status: 401 };
  }
  const requested = requestedAccountId?.trim();
  if (requested && requested !== accountId) {
    return { ok: false, message: "Invalid SDK key.", status: 401 };
  }
  return { ok: true, accountId };
}
