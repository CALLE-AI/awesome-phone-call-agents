export type RememberedHistoryAccess = { requestId: string; token: string; savedAt: string };

const STORAGE_KEY = "sparescout.history-access.v1";
const MAX_REMEMBERED_REQUESTS = 20;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{40,64}$/;
const TERMINAL_RUN_STATUSES = new Set(["completed", "failed", "canceled"]);

function validEntry(value: unknown): value is RememberedHistoryAccess {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<RememberedHistoryAccess>;
  return typeof entry.requestId === "string" && UUID_PATTERN.test(entry.requestId)
    && typeof entry.token === "string" && TOKEN_PATTERN.test(entry.token)
    && typeof entry.savedAt === "string" && !Number.isNaN(Date.parse(entry.savedAt));
}

export function parseRememberedHistoryAccess(value: string | null): RememberedHistoryAccess[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter(validEntry).slice(0, MAX_REMEMBERED_REQUESTS) : [];
  } catch {
    return [];
  }
}

export function readRememberedHistoryAccess(): RememberedHistoryAccess[] {
  try {
    return parseRememberedHistoryAccess(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return [];
  }
}

export function rememberHistoryAccess(access: { requestId: string; token: string }): void {
  if (!UUID_PATTERN.test(access.requestId) || !TOKEN_PATTERN.test(access.token)) return;
  try {
    const current = readRememberedHistoryAccess().filter((entry) => entry.requestId !== access.requestId);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([
      { ...access, savedAt: new Date().toISOString() },
      ...current,
    ].slice(0, MAX_REMEMBERED_REQUESTS)));
  } catch {
    // Storage can be unavailable in restricted browser modes. The server record remains durable.
  }
}

export function forgetHistoryAccess(requestId: string): void {
  try {
    const remaining = readRememberedHistoryAccess().filter((entry) => entry.requestId !== requestId);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(remaining));
  } catch {
    // Nothing else to do when browser storage is unavailable.
  }
}

export function shouldRefreshHistoryRun(run: { mode: string; status: string }): boolean {
  return run.mode === "live" && !TERMINAL_RUN_STATUSES.has(run.status);
}
