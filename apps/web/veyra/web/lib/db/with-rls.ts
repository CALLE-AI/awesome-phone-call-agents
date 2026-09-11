/**
 * Makes a direct Postgres connection behave, per-transaction, exactly like the
 * PostgREST connection Supabase's client normally gives a signed-in user — so the RLS
 * policies in web/supabase/schema.sql keep being the thing that enforces ownership,
 * not application code. See CLAUDE.md's Authentication section: "do not mistake
 * `.eq('user_id', ...)` for the thing doing the work" — that rule did not change just
 * because Drizzle replaced the query builder.
 *
 * How Supabase's `auth.uid()` actually resolves (see the `auth.uid()` function in the
 * project's Postgres): it reads the `request.jwt.claims` session setting PostgREST would
 * normally set from the verified JWT before running a query. A bare Postgres connection
 * never sets that, and by default runs as a role that either bypasses RLS entirely
 * (table owner / superuser) or has none of the `authenticated` grants — so without this
 * wrapper, Drizzle queries would either see every row regardless of owner, or none.
 *
 * `withRLS()` closes that gap inside one transaction:
 *   1. `set_config('request.jwt.claims', ..., true)` — makes `auth.uid()` resolve to
 *      this request's user id, scoped to the transaction (`true` = local).
 *   2. `set local role authenticated` — actually enables RLS for the transaction; the
 *      connecting role (Supabase's `postgres` user) can bypass RLS outright otherwise,
 *      and `to authenticated` policies only apply to a session that is that role.
 * Both settings revert automatically at COMMIT/ROLLBACK, so nothing leaks across the
 * connection pool between requests.
 *
 * Requires `DATABASE_URL` to be the Supabase `postgres` role's connection string —
 * that role is a member of `authenticated` by default on every Supabase project
 * specifically so this pattern works. A scoped/custom Postgres role would need that
 * grant added by hand.
 */

import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import { getDb } from "./client";
import type * as schema from "./schema";

type Schema = typeof schema;
export type RlsTx = Parameters<Parameters<PostgresJsDatabase<Schema>["transaction"]>[0]>[0];

export function withRLS<T>(userId: string, fn: (tx: RlsTx) => Promise<T>): Promise<T> {
  const db = getDb();

  return db.transaction(async (tx) => {
    const claims = JSON.stringify({ sub: userId, role: "authenticated" });
    await tx.execute(sql`select set_config('request.jwt.claims', ${claims}, true)`);
    await tx.execute(sql`set local role authenticated`);
    return fn(tx);
  });
}
