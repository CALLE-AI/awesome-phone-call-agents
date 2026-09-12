import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { eq, and, gt, isNull } from 'drizzle-orm';
import { users, sessions, type Db } from '@dial/database';
import type { SessionUser } from '@dial/schemas';
import { ensureSettings, newId } from '@dial/orchestrator';

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

/**
 * Password hashing and sessions.
 *
 * scrypt from Node's own crypto rather than a native bcrypt/argon2 binding:
 * it is memory-hard, needs no compiler toolchain to install, and keeps the
 * deployment story simple. Parameters are the Node defaults with an explicit
 * 64-byte key and a 16-byte random salt per password.
 *
 * Sessions are opaque random tokens. Only their SHA-256 is stored, so a database
 * disclosure does not hand over usable sessions.
 */

const KEY_LENGTH = 64;
const SESSION_TTL_DAYS = 30;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, KEY_LENGTH);
  return `scrypt$${salt.toString('base64')}$${derived.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltB64, hashB64] = stored.split('$');
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;
  const salt = Buffer.from(saltB64, 'base64');
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scrypt(password, salt, expected.length);
  // Constant-time: a length mismatch must not short-circuit either.
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface CreatedSession {
  token: string;
  expiresAt: Date;
}

export async function createSession(db: Db, userId: string): Promise<CreatedSession> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  await db.insert(sessions).values({
    id: newId('sess'),
    userId,
    tokenHash: hashToken(token),
    expiresAt: expiresAt.toISOString(),
  });
  return { token, expiresAt };
}

export async function resolveSession(db: Db, token: string): Promise<SessionUser | null> {
  if (!token) return null;
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      createdAt: users.createdAt,
      deletedAt: users.deletedAt,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.tokenHash, hashToken(token)),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, new Date().toISOString()),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row || row.deletedAt) return null;
  return { id: row.id, email: row.email, name: row.name, createdAt: row.createdAt };
}

export async function revokeSession(db: Db, token: string): Promise<void> {
  await db
    .update(sessions)
    .set({ revokedAt: new Date().toISOString() })
    .where(eq(sessions.tokenHash, hashToken(token)));
}

export async function registerUser(
  db: Db,
  input: { email: string; password: string; name: string },
): Promise<SessionUser> {
  const email = input.email.trim().toLowerCase();
  const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existing.length) {
    const error = new Error('An account with that email already exists.') as Error & { statusCode: number };
    error.statusCode = 409;
    throw error;
  }

  const id = newId('usr');
  try {
    await db.insert(users).values({
      id,
      email,
      name: input.name.trim(),
      passwordHash: await hashPassword(input.password),
    });
  } catch (error) {
    // Two concurrent sign-ups both passed the existence check above; the
    // unique index settles it. Report that as the friendly conflict rather
    // than letting a raw driver error become a 500.
    if ((error as { code?: string }).code === '23505') {
      const conflict = new Error('An account with that email already exists.') as Error & {
        statusCode: number;
      };
      conflict.statusCode = 409;
      throw conflict;
    }
    throw error;
  }
  await ensureSettings(db, id);

  const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
  const row = rows[0]!;
  return { id: row.id, email: row.email, name: row.name, createdAt: row.createdAt };
}

export async function authenticate(
  db: Db,
  email: string,
  password: string,
): Promise<SessionUser | null> {
  const rows = await db
    .select()
    .from(users)
    .where(eq(users.email, email.trim().toLowerCase()))
    .limit(1);
  const row = rows[0];

  if (!row || row.deletedAt) {
    // Spend comparable time on a missing account so the response does not
    // reveal whether the email is registered.
    await hashPassword(password);
    return null;
  }
  if (!(await verifyPassword(password, row.passwordHash))) return null;
  return { id: row.id, email: row.email, name: row.name, createdAt: row.createdAt };
}
