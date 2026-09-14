export const DEFAULT_APP_LOCK_TIMEOUT_MS = 60_000;

export function shouldLockAfterBackground(backgroundAt: number | null, now: number, timeoutMs = DEFAULT_APP_LOCK_TIMEOUT_MS) {
  if (backgroundAt === null) return false;
  return now - backgroundAt >= timeoutMs;
}
