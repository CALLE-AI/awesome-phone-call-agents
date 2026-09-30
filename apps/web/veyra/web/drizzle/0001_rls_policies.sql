-- RLS policies, the profile-creation trigger, and Data API grants. Not expressible as
-- Drizzle table structure, so this is a hand-written migration rather than a generated
-- one — kept in step with (and functionally identical to) web/supabase/schema.sql,
-- which is now superseded by this migration as the way schema changes actually reach
-- the database. See CLAUDE.md's Authentication section for why RLS, not application
-- code, is what enforces per-user ownership here.

-- ---------------------------------------------------------------------------
-- 1. Auto-create a profile for every new auth user
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
-- 2. Row Level Security
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
-- 3. Data API / connection-role grants
-- ---------------------------------------------------------------------------
-- RLS decides which ROWS are visible; these grants decide whether the table is reachable
-- at all — both for PostgREST (the Data API) and for withRLS()'s `set local role
-- authenticated` (lib/db/with-rls.ts), which relies on `authenticated` actually having
-- these grants once it's impersonated. `anon` is granted nothing — every policy above
-- requires an authenticated user anyway.

grant usage on schema public to authenticated;
grant select                         on public.profiles     to authenticated;
grant update (full_name, company_name, avatar_path) on public.profiles to authenticated;
grant select, insert, update, delete on public.workflows    to authenticated;
grant select, insert, update, delete on public.campaigns    to authenticated;
grant select, insert, update, delete on public.contacts     to authenticated;
grant select                         on public.call_results to authenticated;
