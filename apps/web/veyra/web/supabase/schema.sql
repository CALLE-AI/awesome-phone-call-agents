-- Veyra database schema.
--
-- SUPERSEDED: schema changes now go through Drizzle (web/lib/db/schema.ts +
-- web/drizzle/*.sql, applied with `pnpm db:generate` / `pnpm db:migrate`), not this file
-- run by hand. Kept for historical reference only — the table shapes below match
-- web/drizzle/0000_dapper_ghost_rider.sql and the RLS/trigger/grants below match
-- web/drizzle/0001_rls_policies.sql verbatim, at least as of when this note was added.
-- Do not run this file against a database that has already run the Drizzle migrations,
-- it duplicates them (harmlessly, since it is idempotent, but there is no reason to).
--
-- Original header, still accurate for what the SQL below does:
--
-- Run this once against the project's Postgres database:
--   Supabase Dashboard -> SQL Editor -> paste -> Run
--
-- The whole file is idempotent (`if not exists` / `drop policy if exists`), so it is safe
-- to re-run after editing. It matches TECHNICAL_ARCH.md section 3.3 and the
-- "Authentication" section that follows it.
--
-- MANUAL DASHBOARD STEP REQUIRED (cannot be done from SQL or app code):
--   Authentication -> Providers -> Email -> turn OFF "Confirm email".
--   This is a hackathon build demoed live. With confirmation on, `signUp` returns a user
--   with no session and the signup flow dead-ends waiting on an email that nobody will
--   click on stage. See TECHNICAL_ARCH.md -> Authentication -> Project settings.

-- ---------------------------------------------------------------------------
-- 1. Profiles
-- ---------------------------------------------------------------------------
-- Supabase Auth already owns identity in `auth.users`. `profiles` is the app-owned
-- extension of that row — never a second users table. `id` IS the auth user id, which is
-- what makes `id = auth.uid()` a valid ownership check.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  company_name text,
  avatar_path text,
  role text not null default 'business_user',
  created_at timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- 2. Core tables (TECHNICAL_ARCH.md section 3.3), each scoped to its creator
-- ---------------------------------------------------------------------------

create table if not exists public.workflows (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  goal text not null,
  source_prompt text not null,
  -- the full Workflow object: nodes, edges, qualification, outcomeSchema
  schema jsonb not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  workflow_id uuid references public.workflows (id) on delete cascade,
  -- the flattened Calls API request, once compiled
  compiled_request jsonb,
  name text not null,
  status text not null default 'draft',
  locale text not null default 'en-IN',
  scheduled_at timestamptz,
  approved_at timestamptz,
  approval_digest text,
  failure_message text,
  created_at timestamptz default now(),
  launched_at timestamptz
);

create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references public.campaigns (id) on delete cascade,
  name text not null,
  phone_number text not null,
  metadata jsonb,
  position integer not null default 0
);

create table if not exists public.call_results (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references public.campaigns (id) on delete cascade,
  contact_id uuid references public.contacts (id) on delete cascade,
  calle_call_id text,
  idempotency_key text,
  approval_digest text,
  compiled_request jsonb,
  qualified boolean,
  -- null is a valid, expected value: CALL-E returns structured_result: null when it
  -- cannot extract a schema-valid result. See TECHNICAL_ARCH.md section 4.8.
  captured_data jsonb,
  summary text,
  transcript text,
  status text not null default 'pending',
  failure_code text,
  failure_message text,
  created_at timestamptz default now(),
  started_at timestamptz,
  completed_at timestamptz
);

-- CALL-E webhook delivery is at-least-once. Every event id is recorded before any side
-- effect runs, and re-deliveries are skipped on the primary key conflict.
create table if not exists public.processed_webhook_events (
  event_id text primary key,
  event_type text not null,
  processed_at timestamptz default now()
);

-- If this file is run against a database where `workflows` / `campaigns` already exist
-- without a `user_id`, the create-table statements above are no-ops and these add the
-- column. Existing rows get a null owner and become invisible under RLS, which is the
-- correct outcome — there is no way to retroactively attribute them.
alter table public.workflows add column if not exists user_id uuid references auth.users (id) on delete cascade;
alter table public.campaigns add column if not exists user_id uuid references auth.users (id) on delete cascade;

-- Every RLS policy below filters on one of these columns, so each index backs a predicate
-- that runs on literally every query against the table.
create index if not exists workflows_user_id_idx        on public.workflows (user_id);
create index if not exists campaigns_user_id_idx        on public.campaigns (user_id);
create index if not exists campaigns_workflow_id_idx    on public.campaigns (workflow_id);
create index if not exists contacts_campaign_id_idx     on public.contacts (campaign_id);
create index if not exists call_results_campaign_id_idx on public.call_results (campaign_id);
create index if not exists call_results_contact_id_idx  on public.call_results (contact_id);
create unique index if not exists call_results_calle_call_id_uidx on public.call_results (calle_call_id);
create unique index if not exists call_results_idempotency_key_uidx on public.call_results (idempotency_key);

-- ---------------------------------------------------------------------------
-- 3. Auto-create a profile for every new auth user
-- ---------------------------------------------------------------------------
-- The signup form passes full_name / company_name through supabase.auth.signUp's
-- `options.data`, which lands in auth.users.raw_user_meta_data. This trigger copies them
-- into profiles so the app never has to do a second round trip after signup.
--
-- SECURITY: raw_user_meta_data is user-editable (a client can update it at any time), so
-- it must never carry authorization data. `role` is therefore NOT read from metadata — it
-- is left to the column default, 'business_user'. If Veyra ever grows real roles, they
-- belong in raw_app_meta_data or an admin-only write path, not here.
--
-- security definer + `set search_path = ''` is the standard Supabase trigger shape: the
-- function must write to public.profiles as the owner, and an empty search_path stops a
-- caller-controlled schema from shadowing the objects it references.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, company_name)
  values (
    new.id,
    nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'company_name'), '')
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- 4. Row Level Security
-- ---------------------------------------------------------------------------
-- `public` is exposed through the Data API, so every table in it gets RLS. Tables with no
-- policies (processed_webhook_events) are then reachable only by the database owner used
-- by the server-only call lifecycle writer — exactly what the webhook route needs and
-- what the browser must not have.

alter table public.profiles                 enable row level security;
alter table public.workflows                enable row level security;
alter table public.campaigns                enable row level security;
alter table public.contacts                 enable row level security;
alter table public.call_results             enable row level security;
alter table public.processed_webhook_events enable row level security;

-- Conventions used by every policy below:
--   * `to authenticated` rather than `auth.role() = 'authenticated'` — the latter is
--     deprecated, and it silently passes for anonymous sign-ins.
--   * `(select auth.uid())` rather than bare `auth.uid()`, so Postgres evaluates it once
--     per statement instead of once per row.
--   * `to authenticated` on its own is authentication without authorization; the
--     ownership predicate in `using` is what actually scopes the rows.
--   * UPDATE carries both `using` (which rows may be updated) and `with check` (what they
--     may become). Without `with check` a user could reassign user_id to someone else.
--     Without a matching SELECT policy, UPDATE silently affects 0 rows.

-- --- profiles: the row is its own owner ------------------------------------
-- No delete policy: profiles are removed by the `on delete cascade` from auth.users. A
-- user deleting their own profile while their auth user lives on would leave the app with
-- a signed-in user and no name to show.

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select to authenticated
  using ( (select auth.uid()) = id );

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
  for insert to authenticated
  with check ( (select auth.uid()) = id );

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update to authenticated
  using ( (select auth.uid()) = id )
  with check ( (select auth.uid()) = id );

-- --- workflows --------------------------------------------------------------

drop policy if exists "workflows_select_own" on public.workflows;
create policy "workflows_select_own" on public.workflows
  for select to authenticated
  using ( (select auth.uid()) = user_id );

drop policy if exists "workflows_insert_own" on public.workflows;
create policy "workflows_insert_own" on public.workflows
  for insert to authenticated
  with check ( (select auth.uid()) = user_id );

drop policy if exists "workflows_update_own" on public.workflows;
create policy "workflows_update_own" on public.workflows
  for update to authenticated
  using ( (select auth.uid()) = user_id )
  with check ( (select auth.uid()) = user_id );

drop policy if exists "workflows_delete_own" on public.workflows;
create policy "workflows_delete_own" on public.workflows
  for delete to authenticated
  using ( (select auth.uid()) = user_id );

-- --- campaigns --------------------------------------------------------------

drop policy if exists "campaigns_select_own" on public.campaigns;
create policy "campaigns_select_own" on public.campaigns
  for select to authenticated
  using ( (select auth.uid()) = user_id );

drop policy if exists "campaigns_insert_own" on public.campaigns;
create policy "campaigns_insert_own" on public.campaigns
  for insert to authenticated
  with check ( (select auth.uid()) = user_id );

drop policy if exists "campaigns_update_own" on public.campaigns;
create policy "campaigns_update_own" on public.campaigns
  for update to authenticated
  using ( (select auth.uid()) = user_id )
  with check ( (select auth.uid()) = user_id );

drop policy if exists "campaigns_delete_own" on public.campaigns;
create policy "campaigns_delete_own" on public.campaigns
  for delete to authenticated
  using ( (select auth.uid()) = user_id );

-- --- contacts and call_results: ownership inherited from the parent campaign -
-- These carry no user_id of their own. Duplicating the column would mean two places to
-- keep in sync and a way for them to disagree; deriving ownership through campaign_id
-- keeps one source of truth. campaigns_user_id_idx keeps the exists() cheap.

drop policy if exists "contacts_own_campaign" on public.contacts;
create policy "contacts_own_campaign" on public.contacts
  for all to authenticated
  using (
    exists (
      select 1 from public.campaigns c
      where c.id = contacts.campaign_id
        and c.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.campaigns c
      where c.id = contacts.campaign_id
        and c.user_id = (select auth.uid())
    )
  );

-- Read-only for the campaign owner. Call results are written by the server-only lifecycle
-- module under the database owner after authenticated launch checks or secret-authorized
-- webhook correlation; nothing in the browser can forge or edit a call outcome.
drop policy if exists "call_results_select_own_campaign" on public.call_results;
create policy "call_results_select_own_campaign" on public.call_results
  for select to authenticated
  using (
    exists (
      select 1 from public.campaigns c
      where c.id = call_results.campaign_id
        and c.user_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- 5. Data API grants
-- ---------------------------------------------------------------------------
-- Depending on the project's Data API settings, tables created from raw SQL are not
-- automatically granted to the API roles. RLS decides which ROWS are visible; these grants
-- decide whether the table is reachable at all. `anon` is granted nothing — every policy
-- above requires an authenticated user anyway.

grant usage on schema public to authenticated;
grant select                         on public.profiles     to authenticated;
grant update (full_name, company_name, avatar_path) on public.profiles to authenticated;
grant select, insert, update, delete on public.workflows    to authenticated;
grant select, insert, update, delete on public.campaigns    to authenticated;
grant select, insert, update, delete on public.contacts     to authenticated;
grant select                         on public.call_results to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Private profile-image storage
-- ---------------------------------------------------------------------------
-- Only the authenticated owner can read, create, or remove objects inside their UUID
-- folder. Application code stores the private object path in profiles.avatar_path and
-- serves it through an authenticated same-origin route rather than exposing a public URL.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'profile-images',
  'profile-images',
  false,
  2097152,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "profile_images_select_own" on storage.objects;
create policy "profile_images_select_own" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'profile-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "profile_images_insert_own" on storage.objects;
create policy "profile_images_insert_own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'profile-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "profile_images_delete_own" on storage.objects;
create policy "profile_images_delete_own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'profile-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
