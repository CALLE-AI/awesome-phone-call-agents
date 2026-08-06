import { queueConfigured, queueOperationalSnapshot, type QueueRuntimeEnv } from "./call-queue";
import { storeFor, type CalleEnv } from "./calls";
import { operatorConfigurationValid } from "./operator-auth";

const headers = { "cache-control": "no-store", "content-type": "application/json; charset=utf-8" };
const json = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), { status, headers });

function secureUrl(value: string | undefined): boolean {
  if (!value) return false;
  try { return new URL(value).protocol === "https:"; } catch { return false; }
}

function secretMatches(supplied: string, expected: string): boolean {
  let mismatch = supplied.length ^ expected.length;
  const length = Math.max(supplied.length, expected.length);
  for (let index = 0; index < length; index += 1) mismatch |= (supplied.charCodeAt(index) || 0) ^ (expected.charCodeAt(index) || 0);
  return mismatch === 0;
}

export function configurationChecks(env: CalleEnv & QueueRuntimeEnv): Record<string, boolean> {
  return {
    operator_auth: operatorConfigurationValid(env),
    durable_store: Boolean(env.durableStore || (secureUrl(env.UPSTASH_REDIS_REST_URL) && env.UPSTASH_REDIS_REST_TOKEN)),
    data_encryption: Boolean(env.CARECALL_DATA_ENCRYPTION_KEY && env.CARECALL_DATA_ENCRYPTION_KEY.length >= 32),
    call_provider: Boolean(env.CALLE_ACCESS_TOKEN && secureUrl(env.CALLE_SERVER_URL)),
    public_worker_url: secureUrl(env.CARECALL_PUBLIC_BASE_URL),
    queue_delivery: queueConfigured(env),
    queue_signatures: Boolean(env.queueVerifier || (env.QSTASH_CURRENT_SIGNING_KEY && env.QSTASH_NEXT_SIGNING_KEY)),
    reconciliation_auth: Boolean(env.CRON_SECRET && env.CRON_SECRET.length >= 32),
  };
}

/** Protected, read-only, and intentionally free of credential values and identifiers. */
export async function handleReadiness(request: Request, env: CalleEnv & QueueRuntimeEnv): Promise<Response> {
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!env.CRON_SECRET || !supplied || !secretMatches(supplied, env.CRON_SECRET)) return json({ error: "unauthorized_readiness" }, 401);
  if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);
  const checks = configurationChecks(env);
  const ready = Object.values(checks).every(Boolean);
  if (!checks.durable_store) return json({ ready: false, healthy: false, checks, operations: null }, 503);
  try {
    const operations = await queueOperationalSnapshot(env);
    return json({ ready, healthy: ready && operations.alerts.length === 0, checks, operations }, ready ? 200 : 503);
  } catch {
    return json({ ready: false, healthy: false, checks: { ...checks, durable_store: false }, operations: null }, 503);
  }
}
