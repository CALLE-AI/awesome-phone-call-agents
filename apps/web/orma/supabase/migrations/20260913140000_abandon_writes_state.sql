-- T2.10 remediation round 3, deployment parity for `abandon_call_run`.
--
-- `public.abandon_call_run(uuid, text)` first shipped in
-- `20260913130000_finalise_attempts.sql`. The linked project applied that file
-- before remediation round 3 changed its body, and the Supabase CLI tracks
-- applied migrations by version, so the linked project still runs the older
-- body, the one that wrote no disposition and no state.
--
-- This file therefore carries the settled body, so a project that already
-- applied `20260913130000` receives it. That earlier file keeps its own copy,
-- because it is the record of what the project first received and of what a
-- fresh database applies first. The two are not duplication of each other, and
-- a reader should treat this file as the current definition.
--
-- The body writes the whole pair `spec.md` section 3 gives a failed run, the
-- state included. `not_answered` is the disposition for a failed run, and that
-- disposition is never billed. The guarded update returns true to the one
-- writer that ended the run, which is the writer that appends the timeline row.
--
-- md5(prosrc) after this file applies is 1aa1124a4ea9a88dcfbbd6b60ddef630. A
-- fresh database that applies every migration reaches the same value, and so
-- does the local stack.
create or replace function public.abandon_call_run(
  p_call_run_id uuid,
  p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_won boolean;
begin
  if p_call_run_id is null then
    raise exception 'abandoning a call run requires a call run id';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'abandoning a call run requires a reason';
  end if;

  update public.call_runs
     set state = 'failed',
         completed_at = now(),
         disposition = 'not_answered',
         billable = false,
         finalise_error = p_reason
   where id = p_call_run_id
     and completed_at is null
   returning true into v_won;

  return coalesce(v_won, false);
end;
$$;

-- The caller is the service role only. This boundary writes for any user, so an
-- authenticated or anonymous session must never reach it.
revoke all on function public.abandon_call_run(uuid, text) from public;
revoke all on function public.abandon_call_run(uuid, text) from anon;
revoke all on function public.abandon_call_run(uuid, text) from authenticated;
grant execute on function public.abandon_call_run(uuid, text) to service_role;
