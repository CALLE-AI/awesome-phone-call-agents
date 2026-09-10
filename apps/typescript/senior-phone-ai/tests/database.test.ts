import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const MIGRATION = new URL("../supabase/migrations/202609100001_initial_senior_phone_ai.sql", import.meta.url);
const SEED = new URL("../supabase/seed.sql", import.meta.url);

async function countRows(db: PGlite, table: string): Promise<number> {
  const result = await db.query<{ count: number }>(`select count(*)::integer as count from ${table}`);
  return result.rows[0]?.count ?? -1;
}

test("migration, seed, consent triggers and family RLS run in embedded PostgreSQL", async () => {
  const db = new PGlite({ extensions: { pgcrypto } });
  try {
    await db.exec(`
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin bypassrls;
      create schema extensions;
      create schema auth;
      create table auth.users (
        id uuid primary key,
        email text,
        raw_app_meta_data jsonb,
        raw_user_meta_data jsonb
      );
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
    `);
    await db.exec(await readFile(MIGRATION, "utf8"));
    await db.exec(await readFile(SEED, "utf8"));

    assert.equal(await countRows(db, "public.seniors"), 1);
    assert.equal(await countRows(db, "public.trusted_contacts"), 1);
    const noNumber = await db.query<{ destination_e164: string | null }>(
      "select destination_e164 from public.trusted_contacts",
    );
    assert.equal(noNumber.rows[0]?.destination_e164, null);

    await assert.rejects(db.exec(`
      insert into public.call_sessions (senior_id, correlation_id, direction, summary)
      values (
        '20000000-0000-4000-8000-000000000001',
        '30000000-0000-4000-8000-000000000001',
        'browser',
        'Summary without consent'
      );
    `), /summary consent is not active/);

    await db.exec(`
      set role authenticated;
      set "request.jwt.claim.sub" = '10000000-0000-4000-8000-000000000001';
    `);
    assert.equal(await countRows(db, "public.seniors"), 1);
    assert.equal(await countRows(db, "public.trusted_contacts"), 1);

    await db.exec("set \"request.jwt.claim.sub\" = '10000000-0000-4000-8000-000000000002'");
    assert.equal(await countRows(db, "public.seniors"), 0);
    assert.equal(await countRows(db, "public.trusted_contacts"), 0);

    await db.exec("reset role");
    const privileges = await db.query<{ invite_select: boolean; senior_insert: boolean }>(`
      select
        has_table_privilege('authenticated', 'public.membership_invites', 'SELECT') as invite_select,
        has_table_privilege('authenticated', 'public.seniors', 'INSERT') as senior_insert
    `);
    assert.equal(privileges.rows[0]?.invite_select, false);
    assert.equal(privileges.rows[0]?.senior_insert, false);
  } finally {
    await db.close();
  }
});
