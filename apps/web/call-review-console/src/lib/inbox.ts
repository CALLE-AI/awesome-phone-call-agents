import "server-only";

/**
 * Where webhook events land.
 *
 * One inbox is one Redis list. Push the event, trim to the last fifty, expire
 * the whole list after a day. The expiry is the reason this shape was picked:
 * nothing accumulates, and there is no cleanup job to write and then forget to
 * run.
 *
 * Spoken to over the REST API with plain fetch rather than a client library.
 * There are four commands here and a dependency would be more code than the
 * thing it wraps.
 */

const KEEP = 50;
const TTL_SECONDS = 60 * 60 * 24;

export interface Arrival {
  at: string;
  /** Exactly what was posted, before anything looked at it. */
  payload: unknown;
  /** Null when the payload could not be read, with `unreadable` saying why. */
  reading: { disposition: unknown; spoken: unknown } | null;
  unreadable: string | null;
}

interface Credentials {
  url: string;
  token: string;
}

/**
 * The Vercel Upstash integration injects the KV_ names. A hand-rolled Upstash
 * project injects the UPSTASH_ ones. Both are the same REST API, so take
 * whichever is there and do not make anybody rename an environment variable.
 */
function credentials(): Credentials | null {
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL ?? "";
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN ?? "";
  if (url === "" || token === "") return null;
  return { url: url.replace(/\/+$/, ""), token };
}

export function isWired(): boolean {
  return credentials() !== null;
}

async function command(body: unknown): Promise<unknown> {
  const creds = credentials();
  if (creds === null) throw new Error("No Redis credentials in the environment.");

  const response = await fetch(`${creds.url}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${creds.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Redis answered ${response.status}.`);
  }
  return response.json();
}

function key(inbox: string): string {
  return `asheard:inbox:${inbox}`;
}

export async function push(inbox: string, arrival: Arrival): Promise<void> {
  await command([
    ["LPUSH", key(inbox), JSON.stringify(arrival)],
    ["LTRIM", key(inbox), 0, KEEP - 1],
    ["EXPIRE", key(inbox), TTL_SECONDS],
  ]);
}

export async function read(inbox: string): Promise<Arrival[]> {
  const raw = (await command([["LRANGE", key(inbox), 0, KEEP - 1]])) as Array<{
    result?: string[];
  }>;

  const rows = raw[0]?.result ?? [];
  return rows.flatMap((row) => {
    try {
      return [JSON.parse(row) as Arrival];
    } catch {
      // A row that will not parse is a row somebody else wrote. Skip it rather
      // than taking the whole inbox down with it.
      return [];
    }
  });
}

/**
 * Is this a plausible inbox name?
 *
 * The id is the only thing standing between an inbox and the whole internet,
 * so it has to be long and it has to be boring. Anything that is not thirty two
 * hex characters is refused before it reaches Redis, which also keeps hand
 * written keys out of the keyspace.
 */
export function isInboxId(value: string): boolean {
  return /^[0-9a-f]{32}$/.test(value);
}
