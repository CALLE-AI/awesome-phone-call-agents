import { randomUUID } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { ClaimLineApp } from "../app.js";

export type Role = "owner" | "guest";

export interface Session {
  role: Role;
  /** Guest's own CALL-E API key (session-only, never persisted). Null for owner. */
  apiKey: string | null;
  /** Guest session id, used for logout cleanup. Absent for owner. */
  guestId?: string | null;
}

const COOKIE = "claimline_sid";
const MAX_AGE_MS = 1000 * 60 * 60 * 8; // 8h

/**
 * Guest key store. Only GUEST API keys live here (in-memory, never persisted or
 * placed in a cookie, since the key is a secret).
 *
 * OWNER sessions are intentionally STATELESS: the signed cookie itself proves
 * ownership, so an owner stays logged in across a server restart or redeploy
 * (the owner carries no secret — they place calls on the server's key). The
 * cookie is signed with CLAIMLINE_SESSION_SECRET, so it cannot be forged.
 */
export class SessionStore {
  private readonly guests = new Map<
    string,
    { apiKey: string | null; createdAt: number }
  >();

  createGuest(apiKey: string | null): string {
    const id = randomUUID();
    this.guests.set(id, { apiKey, createdAt: Date.now() });
    return id;
  }

  getGuest(id: string | undefined | null): { apiKey: string | null } | null {
    if (!id) return null;
    const g = this.guests.get(id);
    if (!g) return null;
    if (Date.now() - g.createdAt > MAX_AGE_MS) {
      this.guests.delete(id);
      return null;
    }
    return { apiKey: g.apiKey };
  }

  destroyGuest(id: string): void {
    this.guests.delete(id);
  }
}

/** Read and verify the signed session cookie, returning the Session or null. */
export function sessionFromRequest(
  req: FastifyRequest,
  store: SessionStore,
): Session | null {
  const raw = req.cookies?.[COOKIE];
  if (!raw) return null;
  const unsigned = req.unsignCookie(raw);
  if (!unsigned.valid || !unsigned.value) return null;
  const value = unsigned.value;

  // Owner: stateless "o.<issuedAtMs>" — valid until it ages out.
  if (value.startsWith("o.")) {
    const iat = Number.parseInt(value.slice(2), 10);
    if (!Number.isFinite(iat) || Date.now() - iat > MAX_AGE_MS) return null;
    return { role: "owner", apiKey: null };
  }
  // Guest: "g.<id>" pointing at an in-memory key entry.
  if (value.startsWith("g.")) {
    const id = value.slice(2);
    const g = store.getGuest(id);
    if (!g) return null;
    return { role: "guest", apiKey: g.apiKey, guestId: id };
  }
  return null;
}

function setCookie(reply: FastifyReply, value: string): void {
  reply.setCookie(COOKIE, value, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    signed: true,
    maxAge: Math.floor(MAX_AGE_MS / 1000),
  });
}

/** Start an owner session (stateless; survives server restarts). */
export function setOwnerCookie(reply: FastifyReply): void {
  setCookie(reply, `o.${Date.now()}`);
}

/** Start a guest session bound to an in-memory key entry. */
export function setGuestCookie(reply: FastifyReply, guestId: string): void {
  setCookie(reply, `g.${guestId}`);
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(COOKIE, { path: "/" });
}

/** The CALL-E API key this session may use: owner→server key, guest→own key. */
export function effectiveKey(
  app: ClaimLineApp,
  session: Session | null,
): string | null {
  if (!session) return null;
  return session.role === "owner" ? app.config.calleApiKey : session.apiKey;
}

/** The placed_by tag for calls made by this session. */
export function placedBy(app: ClaimLineApp, session: Session | null): string {
  if (app.config.mode === "fixture") return "fixture";
  return session?.role === "owner" ? "owner" : "guest";
}

/** Verify owner credentials. Owner login is disabled when no password is set. */
export function checkOwner(
  app: ClaimLineApp,
  username: string,
  password: string,
): boolean {
  const { ownerUser, ownerPass } = app.config;
  if (!ownerPass) return false;
  return username === ownerUser && password === ownerPass;
}
