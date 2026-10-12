import bcrypt from 'bcryptjs';
import { nanoid } from 'nanoid';
import { db } from '../lib/db.js';
import { now } from '../lib/util.js';
import { env } from '../lib/env.js';

export interface UserRecord {
  id: string;
  email: string;
  password_hash: string;
  name: string;
  default_language: string;
  default_region: string;
  quiet_hours_start: number;
  quiet_hours_end: number;
  transcript_retention: number;
  consent_snapshot: string | null;
  created_at: number;
  updated_at: number;
}

export async function hashPassword(p: string) {
  return bcrypt.hash(p, 12);
}
export async function verifyPassword(p: string, hash: string) {
  return bcrypt.compare(p, hash);
}

export function createUser(input: { email: string; name: string; password?: string }) {
  const id = `usr_${nanoid(16)}`;
  const t = now();
  db.prepare(
    `INSERT INTO users (id, email, password_hash, name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, input.email.toLowerCase(), '', input.name, t, t);
  db.prepare(`INSERT INTO workspaces (id, user_id, name, created_at) VALUES (?, ?, ?, ?)`).run(
    `wsp_${nanoid(16)}`,
    id,
    'Personal',
    t,
  );
  return getUser(id);
}

export function getUser(id: string): UserRecord | undefined {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRecord | undefined;
}
export function getUserByEmail(email: string): UserRecord | undefined {
  return db
    .prepare('SELECT * FROM users WHERE email = ?')
    .get(email.toLowerCase()) as UserRecord | undefined;
}

export async function setPassword(userId: string, password: string) {
  const h = await hashPassword(password);
  db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(
    h,
    now(),
    userId,
  );
}

export function setConsent(userId: string, snapshot: object) {
  db.prepare('UPDATE users SET consent_snapshot = ?, updated_at = ? WHERE id = ?').run(
    JSON.stringify(snapshot),
    now(),
    userId,
  );
}

export function addAuthorizedNumber(userId: string, e164: string, label?: string) {
  const id = `num_${nanoid(16)}`;
  db.prepare(
    `INSERT OR IGNORE INTO authorized_numbers (id, user_id, e164, label, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, userId, e164, label ?? null, now());
  return id;
}
export function listAuthorizedNumbers(userId: string) {
  return db
    .prepare('SELECT * FROM authorized_numbers WHERE user_id = ? ORDER BY created_at DESC')
    .all(userId);
}
export function removeAuthorizedNumber(userId: string, id: string) {
  db.prepare('DELETE FROM authorized_numbers WHERE id = ? AND user_id = ?').run(id, userId);
}

/** Refresh token bookkeeping (used by /auth/refresh + /auth/logout). */
export function issueRefresh(userId: string) {
  const jti = `rt_${nanoid(24)}`;
  const issued = now();
  const expires = issued + parseTtlMs(env.JWT_REFRESH_TTL);
  db.prepare(
    'INSERT INTO refresh_tokens (jti, user_id, issued_at, expires_at) VALUES (?, ?, ?, ?)',
  ).run(jti, userId, issued, expires);
  return { jti, issued, expires };
}
export function revokeRefresh(jti: string) {
  db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE jti = ?').run(jti);
}
export function findRefresh(jti: string) {
  return db.prepare('SELECT * FROM refresh_tokens WHERE jti = ?').get(jti) as
    | { jti: string; user_id: string; expires_at: number; revoked: number }
    | undefined;
}

function parseTtlMs(ttl: string): number {
  const m = ttl.match(/^(\d+)\s*(ms|s|m|h|d)?$/);
  if (!m) return 30 * 24 * 3600 * 1000;
  const n = Number(m[1]);
  switch (m[2]) {
    case 'ms':
      return n;
    case 's':
      return n * 1000;
    case 'm':
      return n * 60_000;
    case 'h':
      return n * 3_600_000;
    case 'd':
    default:
      return n * 86_400_000;
  }
}
