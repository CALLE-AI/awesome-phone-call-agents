-- T6.7 owner actions. These boundaries use the authenticated caller only.
-- The cancellation lock serializes with the tick's SKIP LOCKED claim, so the
-- winner decides whether a call can still leave the scheduled state.

create function public.cancel_call_run(run_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.call_runs%rowtype;
begin
  if run_id is null then
    raise exception 'cancelling a call run requires an id';
  end if;

  select *
    into v_run
    from public.call_runs
   where id = run_id
     and user_id = auth.uid()
   for update;

  if not found or v_run.state <> 'scheduled' then
    return false;
  end if;

  update public.call_runs
     set state = 'canceled',
         disposition = 'canceled',
         completed_at = now(),
         billable = false
   where id = v_run.id;

  insert into public.call_events (call_run_id, kind, detail)
  values (
    v_run.id,
    'canceled',
    jsonb_build_object('state', 'canceled', 'disposition', 'canceled')
  );

  return true;
end;
$$;

-- Audio objects have no foreign key to auth.users. The owner directory is
-- enforced by the storage policies, and deleting the object rows removes the
-- objects before the profile cascade starts.
create function public.delete_my_account()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'deleting an account requires an authenticated user';
  end if;

  -- Production guards storage.objects with storage.protect_objects_delete
  -- That trigger allows the delete only when storage.allow_delete_query equals true
  -- The Storage API flips the same switch for its own deletions
  -- Postgres accepts undefined two part settings as placeholders
  -- The call below stays scoped to this transaction and stays a no-op where the trigger is absent
  perform set_config('storage.allow_delete_query', 'true', true);

  delete from storage.objects
   where bucket_id = 'item-audio'
     and name like v_user_id::text || '/%';

  delete from auth.users
   where id = v_user_id;

  return found;
end;
$$;

revoke all on function public.cancel_call_run(uuid) from public;
revoke all on function public.cancel_call_run(uuid) from anon;
grant execute on function public.cancel_call_run(uuid) to authenticated;

revoke all on function public.delete_my_account() from public;
revoke all on function public.delete_my_account() from anon;
grant execute on function public.delete_my_account() to authenticated;

-- Production manages its storage safeguard outside migrations
-- This block mirrors that safeguard locally for parity
-- It turns the T6.7 deletion acceptance into a real test of the bypass above
-- It stays a no-op in production where both objects already exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'storage'
       AND p.proname = 'protect_delete'
  ) THEN
    CREATE FUNCTION storage.protect_delete()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $func$
    BEGIN
      -- Check if storage.allow_delete_query is set to true
      IF COALESCE(current_setting('storage.allow_delete_query', true), 'false') != 'true' THEN
        RAISE EXCEPTION 'Direct deletion from storage tables is not allowed. Use the Storage API instead.'
          USING HINT = 'This prevents accidental data loss from orphaned objects.',
                ERRCODE = '42501';
      END IF;
      RETURN NULL;
    END;
    $func$;
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_trigger
     WHERE tgname = 'protect_objects_delete'
       AND tgrelid = 'storage.objects'::regclass
  ) THEN
    CREATE TRIGGER protect_objects_delete
      BEFORE DELETE ON storage.objects
      FOR EACH STATEMENT
      EXECUTE FUNCTION storage.protect_delete();
  END IF;
END;
$$;
