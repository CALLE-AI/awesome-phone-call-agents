import { db } from '../lib/db.js';
import { env, isMock } from '../lib/env.js';
import { now } from '../lib/util.js';
import type { FastifyReply, FastifyRequest } from 'fastify';

export interface AuthedRequest extends FastifyRequest {
  userId: string;
}

/**
 * Server-side safety gates. Every gate MUST be checked inside the request
 * handler — never trust the iOS client to enforce these.
 */

export function ensureCalleEnabled() {
  if (!env.CALLE_ENABLED) {
    const e: any = new Error('CALL-E is currently disabled (CALLE_ENABLED=0).');
    e.statusCode = 503;
    throw e;
  }
}

export function isQuietHours(nowMs: number, start: number, end: number): boolean {
  // Wrap-around window (e.g. 21 → 7).
  const h = new Date(nowMs).getHours();
  if (start === end) return false;
  if (start < end) return h >= start && h < end;
  return h >= start || h < end;
}

export function ensureNotQuietHours(quietStart: number, quietEnd: number) {
  if (isQuietHours(now(), quietStart, quietEnd)) {
    const e: any = new Error('Quiet hours are in effect. Schedule for later instead.');
    e.statusCode = 429;
    throw e;
  }
}

export function ensureNumberAllowed(userId: string, e164: string) {
  if (isMock) return; // mock never dials a real line — skip allowlist check
  const row = db
    .prepare('SELECT 1 FROM authorized_numbers WHERE user_id = ? AND e164 = ?')
    .get(userId, e164);
  if (!row) {
    const e: any = new Error('Destination number is not on the allowlist.');
    e.statusCode = 403;
    throw e;
  }
}

export function ensureConsentGranted(userId: string) {
  const row = db
    .prepare('SELECT consent_snapshot FROM users WHERE id = ?')
    .get(userId) as { consent_snapshot: string | null } | undefined;
  if (!row?.consent_snapshot) {
    const e: any = new Error('Explicit consent is required before starting a call.');
    e.statusCode = 412;
    throw e;
  }
}

export function enforceRateLimit(userId: string) {
  const windowStart = now() - 60 * 60 * 1000;
  const used = (
    db.prepare('SELECT COUNT(*) AS n FROM rate_limit_log WHERE user_id = ? AND started_at >= ?')
      .get(userId, windowStart) as { n: number }
  ).n;
  if (used >= env.RATE_LIMIT_PER_HOUR) {
    const e: any = new Error('Rate limit reached. Try again later.');
    e.statusCode = 429;
    throw e;
  }
  db.prepare('INSERT INTO rate_limit_log (user_id, started_at) VALUES (?, ?)').run(userId, now());
}
