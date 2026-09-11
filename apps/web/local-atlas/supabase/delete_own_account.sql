-- Self-service account deletion, without a service-role key in the app.
--
-- Deleting a Supabase user normally means the admin API, which needs the
-- service-role key: a credential that can read and rewrite every table. Adding
-- one to a web server so that one button works is a bad trade, so the delete
-- lives here instead, where the elevated rights already are.
--
-- Run this once in the Supabase SQL editor (Dashboard -> SQL Editor -> New
-- query -> Run). It is idempotent; re-running it is safe.
--
-- What makes it safe to expose:
--
--   * SECURITY DEFINER runs the body as the function's owner, which can delete
--     from auth.users. The CALLER cannot.
--   * The WHERE clause is auth.uid(), the subject of the caller's own JWT. There
--     is no parameter, so there is nothing to pass and no other row reachable —
--     a caller can only ever delete themselves, enforced by Postgres rather than
--     by application code remembering to check.
--   * EXECUTE is granted to `authenticated` only. The anon role cannot call it,
--     so an unauthenticated request gets nowhere even though the anon key is
--     public by design.
--   * search_path is pinned, so a rogue schema on the caller's search path
--     cannot shadow the tables named below — the standard SECURITY DEFINER
--     hazard.
--
-- Deleting the auth.users row cascades to sessions and refresh tokens, so every
-- device signed in as that user is signed out. Local Atlas keeps no user rows of
-- its own in Postgres: preferences and private call results live in Upstash and
-- are deleted by the server before this is called.

create or replace function public.delete_own_account()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'delete_own_account() requires an authenticated caller'
      using errcode = '42501';        -- insufficient_privilege
  end if;

  delete from auth.users where id = me;
end;
$$;

revoke all on function public.delete_own_account() from public, anon;
grant execute on function public.delete_own_account() to authenticated;

-- PostgREST caches the schema, and a function it has not seen answers 404 — which
-- the app reports as "delete_own_account() is not installed". Supabase reloads on
-- DDL automatically, but this makes it immediate and is harmless if redundant.
notify pgrst, 'reload schema';

comment on function public.delete_own_account() is
  'Deletes the calling user''s own auth.users row. No parameters by design: the '
  'target is always auth.uid(), so no caller can delete anyone else. Called by '
  'DELETE /api/auth/account in Local Atlas with the user''s own access token.';
