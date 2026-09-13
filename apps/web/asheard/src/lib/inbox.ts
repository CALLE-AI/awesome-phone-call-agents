import "server-only";

import type { PublicCallView } from "asheard/reconciler";

import { pipeline } from "@/lib/redis";

/**
 * Where webhook arrivals land.
 *
 * One inbox is one Redis list. Push, trim to the last fifty, expire the whole
 * list after a day, so nothing piles up and there is no cleanup job to forget.
 *
 * What gets stored is never the delivery. It is the call as CALL-E reports it
 * when the server fetches it by id, reduced to the allowlisted projection, or a
 * sentence saying why there was nothing to fetch.
 */

const KEEP = 50;
const TTL_SECONDS = 60 * 60 * 24;

export interface Arrival {
  at: string;
  /** From CALL-E's event id header, when present. Display only. */
  eventId: string | null;
  /** The call the delivery pointed at, or null when it pointed at nothing usable. */
  callId: string | null;
  /** The call as fetched from CALL-E, projected. Never the posted body. */
  call: PublicCallView | null;
  reading: { disposition: unknown; spoken: unknown } | null;
  /** Why there is no reading, in a sentence. */
  problem: string | null;
}

export function isWired(): boolean {
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL ?? "";
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN ?? "";
  return url !== "" && token !== "";
}

function key(inbox: string): string {
  return `asheard:inbox:v2:${inbox}`;
}

export async function push(inbox: string, arrival: Arrival): Promise<void> {
  await pipeline([
    ["LPUSH", key(inbox), JSON.stringify(arrival)],
    ["LTRIM", key(inbox), 0, KEEP - 1],
    ["EXPIRE", key(inbox), TTL_SECONDS],
  ]);
}

export async function read(inbox: string): Promise<Arrival[]> {
  const [result] = await pipeline([["LRANGE", key(inbox), 0, KEEP - 1]]);
  const rows = Array.isArray(result) ? (result as string[]) : [];
  return rows.flatMap((row) => {
    try {
      return [JSON.parse(row) as Arrival];
    } catch {
      return [];
    }
  });
}
