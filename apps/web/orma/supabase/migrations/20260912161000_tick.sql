-- T2.3: Claiming must be a single PostgreSQL statement. PostgREST PATCH cannot
-- hold row locks across selection and mutation, so it can never replace this RPC.
create function public.claim_due_call_runs(p_limit integer default 20)
returns setof public.call_runs
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_limit is null or p_limit < 1 or p_limit > 20 then
    raise exception 'p_limit must be between 1 and 20';
  end if;

  return query
  with due as (
    select id
      from public.call_runs
     where state = 'scheduled'
       and scheduled_for <= now()
     order by scheduled_for
       for update skip locked
     limit p_limit
  )
  update public.call_runs as call_run
     set state = 'claimed',
         claimed_at = now()
    from due
   where call_run.id = due.id
  returning call_run.*;
end;
$$;

revoke all on function public.claim_due_call_runs(integer) from public;
revoke all on function public.claim_due_call_runs(integer) from anon;
revoke all on function public.claim_due_call_runs(integer) from authenticated;
grant execute on function public.claim_due_call_runs(integer) to service_role;

-- T2.4 schedules this RPC only when its dispatcher exists. Scheduling it here
-- would claim a run and strand it before the dispatch contract is present.
