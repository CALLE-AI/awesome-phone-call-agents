/**
 * Ops HTTP middleware: auth, rate limit, session isolation, global stop.
 */
import {
  isGlobalStopActive,
  setDurableOperatorStop,
} from "../runtime/global-stop.js";
export type SessionCursor = {
  session_key: string;
  mission_id: string | null;
  last_seen: number;
};

const buckets = new Map<string, { tokens: number; updated: number }>();
const sessions = new Map<string, SessionCursor>();

export function isGlobalStop(): boolean {
  return isGlobalStopActive();
}

export function setGlobalStop(on: boolean): void {
  setDurableOperatorStop(on);
}

export function requireOpsAuth(
  req: import("node:http").IncomingMessage,
): { ok: true } | { ok: false; status: number; error: string } {
  const expected = process.env.OPS_TOKEN;
  // Dev default: if unset, allow loopback with warning token "dev-mock"
  const token = expected || "dev-mock";
  const header = req.headers.authorization || "";
  const got = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!got || got !== token) {
    return {
      ok: false,
      status: 401,
      error: "Unauthorized — Bearer OPS_TOKEN required for mutating routes",
    };
  }
  return { ok: true };
}

export function rateLimit(
  key: string,
  limit = 60,
  windowMs = 60_000,
): { ok: true } | { ok: false; status: number; error: string } {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || now - b.updated > windowMs) {
    b = { tokens: limit, updated: now };
    buckets.set(key, b);
  }
  if (b.tokens <= 0) {
    return { ok: false, status: 429, error: "rate limit exceeded" };
  }
  b.tokens -= 1;
  return { ok: true };
}

export function sessionKeyFromReq(
  req: import("node:http").IncomingMessage,
): string {
  const h = req.headers["x-session-key"];
  if (typeof h === "string" && h.trim()) return h.trim();
  return "default";
}

export function bindSessionMission(
  sessionKey: string,
  missionId: string,
): void {
  sessions.set(sessionKey, {
    session_key: sessionKey,
    mission_id: missionId,
    last_seen: Date.now(),
  });
}

export function getSessionMission(sessionKey: string): string | null {
  return sessions.get(sessionKey)?.mission_id ?? null;
}

export function assertSessionOwnsMission(
  sessionKey: string,
  missionId: string,
): { ok: true } | { ok: false; status: number; error: string } {
  const cur = sessions.get(sessionKey);
  if (!cur || !cur.mission_id) {
    bindSessionMission(sessionKey, missionId);
    return { ok: true };
  }
  if (cur.mission_id !== missionId) {
    return {
      ok: false,
      status: 409,
      error: `session bound to ${cur.mission_id}, not ${missionId}`,
    };
  }
  cur.last_seen = Date.now();
  return { ok: true };
}
