/**
 * The one place that talks to Redis.
 *
 * Two things in this app need durable state that survives a cold start: the
 * call budget and the intent ledger. Both used to be free to invent their own
 * transport. One transport means one place where a credential is read, one
 * place where a failure is shaped, and no chance of the two disagreeing about
 * whether the store is reachable.
 */

interface Credentials {
  url: string;
  token: string;
}

function credentials(): Credentials | null {
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL ?? "";
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN ?? "";
  return url !== "" && token !== "" ? { url, token } : null;
}

/** Whether this deployment has a store at all. Callers fail closed without one. */
export function redisConfigured(): boolean {
  return credentials() !== null;
}

/**
 * Run a pipeline and hand back one result per command.
 *
 * Throws on anything that is not a clean run, including a per-command error
 * buried in a 200 response. A caller that cannot tell a failed write from a
 * successful one is a caller that will dial a phone twice.
 */
export async function pipeline(commands: unknown[][]): Promise<unknown[]> {
  const creds = credentials();
  if (creds === null) throw new Error("No Redis credentials in the environment.");

  const response = await fetch(`${creds.url}/pipeline`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${creds.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(commands),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Redis said ${response.status}.`);
  }
  const parsed = (await response.json()) as { result?: unknown; error?: string }[];
  return parsed.map((entry) => {
    if (entry.error) throw new Error(entry.error);
    return entry.result;
  });
}
