import AsyncStorage from "@react-native-async-storage/async-storage";

import type { PublicEntitlements } from "@/server/billing/types";

const CACHE_KEY = "call_aunty_entitlements_v6";

export type CachedEntitlements = PublicEntitlements & {
  cachedAt: string;
  integrityHash?: string;
};

export async function loadCachedEntitlements(): Promise<CachedEntitlements | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedEntitlements;
    if (parsed.expiresAt && new Date(parsed.expiresAt).getTime() < Date.now()) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function saveCachedEntitlements(snapshot: PublicEntitlements): Promise<void> {
  const payload: CachedEntitlements = {
    ...snapshot,
    cachedAt: new Date().toISOString(),
  };
  await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(payload));
}

export async function clearCachedEntitlements(): Promise<void> {
  await AsyncStorage.removeItem(CACHE_KEY);
}

/** Offline read-only gate — never authorizes irreversible billable ops from cache alone. */
export function canUseCachedFeature(
  cached: CachedEntitlements | null,
  feature: string,
): boolean {
  if (!cached) return false;
  return cached.features.includes(feature as CachedEntitlements["features"][number]);
}
