/**
 * Structured logging + counters. Two rules this module exists to enforce:
 *  1. Secrets and phone numbers never reach a log line (section 25, section 29).
 *  2. Transcript content never reaches a general log line (section 29).
 * Both are handled by redaction on the way in, so a careless call site is safe.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** Keys whose values are replaced wholesale, wherever they appear. */
const REDACT_KEYS = new Set([
  'apikey',
  'api_key',
  'calle_api_key',
  'llm_api_key',
  'authorization',
  'password',
  'passwordhash',
  'password_hash',
  'token',
  'sessiontoken',
  'session_token',
  'secret',
  'sessionsecret',
  'encryptionkey',
  'cookie',
  'setcookie',
  'transcript',
  'transcriptturns',
  'transcript_turns',
  'rawbody',
]);

/** Keys holding phone numbers, which get masked rather than removed. */
const PHONE_KEYS = new Set(['phone', 'phonee164', 'phone_e164', 'phoneraw', 'phone_raw', 'to', 'recipient']);

export function maskPhone(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = String(value);
  if (trimmed.length <= 4) return '***';
  return `${trimmed.slice(0, 3)}***${trimmed.slice(-2)}`;
}

function redactValue(key: string, value: unknown, depth: number): unknown {
  const normalized = key.toLowerCase().replace(/[^a-z_]/g, '');
  if (REDACT_KEYS.has(normalized)) return '[redacted]';
  if (PHONE_KEYS.has(normalized) && typeof value === 'string') return maskPhone(value);
  return redact(value, depth + 1);
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[depth-limit]';
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redact(item, depth + 1));
  if (value instanceof Error) return { name: value.name, message: value.message };
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      out[key] = redactValue(key, child, depth);
    }
    return out;
  }
  return value;
}

export interface LogContext {
  /** Correlation IDs from section 29. */
  userId?: string;
  taskId?: string;
  candidateId?: string;
  callId?: string;
  providerRequestId?: string;
  [key: string]: unknown;
}

export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
  child(context: LogContext): Logger;
}

function emit(level: LogLevel, minLevel: LogLevel, message: string, context: LogContext): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) return;
  const line = {
    ts: new Date().toISOString(),
    level,
    msg: message,
    ...(redact(context) as Record<string, unknown>),
  };
  const serialized = JSON.stringify(line);
  if (level === 'error' || level === 'warn') process.stderr.write(`${serialized}\n`);
  else process.stdout.write(`${serialized}\n`);
}

export function createLogger(base: LogContext = {}, minLevel: LogLevel = 'info'): Logger {
  const make = (bound: LogContext): Logger => ({
    debug: (m, c) => emit('debug', minLevel, m, { ...bound, ...c }),
    info: (m, c) => emit('info', minLevel, m, { ...bound, ...c }),
    warn: (m, c) => emit('warn', minLevel, m, { ...bound, ...c }),
    error: (m, c) => emit('error', minLevel, m, { ...bound, ...c }),
    child: (c) => make({ ...bound, ...c }),
  });
  return make(base);
}

const envLevel = (process.env.LOG_LEVEL as LogLevel | undefined) ?? 'info';
export const logger: Logger = createLogger({}, LEVEL_ORDER[envLevel] ? envLevel : 'info');

/* ------------------------------------------------------------------ metrics */

type MetricKey = string;
const counters = new Map<MetricKey, number>();
const histograms = new Map<MetricKey, number[]>();

function key(name: string, labels: Record<string, string | number> = {}): MetricKey {
  const parts = Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`);
  return parts.length ? `${name}{${parts.join(',')}}` : name;
}

export function incrementCounter(
  name: string,
  labels: Record<string, string | number> = {},
  by = 1,
): void {
  const k = key(name, labels);
  counters.set(k, (counters.get(k) ?? 0) + by);
}

export function observe(name: string, valueMs: number, labels: Record<string, string | number> = {}): void {
  const k = key(name, labels);
  const bucket = histograms.get(k) ?? [];
  bucket.push(valueMs);
  // Bounded so a long-running worker cannot leak memory through metrics.
  if (bucket.length > 1000) bucket.shift();
  histograms.set(k, bucket);
}

export interface MetricsSnapshot {
  counters: Record<string, number>;
  histograms: Record<string, { count: number; p50: number; p95: number; max: number }>;
}

export function metricsSnapshot(): MetricsSnapshot {
  const hist: MetricsSnapshot['histograms'] = {};
  for (const [k, values] of histograms) {
    const sorted = [...values].sort((a, b) => a - b);
    const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0;
    hist[k] = { count: sorted.length, p50: at(0.5), p95: at(0.95), max: sorted[sorted.length - 1] ?? 0 };
  }
  return { counters: Object.fromEntries(counters), histograms: hist };
}

export function resetMetrics(): void {
  counters.clear();
  histograms.clear();
}

/** Times an async operation and records both duration and outcome. */
export async function timed<T>(
  name: string,
  labels: Record<string, string | number>,
  fn: () => Promise<T>,
): Promise<T> {
  const start = Date.now();
  try {
    const result = await fn();
    observe(`${name}.duration_ms`, Date.now() - start, { ...labels, outcome: 'ok' });
    incrementCounter(`${name}.total`, { ...labels, outcome: 'ok' });
    return result;
  } catch (error) {
    observe(`${name}.duration_ms`, Date.now() - start, { ...labels, outcome: 'error' });
    incrementCounter(`${name}.total`, { ...labels, outcome: 'error' });
    throw error;
  }
}
