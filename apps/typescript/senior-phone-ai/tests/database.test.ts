import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const MIGRATION = new URL("../supabase/migrations/202609100001_initial_senior_phone_ai.sql", import.meta.url);
const SCHEDULER_MIGRATION = new URL("../supabase/migrations/202609110001_reminder_delivery_scheduler.sql", import.meta.url);
const POST_CALL_MIGRATION = new URL("../supabase/migrations/202609110002_post_call_finalization.sql", import.meta.url);
const DASHBOARD_MIGRATION = new URL("../supabase/migrations/202609110003_family_dashboard_management.sql", import.meta.url);
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
    await db.exec(await readFile(SCHEDULER_MIGRATION, "utf8"));
    await db.exec(await readFile(POST_CALL_MIGRATION, "utf8"));
    await db.exec(await readFile(DASHBOARD_MIGRATION, "utf8"));
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

    await db.exec(`
      insert into public.action_authorizations (
        id, senior_id, principal_user_id, action, destination_e164, purpose,
        state, expires_at, confirmed_at, consumed_at, created_at
      ) values (
        '60000000-0000-4000-8000-000000000001',
        '20000000-0000-4000-8000-000000000001',
        '10000000-0000-4000-8000-000000000001',
        'create_reminder', '+12025550123', 'Synthetic reminder', 'consumed',
        '2026-09-12T00:00:00Z', '2026-09-11T00:00:00Z', '2026-09-11T00:00:01Z',
        '2026-09-10T00:00:00Z'
      );
      insert into public.reminders (
        id, senior_id, authorization_id, principal_user_id, idempotency_key,
        destination_e164, message, timezone, scheduled_for, channel
      ) values (
        '70000000-0000-4000-8000-000000000001',
        '20000000-0000-4000-8000-000000000001',
        '60000000-0000-4000-8000-000000000001',
        '10000000-0000-4000-8000-000000000001',
        'reminder:database:one', '+12025550123', 'Synthetic reminder',
        'Australia/Sydney', '2026-09-11T00:10:00Z', 'call'
      );
    `);
    assert.equal(await countRows(db, "public.scheduled_deliveries"), 1);
    const claim = await db.query<{ claim: { state: string; reminder: { id: string } } }>(`
      select public.claim_due_reminder_delivery(
        '2026-09-11T00:11:00Z'::timestamptz, 900
      ) as claim
    `);
    assert.equal(claim.rows[0]?.claim.state, "claimed");
    assert.equal(claim.rows[0]?.claim.reminder.id, "70000000-0000-4000-8000-000000000001");
    const finish = await db.query<{ finished: boolean }>(`
      select public.finish_reminder_delivery(
        '70000000-0000-4000-8000-000000000001', 'completed', 'provider-safe'
      ) as finished
    `);
    assert.equal(finish.rows[0]?.finished, true);
    const state = await db.query<{ status: string }>(`
      select status::text from public.reminders
      where id = '70000000-0000-4000-8000-000000000001'
    `);
    assert.equal(state.rows[0]?.status, "completed");

    await db.exec(`
      update public.senior_memberships set role = 'owner'
      where senior_id = '20000000-0000-4000-8000-000000000001'
        and user_id = '10000000-0000-4000-8000-000000000001';
      insert into public.reminders (
        id, senior_id, authorization_id, principal_user_id, idempotency_key,
        destination_e164, message, timezone, scheduled_for, channel
      ) values (
        '70000000-0000-4000-8000-000000000002',
        '20000000-0000-4000-8000-000000000001',
        '60000000-0000-4000-8000-000000000001',
        '10000000-0000-4000-8000-000000000001',
        'reminder:database:two', '+12025550123', 'Cancelable reminder',
        'Australia/Sydney', '2026-09-12T00:10:00Z', 'sms'
      );
      set role authenticated;
      set "request.jwt.claim.sub" = '10000000-0000-4000-8000-000000000001';
      select public.manage_senior_profile(
        '20000000-0000-4000-8000-000000000001', 'Margaret',
        'Australia/Sydney', 'Inner Sydney'
      );
      select public.manage_senior_preferences(
        '20000000-0000-4000-8000-000000000001', false, true, 45
      );
    `);
    const canceled = await db.query<{ result: string }>(`
      select public.cancel_family_reminder(
        '20000000-0000-4000-8000-000000000001',
        '70000000-0000-4000-8000-000000000002'
      ) as result
    `);
    assert.equal(canceled.rows[0]?.result, "canceled");
    await db.exec("set \"request.jwt.claim.sub\" = '10000000-0000-4000-8000-000000000002'");
    await assert.rejects(db.exec(`
      select public.manage_senior_profile(
        '20000000-0000-4000-8000-000000000001', 'Changed',
        'Australia/Sydney', ''
      )
    `), /access denied/);
    await assert.rejects(db.exec(`
      select public.cancel_family_reminder(
        '20000000-0000-4000-8000-000000000001',
        '70000000-0000-4000-8000-000000000002'
      )
    `), /access denied/);
    await db.exec("reset role");

    await db.exec(`
      update public.senior_preferences
      set store_summaries = true, summary_sharing_consent_at = '2026-09-11T00:00:00Z'
      where senior_id = '20000000-0000-4000-8000-000000000001';
      insert into public.call_sessions (
        id, senior_id, correlation_id, direction, status, ended_at
      ) values (
        '30000000-0000-4000-8000-000000000010',
        '20000000-0000-4000-8000-000000000001',
        '30000000-0000-4000-8000-000000000011',
        'outbound', 'completed', '2026-09-11T01:00:00Z'
      );
    `);
    const finalization = await db.query<{ record: { smsStatus: string; summary: string } }>(`
      select public.reserve_post_call_finalization(
        '80000000-0000-4000-8000-000000000001',
        '20000000-0000-4000-8000-000000000001',
        '30000000-0000-4000-8000-000000000010',
        'call_database123', repeat('a', 64),
        'Call outcome: completed.', 'Senior Phone AI: Call outcome: completed.',
        '2026-09-11T01:01:00Z'
      ) as record
    `);
    assert.equal(finalization.rows[0]?.record.smsStatus, "not_requested");
    assert.equal(finalization.rows[0]?.record.summary, "Call outcome: completed.");
    assert.equal(await countRows(db, "public.post_call_finalizations"), 1);
    await db.exec(`
      set role authenticated;
      set "request.jwt.claim.sub" = '10000000-0000-4000-8000-000000000001';
    `);
    assert.equal(await countRows(db, "public.post_call_finalizations"), 1);
    await db.exec("set \"request.jwt.claim.sub\" = '10000000-0000-4000-8000-000000000002'");
    assert.equal(await countRows(db, "public.post_call_finalizations"), 0);
    await db.exec("reset role");
    const firstClaim = await db.query<{ result: { claimed: boolean; record: { smsStatus: string } } }>(`
      select public.claim_post_call_sms('80000000-0000-4000-8000-000000000001') as result
    `);
    const duplicateClaim = await db.query<{ result: { claimed: boolean; record: { smsStatus: string } } }>(`
      select public.claim_post_call_sms('80000000-0000-4000-8000-000000000001') as result
    `);
    assert.equal(firstClaim.rows[0]?.result.claimed, true);
    assert.equal(firstClaim.rows[0]?.result.record.smsStatus, "queued");
    assert.equal(duplicateClaim.rows[0]?.result.claimed, false);
    assert.equal(duplicateClaim.rows[0]?.result.record.smsStatus, "queued");
    await assert.rejects(db.exec(`
      select public.reserve_post_call_finalization(
        '80000000-0000-4000-8000-000000000002',
        '20000000-0000-4000-8000-000000000001',
        '30000000-0000-4000-8000-000000000010',
        'call_database123', repeat('b', 64),
        'Changed summary.', 'Senior Phone AI: Changed summary.',
        '2026-09-11T01:02:00Z'
      )
    `), /changed after reservation/);
    await db.exec(`
      update public.call_sessions set summary = null
      where id = '30000000-0000-4000-8000-000000000010'
    `);
    assert.equal(await countRows(db, "public.post_call_finalizations"), 0);
  } finally {
    await db.close();
  }
});
