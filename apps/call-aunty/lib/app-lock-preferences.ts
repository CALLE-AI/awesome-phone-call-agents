import AsyncStorage from "@react-native-async-storage/async-storage";

const TIMEOUT_KEY = "call-aunty/app-lock-timeout-ms";
export const APP_LOCK_TIMEOUT_OPTIONS = [60_000, 300_000, 900_000] as const;
export type AppLockTimeoutMs = (typeof APP_LOCK_TIMEOUT_OPTIONS)[number];

export function parseAppLockTimeout(value: string | null): AppLockTimeoutMs {
  const parsed = Number(value);
  return APP_LOCK_TIMEOUT_OPTIONS.includes(parsed as AppLockTimeoutMs) ? parsed as AppLockTimeoutMs : 60_000;
}

export async function loadAppLockTimeout(): Promise<AppLockTimeoutMs> {
  try {
    return parseAppLockTimeout(await AsyncStorage.getItem(TIMEOUT_KEY));
  } catch {
    return 60_000;
  }
}

export async function saveAppLockTimeout(timeoutMs: AppLockTimeoutMs): Promise<boolean> {
  try {
    await AsyncStorage.setItem(TIMEOUT_KEY, String(timeoutMs));
    return true;
  } catch {
    return false;
  }
}

export function formatAppLockTimeout(timeoutMs: AppLockTimeoutMs) {
  return `${timeoutMs / 60_000} minute${timeoutMs === 60_000 ? "" : "s"}`;
}
