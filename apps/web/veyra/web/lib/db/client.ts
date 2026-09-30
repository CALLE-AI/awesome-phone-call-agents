/**
 * Direct Postgres connection for Drizzle. Deliberately separate from
 * lib/supabase/{client,server}.ts — those talk to Supabase Auth (session cookies,
 * sign in/up/out) and PostgREST; this talks straight to the same Postgres database over
 * a real SQL connection, which is what Drizzle needs.
 *
 * Never import `getDb()` (or its result) directly in a route — RLS is not enforced on
 * this connection by itself. Every query must go through withRLS() in with-rls.ts,
 * which impersonates the requesting user inside a transaction before running it. See
 * that file for why, and TECHNICAL_ARCH.md's Authentication section for the RLS model
 * this exists to preserve.
 */

import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

let db: PostgresJsDatabase<typeof schema> | undefined;

export function getDb(): PostgresJsDatabase<typeof schema> {
  if (db) return db;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Use the Supabase project's Postgres connection string " +
        "for the `postgres` role (Project Settings -> Database -> Connection string). " +
        "See web/.env.example.",
    );
  }

  // prepare: false is required against Supabase's pooled connection (PgBouncer,
  // transaction mode) and is also the safer default here regardless: withRLS() depends
  // on `SET LOCAL` taking effect per-transaction, which does not mix well with
  // statement-level prepared-statement caching across the role switches it does.
  const client = postgres(connectionString, { prepare: false });
  db = drizzle(client, { schema });
  return db;
}
