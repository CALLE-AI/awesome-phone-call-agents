import {
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
  createHash,
} from 'node:crypto';
import { promisify } from 'node:util';
import type { Request, Response } from 'express';
import type { Store } from './store';
const scrypt = promisify(scryptCallback);
export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
export interface User {
  id: string;
  name: string;
  email: string | null;
  guest: boolean;
}
export interface Auth {
  user: User;
  csrf: string;
  tokenHash: string;
}
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const key = (await scrypt(password, salt, 64)) as Buffer;
  return `${salt}:${key.toString('hex')}`;
}
export async function verifyPassword(password: string, stored: string) {
  const [salt, hash] = stored.split(':');
  const key = (await scrypt(password, salt, 64)) as Buffer;
  const expected = Buffer.from(hash, 'hex');
  return key.length === expected.length && timingSafeEqual(key, expected);
}
export function makeSession(store: Store, res: Response, user: User): Auth {
  const token = randomBytes(32).toString('hex'),
    csrf = randomBytes(24).toString('hex'),
    tokenHash = sha256(token);
  store.db
    .prepare('INSERT INTO sessions VALUES(?,?,?,?)')
    .run(tokenHash, user.id, csrf, new Date(Date.now() + 7 * 86400000).toISOString());
  res.cookie('readycheck_session', token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production' && process.env.APP_ORIGIN?.startsWith('https:'),
    maxAge: 7 * 86400000,
    path: '/',
  });
  return { user, csrf, tokenHash };
}
export function getSession(store: Store, req: Request): Auth | null {
  const token = (req.headers.cookie || '')
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith('readycheck_session='))
    ?.split('=')[1];
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const tokenHash = sha256(token);
  const row = store.db
    .prepare(
      'SELECT u.id,u.name,u.email,u.guest,s.csrf FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?',
    )
    .get(tokenHash, new Date().toISOString());
  if (!row) return null;
  return {
    user: {
      id: String(row.id),
      name: String(row.name),
      email: row.email as string | null,
      guest: Boolean(row.guest),
    },
    csrf: String(row.csrf),
    tokenHash,
  };
}
export function createGuest(store: Store, res: Response): Auth {
  const user = { id: randomUUID(), name: 'Your workspace', email: null, guest: true };
  store.db
    .prepare('INSERT INTO users VALUES(?,?,?,?,?,?)')
    .run(user.id, null, user.name, null, 1, new Date().toISOString());
  return makeSession(store, res, user);
}
