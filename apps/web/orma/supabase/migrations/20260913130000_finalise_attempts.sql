-- T2.7a bounds the finaliser's work on a terminal run.
--
-- A terminal run whose re-fetch or ingestion kept failing was retried by every
-- tick forever. Twenty such runs filled the whole twenty row batch, so a fresh
-- run never finalised. The finaliser now spends a limited number of attempts
-- on a run and waits between them.
--
-- `finalise_attempts` counts the failed attempts. `finalise_after` is the
-- earliest time the tick may select the run again, and the tick skips the run
-- until that time passes. `finalise_error` keeps the last error on the run, so
-- an operator reads why the finaliser is still working on it.
--
-- Two give-up paths end a run by setting `completed_at` outside ingestion, and
-- each names its reason on the timeline. This migration owns the columns and
-- the two SQL boundaries those paths use.
alter table public.call_runs
  add column finalise_attempts smallint not null default 0,
  add column finalise_after timestamptz,
  add column finalise_error text;

comment on column public.call_runs.finalise_attempts is
  'Failed finaliser attempts for this run. The finaliser ends the run when the attempt limit is spent.';

comment on column public.call_runs.finalise_after is
  'Earliest time the finaliser may select this run again. Null means no attempt has failed. The tick skips the run until this time passes.';

comment on column public.call_runs.finalise_error is
  'The last error a finalise attempt reported. The give-up path repeats it on the timeline. A completed run keeps an error here only when its final timeline row was lost.';

-- One failed attempt, recorded atomically with the wait that follows it. The
-- run row is locked, so two ticks cannot double count one attempt. The caller
-- reads `attempts` to decide whether the limit is spent.
--
-- A concurrent ingest may finish the run while an attempt fails. Counting an
-- attempt on a finished run would report work nobody owes, so the count and the
-- wait are skipped there.
create function public.record_finalise_failure(
  p_call_run_id uuid,
  p_wait_seconds integer,
  p_error text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempts smallint;
  v_completed_at timestamptz;
begin
  if p_call_run_id is null then
    raise exception 'finalise failure requires a call run id';
  end if;
  if p_wait_seconds is null or p_wait_seconds < 0 then
    raise exception 'finalise failure requires a wait of zero or more seconds';
  end if;

  select finalise_attempts, completed_at
    into v_attempts, v_completed_at
    from public.call_runs
   where id = p_call_run_id
     for update;
  if not found then
    raise exception 'call run % does not exist', p_call_run_id;
  end if;

  if v_completed_at is null then
    update public.call_runs
       set finalise_attempts = finalise_attempts + 1,
           finalise_after = now() + make_interval(secs => p_wait_seconds),
           finalise_error = p_error
     where id = p_call_run_id
     returning finalise_attempts into v_attempts;
  else
    -- The run is finished. The error is still news, because a finished run
    -- that reaches here lost its final timeline row.
    update public.call_runs
       set finalise_error = p_error
     where id = p_call_run_id;
  end if;

  return jsonb_build_object(
    'attempts', v_attempts,
    'finalised', v_completed_at is not null
  );
end;
$$;

-- The second give-up path. A run the finaliser can never finish is ended
-- deliberately, and the reason is required here so no caller can end a run
-- without one. It is also the last writer for such a run, so it writes the whole
-- pair the spec's table gives a failed run, the state included. A caller can
-- arrive holding a state another writer set, a webhook-terminalised `completed`
-- run or a rehearsal whose ingestion failed, and the give-up means `failed`
-- whatever the run held. The guarded update returns true to the one writer that
-- ended it, which is the writer that appends the timeline row.
create function public.abandon_call_run(
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

-- The caller is the service role only. Both boundaries write for any user, so
-- an authenticated or anonymous session must never reach them.
revoke all on function public.record_finalise_failure(uuid, integer, text) from public;
revoke all on function public.record_finalise_failure(uuid, integer, text) from anon;
revoke all on function public.record_finalise_failure(uuid, integer, text) from authenticated;
grant execute on function public.record_finalise_failure(uuid, integer, text) to service_role;

revoke all on function public.abandon_call_run(uuid, text) from public;
revoke all on function public.abandon_call_run(uuid, text) from anon;
revoke all on function public.abandon_call_run(uuid, text) from authenticated;
grant execute on function public.abandon_call_run(uuid, text) to service_role;
