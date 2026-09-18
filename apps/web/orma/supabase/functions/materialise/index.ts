/**
 * T2.1 materialises the next 48 hours of calls from slots.
 *
 * A scheduler invokes this function nightly. It uses the service role because
 * call_runs are deliberately service-written under RLS. `ORMA_API_URL` is the
 * only Supabase origin used here, since the project host does not resolve on
 * every supported network.
 *
 * Pin the time conversion and duplicate handling with:
 * deno test --allow-env --allow-net supabase/functions/materialise/index.ts
 */

import { withSupabase } from "npm:@supabase/server@1.6.0";
import { type CallEventDetail, recordCallEvent } from "../_shared/events.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const HORIZON_MS = 48 * 60 * 60 * 1000;

export type Profile = {
  id: string;
  timezone: string;
};

export type Slot = {
  id: string;
  user_id: string;
  local_time: string;
  weekdays: number[];
  part_of_day: string;
  active: boolean;
};

export type MaterialisedRun = {
  user_id: string;
  slot_id: string;
  local_date: string;
  part_of_day: string;
  scheduled_for: string;
  idempotency_key: string;
};

export type MaterialiseDeps = {
  apiUrl: string;
  serviceRoleKey: string;
  fetch: typeof fetch;
  now: () => Date;
};

type LocalParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

export function requireNamedEnv(
  name: string,
  getEnv: (key: string) => string | undefined = (key) => Deno.env.get(key),
): string {
  const value = getEnv(name);
  if (!value) throw new Error(`missing ${name}`);
  return value;
}

export function depsFromEnv(
  getEnv: (key: string) => string | undefined = (key) => Deno.env.get(key),
  fetchImpl: typeof fetch = fetch,
): MaterialiseDeps {
  return {
    apiUrl: requireNamedEnv("ORMA_API_URL", getEnv),
    serviceRoleKey: requireNamedEnv("SUPABASE_SERVICE_ROLE_KEY", getEnv),
    fetch: fetchImpl,
    now: () => new Date(),
  };
}

function formatter(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
}

function localParts(instant: Date, timeZone: string): LocalParts {
  const parts = formatter(timeZone).formatToParts(instant);
  const values: Record<string, number> = {};
  for (const part of parts) {
    if (part.type !== "literal") values[part.type] = Number(part.value);
  }
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second,
  };
}

function equalParts(left: LocalParts, right: LocalParts): boolean {
  return left.year === right.year && left.month === right.month && left.day === right.day &&
    left.hour === right.hour && left.minute === right.minute && left.second === right.second;
}

function offsetAt(instant: Date, timeZone: string): number {
  const local = localParts(instant, timeZone);
  return Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second) -
    Math.floor(instant.getTime() / 1000) * 1000;
}

/** Converts a wall-clock date and time to its first real instant in a zone.
 * A skipped DST wall time has no real instant and returns null. A repeated wall
 * time resolves to its first occurrence, so a slot can never materialise twice.
 */
export function zonedDateTimeToInstant(localDate: string, localTime: string, timeZone: string): Date | null {
  const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate);
  const time = /^(\d{2}):(\d{2})(?::(\d{2}))?/.exec(localTime);
  if (!date || !time) throw new Error("invalid slot local time");
  const wanted: LocalParts = {
    year: Number(date[1]), month: Number(date[2]), day: Number(date[3]),
    hour: Number(time[1]), minute: Number(time[2]), second: Number(time[3] ?? "0"),
  };
  const wallMs = Date.UTC(wanted.year, wanted.month - 1, wanted.day, wanted.hour, wanted.minute, wanted.second);
  const probes = [wallMs - DAY_MS, wallMs, wallMs + DAY_MS];
  const matches = probes
    .map((probe) => new Date(wallMs - offsetAt(new Date(probe), timeZone)))
    .filter((candidate, index, all) =>
      equalParts(localParts(candidate, timeZone), wanted) &&
      all.findIndex((other) => other.getTime() === candidate.getTime()) === index,
    )
    .sort((left, right) => left.getTime() - right.getTime());
  return matches[0] ?? null;
}

function localDate(instant: Date, timeZone: string): string {
  const value = localParts(instant, timeZone);
  return `${String(value.year).padStart(4, "0")}-${String(value.month).padStart(2, "0")}-${String(value.day).padStart(2, "0")}`;
}

function datesBetween(start: string, end: string): string[] {
  const result: string[] = [];
  for (let cursor = new Date(`${start}T00:00:00.000Z`), finish = new Date(`${end}T00:00:00.000Z`);
    cursor <= finish;
    cursor = new Date(cursor.getTime() + DAY_MS)) {
    result.push(cursor.toISOString().slice(0, 10));
  }
  return result;
}

function isoWeekday(date: string): number {
  const value = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  return value === 0 ? 7 : value;
}

export function idempotencyKey(userId: string, localDateValue: string, partOfDay: string): string {
  return `orma:${userId}:${localDateValue}:${partOfDay}:v1`;
}

export function runsForSlot(slot: Slot, profile: Profile, now: Date): MaterialisedRun[] {
  const until = new Date(now.getTime() + HORIZON_MS);
  const dates = datesBetween(
    localDate(new Date(now.getTime() - DAY_MS), profile.timezone),
    localDate(new Date(until.getTime() + DAY_MS), profile.timezone),
  );
  return dates.flatMap((date) => {
    if (!slot.weekdays.includes(isoWeekday(date))) return [];
    const instant = zonedDateTimeToInstant(date, slot.local_time, profile.timezone);
    if (instant === null || instant < now || instant >= until) return [];
    return [{
      user_id: slot.user_id,
      slot_id: slot.id,
      local_date: date,
      part_of_day: slot.part_of_day,
      scheduled_for: instant.toISOString(),
      idempotency_key: idempotencyKey(slot.user_id, date, slot.part_of_day),
    }];
  });
}

function serviceHeaders(key: string, prefer?: string): HeadersInit {
  const headers: Record<string, string> = {
    apikey: key,
    authorization: `Bearer ${key}`,
    "content-type": "application/json",
  };
  if (prefer) headers.prefer = prefer;
  return headers;
}

function restUrl(base: string, path: string, query = ""): string {
  return `${base.replace(/\/+$/, "")}/rest/v1/${path}${query ? `?${query}` : ""}`;
}

async function readRows<T>(deps: MaterialiseDeps, path: string, query: string): Promise<T[]> {
  const response = await deps.fetch(restUrl(deps.apiUrl, path, query), {
    headers: serviceHeaders(deps.serviceRoleKey),
  });
  if (!response.ok) throw new Error(`${path} read failed`);
  return await response.json() as T[];
}

async function removeFutureRuns(deps: MaterialiseDeps, slotId: string, now: Date): Promise<void> {
  const query = new URLSearchParams({
    slot_id: `eq.${slotId}`,
    state: "eq.scheduled",
    scheduled_for: `gt.${now.toISOString()}`,
  }).toString();
  const response = await deps.fetch(restUrl(deps.apiUrl, "call_runs", query), {
    method: "DELETE",
    headers: serviceHeaders(deps.serviceRoleKey),
  });
  if (!response.ok) throw new Error("future call_runs delete failed");
}

/** A run row PostgREST returned, which only carries rows it really inserted. */
type InsertedRun = MaterialisedRun & { id: string };

/**
 * Inserts the candidates and returns the rows the database actually created.
 * A duplicate idempotency key is ignored, so it is absent from this result and
 * gains no timeline row.
 */
async function insertRuns(deps: MaterialiseDeps, runs: MaterialisedRun[]): Promise<InsertedRun[]> {
  if (runs.length === 0) return [];
  // `on_conflict` names the unique key the ignore applies to. Without it
  // PostgREST targets the primary key, which never conflicts, and a repeat run
  // fails on the idempotency key instead of being ignored.
  const response = await deps.fetch(
    restUrl(deps.apiUrl, "call_runs", "on_conflict=idempotency_key"),
    {
      method: "POST",
      headers: serviceHeaders(deps.serviceRoleKey, "resolution=ignore-duplicates,return=representation"),
      body: JSON.stringify(runs),
    },
  );
  if (!response.ok) throw new Error("call_runs insert failed");
  return await response.json() as InsertedRun[];
}

/**
 * What an operator reads to explain why this run exists. The slot and the
 * instant are the two facts the materialiser decided, and both are durable.
 */
function materialisedDetail(run: InsertedRun): CallEventDetail {
  return {
    slot_id: run.slot_id,
    local_date: run.local_date,
    part_of_day: run.part_of_day,
    scheduled_for: run.scheduled_for,
  };
}

export async function materialise(deps: MaterialiseDeps): Promise<{ candidates: number }> {
  const now = deps.now();
  const [profiles, slots] = await Promise.all([
    readRows<Profile>(deps, "profiles", "select=id,timezone"),
    readRows<Slot>(deps, "slots", "select=id,user_id,local_time,weekdays,part_of_day,active"),
  ]);
  const profilesById = new Map(profiles.map((profile) => [profile.id, profile]));
  await Promise.all(slots.filter((slot) => !slot.active).map((slot) => removeFutureRuns(deps, slot.id, now)));
  const runs = slots.flatMap((slot) => {
    if (!slot.active) return [];
    const profile = profilesById.get(slot.user_id);
    if (!profile) throw new Error("slot profile missing");
    return runsForSlot(slot, profile, now);
  });
  const inserted = await insertRuns(deps, runs);
  // Only after the insert commits, because a materialise that fails must not
  // leave a timeline claiming a run that no slot produced.
  for (const run of inserted) {
    await recordCallEvent(run.id, "materialised", materialisedDetail(run), deps);
  }
  return { candidates: runs.length };
}

export function createMaterialiseHandler(deps: MaterialiseDeps): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.method !== "POST") return new Response(null, { status: 405, headers: { allow: "POST" } });
    try {
      return Response.json(await materialise(deps));
    } catch (error) {
      console.error("materialise failed", error instanceof Error ? error.message : "unknown error");
      return new Response(null, { status: 500 });
    }
  };
}

export function createAuthenticatedMaterialiseHandler(
  deps: MaterialiseDeps,
): (request: Request) => Promise<Response> {
  return withSupabase({ auth: "secret:materialise" }, createMaterialiseHandler(deps));
}

if (import.meta.main) Deno.serve(createAuthenticatedMaterialiseHandler(depsFromEnv()));

const testFn = (Deno as { test?: (name: string, fn: () => void | Promise<void>) => void }).test;
if (typeof testFn === "function" && !import.meta.main) {
  const profile: Profile = { id: "00000000-0000-4000-8000-000000000001", timezone: "Asia/Kolkata" };
  const slot: Slot = {
    id: "00000000-0000-4000-8000-000000000002", user_id: profile.id, local_time: "08:00:00",
    weekdays: [1, 2, 3, 4, 5, 6, 7], part_of_day: "morning", active: true,
  };

  testFn("Asia/Kolkata 08:00 materialises at 02:30 UTC", () => {
    const runs = runsForSlot(slot, profile, new Date("2026-09-12T00:00:00.000Z"));
    if (runs[0]?.scheduled_for !== "2026-09-12T02:30:00.000Z") throw new Error("incorrect Kolkata instant");
    if (runs[0]?.idempotency_key !== `orma:${profile.id}:2026-09-12:morning:v1`) {
      throw new Error("incorrect durable idempotency key");
    }
  });

  testFn("a repeated DST wall time selects one first occurrence", () => {
    const instant = zonedDateTimeToInstant("2026-11-01", "01:30:00", "America/New_York");
    if (instant?.toISOString() !== "2026-11-01T05:30:00.000Z") throw new Error("must choose first repeated instant");
  });

  testFn("a skipped DST wall time does not invent a run", () => {
    if (zonedDateTimeToInstant("2026-03-08", "02:30:00", "America/New_York") !== null) {
      throw new Error("skipped wall time must have no instant");
    }
  });

  testFn("a second materialisation relies on the durable key and creates no duplicate", async () => {
    const stored = new Map<string, MaterialisedRun>();
    const events: Array<{ call_run_id: string; kind: string }> = [];
    const requests: Array<{ method: string; url: URL }> = [];
    let minted = 0;
    const fetchStub: typeof fetch = async (input, init = {}) => {
      const url = new URL(String(input));
      const method = init.method ?? "GET";
      requests.push({ method, url });
      if (url.pathname.endsWith("/profiles")) return Response.json([profile]);
      if (url.pathname.endsWith("/slots")) return Response.json([slot]);
      if (url.pathname.endsWith("/call_runs") && method === "POST") {
        const rows = JSON.parse(String(init.body)) as MaterialisedRun[];
        // PostgREST only ignores a conflict it was told the arbiter for. A
        // request without `on_conflict` targets the primary key, so a repeat
        // row raises 23505 exactly as the real stack does.
        if (url.searchParams.get("on_conflict") !== "idempotency_key") {
          const duplicate = rows.some((row) => stored.has(row.idempotency_key));
          if (duplicate) return new Response(null, { status: 409 });
        }
        const created: InsertedRun[] = [];
        for (const row of rows) {
          if (stored.has(row.idempotency_key)) continue;
          stored.set(row.idempotency_key, row);
          minted += 1;
          created.push({ ...row, id: `00000000-0000-4000-8000-${String(minted).padStart(12, "0")}` });
        }
        // PostgREST answers `ignore-duplicates` with only the rows it created.
        return Response.json(created);
      }
      if (url.pathname.endsWith("/call_events") && method === "POST") {
        events.push(JSON.parse(String(init.body)));
        return new Response(null, { status: 201 });
      }
      return new Response(null, { status: 500 });
    };
    const deps: MaterialiseDeps = {
      apiUrl: "https://orma-api.nryn.dev",
      serviceRoleKey: "test-service-key",
      fetch: fetchStub,
      now: () => new Date("2026-09-12T00:00:00.000Z"),
    };
    await materialise(deps);
    await materialise(deps);
    if (stored.size !== 2) throw new Error(`expected two horizon rows, got ${stored.size}`);
    const inserts = requests.filter(({ method, url }) => method === "POST" && url.pathname.endsWith("/call_runs"));
    if (inserts.length !== 2) throw new Error("each job invocation must submit its idempotent candidates");
    if (events.length !== 2) throw new Error(`an ignored duplicate records no event, got ${events.length}`);
    if (new Set(events.map((event) => event.call_run_id)).size !== 2) {
      throw new Error("each inserted run carries its own materialised event");
    }
  });

  testFn("materialise records one ordered event per inserted run, naming the slot and the instant", async () => {
    const events: Array<{ call_run_id: string; kind: string; detail: Record<string, unknown> }> = [];
    const insertedIds: string[] = [];
    const fetchStub: typeof fetch = async (input, init = {}) => {
      const url = new URL(String(input));
      const method = init.method ?? "GET";
      if (url.pathname.endsWith("/profiles")) return Response.json([profile]);
      if (url.pathname.endsWith("/slots")) return Response.json([slot]);
      if (url.pathname.endsWith("/call_runs") && method === "POST") {
        const rows = JSON.parse(String(init.body)) as MaterialisedRun[];
        return Response.json(rows.map((row, index) => {
          const id = `00000000-0000-4000-8000-00000000001${index}`;
          insertedIds.push(id);
          return { ...row, id };
        }));
      }
      if (url.pathname.endsWith("/call_events") && method === "POST") {
        events.push(JSON.parse(String(init.body)));
        return new Response(null, { status: 201 });
      }
      return new Response(null, { status: 500 });
    };
    const result = await materialise({
      apiUrl: "https://orma-api.nryn.dev", serviceRoleKey: "test-service-key", fetch: fetchStub,
      now: () => new Date("2026-09-12T00:00:00.000Z"),
    });
    if (insertedIds.length !== 2) throw new Error(`expected two horizon rows, got ${insertedIds.length}`);
    if (events.length !== result.candidates) {
      throw new Error(`one event per inserted run, got ${events.length} for ${result.candidates}`);
    }
    if (events.some((event) => event.kind !== "materialised")) {
      throw new Error("an inserted run must record a materialised event");
    }
    if (events.map((event) => event.call_run_id).join(",") !== insertedIds.join(",")) {
      throw new Error("the events must follow the inserted rows in order");
    }
    const detail = events[0].detail;
    if (detail.slot_id !== slot.id) throw new Error(`the event must name the slot, got ${detail.slot_id}`);
    if (detail.scheduled_for !== "2026-09-12T02:30:00.000Z") {
      throw new Error(`the event must name the instant, got ${detail.scheduled_for}`);
    }
    if (detail.local_date !== "2026-09-12" || detail.part_of_day !== "morning") {
      throw new Error("the event must name the local date and the part of day");
    }
  });

  testFn("a failed call_runs insert records no materialised event", async () => {
    let events = 0;
    const fetchStub: typeof fetch = async (input, init = {}) => {
      const url = new URL(String(input));
      const method = init.method ?? "GET";
      if (url.pathname.endsWith("/profiles")) return Response.json([profile]);
      if (url.pathname.endsWith("/slots")) return Response.json([slot]);
      if (url.pathname.endsWith("/call_runs") && method === "POST") {
        return new Response(null, { status: 500 });
      }
      if (url.pathname.endsWith("/call_events")) {
        events += 1;
        return new Response(null, { status: 201 });
      }
      return new Response(null, { status: 500 });
    };
    let surfaced = "";
    try {
      await materialise({
        apiUrl: "https://orma-api.nryn.dev", serviceRoleKey: "test-service-key", fetch: fetchStub,
        now: () => new Date("2026-09-12T00:00:00.000Z"),
      });
    } catch (error) {
      surfaced = error instanceof Error ? error.message : "unknown";
    }
    if (surfaced !== "call_runs insert failed") {
      throw new Error(`a failed insert must surface, got ${surfaced}`);
    }
    if (events !== 0) throw new Error(`a failed insert records no event, recorded ${events}`);
  });

  testFn("deactivating a slot deletes scheduled future runs and nothing else", async () => {
    const inactive = { ...slot, active: false };
    let deletedQuery = "";
    const fetchStub: typeof fetch = async (input, init = {}) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/profiles")) return Response.json([profile]);
      if (url.pathname.endsWith("/slots")) return Response.json([inactive]);
      if (url.pathname.endsWith("/call_runs") && init.method === "DELETE") {
        deletedQuery = url.search;
        return new Response(null, { status: 204 });
      }
      return new Response(null, { status: 500 });
    };
    await materialise({
      apiUrl: "https://orma-api.nryn.dev", serviceRoleKey: "test-service-key", fetch: fetchStub,
      now: () => new Date("2026-09-12T00:00:00.000Z"),
    });
    const query = new URLSearchParams(deletedQuery);
    if (query.get("slot_id") !== `eq.${slot.id}` || query.get("state") !== "eq.scheduled" ||
      query.get("scheduled_for") !== "gt.2026-09-12T00:00:00.000Z") {
      throw new Error("deactivation must delete only scheduled future rows for that slot");
    }
  });

  testFn("only the named materialise secret API key reaches materialisation", async () => {
    const oldUrl = Deno.env.get("SUPABASE_URL");
    const oldKeys = Deno.env.get("SUPABASE_SECRET_KEYS");
    const oldPublishableKeys = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");
    Deno.env.set("SUPABASE_URL", "https://orma-api.nryn.dev");
    Deno.env.set("SUPABASE_SECRET_KEYS", JSON.stringify({ materialise: "fixture-materialise-key" }));
    Deno.env.set("SUPABASE_PUBLISHABLE_KEYS", JSON.stringify({ default: "fixture-publishable-key" }));
    let reads = 0;
    const handler = createAuthenticatedMaterialiseHandler({
      apiUrl: "https://orma-api.nryn.dev",
      serviceRoleKey: "test-service-key",
      fetch: async () => {
        reads += 1;
        return Response.json([]);
      },
      now: () => new Date("2026-09-12T00:00:00.000Z"),
    });
    try {
      const rejected = await handler(new Request("https://orma-api.nryn.dev/functions/v1/materialise", { method: "POST" }));
      if (rejected.status !== 401 || reads !== 0) throw new Error("missing secret must not reach materialisation");
      const accepted = await handler(new Request("https://orma-api.nryn.dev/functions/v1/materialise", {
        method: "POST", headers: { apikey: "fixture-materialise-key" },
      }));
      if (accepted.status !== 200 || Number(reads) !== 2) {
        throw new Error("named materialise secret must authenticate the scheduler");
      }
    } finally {
      if (oldUrl === undefined) Deno.env.delete("SUPABASE_URL"); else Deno.env.set("SUPABASE_URL", oldUrl);
      if (oldKeys === undefined) Deno.env.delete("SUPABASE_SECRET_KEYS"); else Deno.env.set("SUPABASE_SECRET_KEYS", oldKeys);
      if (oldPublishableKeys === undefined) Deno.env.delete("SUPABASE_PUBLISHABLE_KEYS");
      else Deno.env.set("SUPABASE_PUBLISHABLE_KEYS", oldPublishableKeys);
    }
  });
}
