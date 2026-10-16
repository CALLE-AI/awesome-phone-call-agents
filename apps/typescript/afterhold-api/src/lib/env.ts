import 'dotenv/config';
import crypto from 'node:crypto';
import { z } from 'zod';

const flag = (def: '0' | '1') =>
  z
    .union([z.literal('0'), z.literal('1'), z.literal('true'), z.literal('false')])
    .default(def)
    .transform((v) => v === '1' || v === 'true');

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8787),
  // Loopback by default. Binding to a public interface is an explicit choice.
  HOST: z.string().default('127.0.0.1'),
  APP_ORIGIN: z.string().default('http://localhost:8081'),
  DATABASE_FILE: z.string().default('./data/afterhold.db'),

  JWT_SECRET: z.string().default(''),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('30d'),

  // Mock (no-call) mode is the default. Live calls require CALLE_MOCK=0 plus a
  // per-run `confirm_live: true` on /start.
  CALLE_MOCK: flag('1'),
  CALLE_ENABLED: flag('1'),
  CALLE_API_KEY: z.string().default(''),
  CALLE_BASE_URL: z.string().default('https://api.heycall-e.com'),

  POLL_FIRST_DELAY_SEC: z.coerce.number().int().positive().default(60),
  POLL_INTERVAL_SEC: z.coerce.number().int().positive().default(8),

  RATE_LIMIT_PER_HOUR: z.coerce.number().int().positive().default(5),
  QUIET_HOURS_START: z.coerce.number().int().min(0).max(23).default(21),
  QUIET_HOURS_END: z.coerce.number().int().min(0).max(23).default(7),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

/** The only origins CALLE_API_KEY may ever be sent to. */
export const APPROVED_CALLE_ORIGINS: ReadonlySet<string> = new Set([
  'https://api.heycall-e.com',
  'https://test-api.heycall-e.com',
]);

/** Placeholder secrets that have appeared in public examples. Never accepted. */
const KNOWN_PUBLIC_SECRETS = new Set([
  'replace-me-with-32-bytes-of-random-hex',
  'changeme',
  'secret',
]);

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

function fail(msg: string): never {
  console.error(`Invalid environment configuration: ${msg}`);
  process.exit(1);
}

/** Returns the normalized origin, or exits if the URL is not an approved HTTPS origin. */
function approvedCalleOrigin(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    fail('CALLE_BASE_URL is not a valid URL.');
  }
  if (u.protocol !== 'https:') fail('CALLE_BASE_URL must use https.');
  if (u.username || u.password) fail('CALLE_BASE_URL must not contain credentials.');
  if ((u.pathname !== '/' && u.pathname !== '') || u.search || u.hash) {
    fail('CALLE_BASE_URL must be a bare origin (no path, query, or fragment).');
  }
  if (!APPROVED_CALLE_ORIGINS.has(u.origin)) {
    fail(`CALLE_BASE_URL origin is not approved. Allowed: ${[...APPROVED_CALLE_ORIGINS].join(', ')}`);
  }
  return u.origin;
}

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const raw = parsed.data;
const isLoopback = LOOPBACK_HOSTS.has(raw.HOST);
const isLive = !raw.CALLE_MOCK;

// JWT secret: a local mock run may use an ephemeral random secret. Anything that
// can place real calls or is reachable off this machine needs a real secret.
let jwtSecret = raw.JWT_SECRET;
if (KNOWN_PUBLIC_SECRETS.has(jwtSecret)) {
  fail('JWT_SECRET is a public example value. Generate one with `openssl rand -hex 32`.');
}
if (!jwtSecret) {
  if (isLive || !isLoopback) {
    fail('JWT_SECRET is required when CALLE_MOCK=0 or HOST is not loopback. Generate one with `openssl rand -hex 32`.');
  }
  jwtSecret = crypto.randomBytes(32).toString('hex');
  console.warn('[env] JWT_SECRET not set: using an ephemeral secret for this local mock run. Sessions reset on restart.');
} else if (jwtSecret.length < 32) {
  fail('JWT_SECRET must be at least 32 characters.');
}

const calleOrigin = approvedCalleOrigin(raw.CALLE_BASE_URL);
if (isLive && !raw.CALLE_API_KEY) fail('CALLE_API_KEY is required when CALLE_MOCK=0.');

export const env = { ...raw, JWT_SECRET: jwtSecret, CALLE_BASE_URL: calleOrigin };
export const isMock = env.CALLE_MOCK;
