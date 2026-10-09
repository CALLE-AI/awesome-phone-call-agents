-- T2.2 builds every numeric claim in the database. The Edge Function receives
-- only finished scalar strings, so CALL-E never has raw rows it could count.
-- `last_call_summary` is built from the previous run's own rows as well. The
-- provider's own sentence about that call is never readable here, because a
-- number inside it would reach the next call with no row behind it.
create or replace function public.assemble_briefing(
  p_user_id uuid,
  p_slot_local_time time,
  p_now timestamptz default now()
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with open_items as (
    select
      i.id,
      i.text,
      count(im.id)::integer as mention_count,
      greatest(
        0,
        (p_now at time zone pr.timezone)::date - coalesce(
          i.since_date,
          (i.created_at at time zone pr.timezone)::date
        )
      )::integer as age_days,
      exists (
        select 1
        from public.commitments c
        where c.item_id = i.id
          and c.user_id = p_user_id
          and c.due < p_now
      ) as overdue
    from public.items i
    join public.profiles pr on pr.id = i.user_id
    left join public.item_mentions im on im.item_id = i.id
    where i.user_id = p_user_id
      and i.status = 'open'
    group by i.id, i.text, i.since_date, i.created_at, pr.timezone
  ), ranked_items as (
    select
      oi.*,
      row_number() over (
        order by oi.overdue desc, (oi.mention_count >= 3) desc,
          (oi.age_days >= 30) desc, oi.age_days desc, oi.id
      ) as rank
    from open_items oi
  ), lead_items as (
    select *
    from ranked_items
    where overdue or mention_count >= 3 or age_days >= 30
    order by rank
    limit 2
  ), lead_facts as (
    select
      li.rank,
      fact.priority,
      fact.line
    from lead_items li
    cross join lateral (
      values
        (1, case when li.overdue then li.text || ' is overdue.' end),
        (2, case when li.mention_count >= 3 then
          'You''ve mentioned ' || li.text || ' ' || li.mention_count || ' times.'
        end),
        (3, case when li.age_days >= 30 then 'It''s been ' || li.age_days || ' days.' end)
    ) as fact(priority, line)
    where fact.line is not null
    order by li.rank, fact.priority
    limit 2
  ), prior_call as (
    select
      cr.disposition,
      case when r.structured is null then 0
        else coalesce(jsonb_array_length(r.structured -> 'captured_items'), 0)
      end as item_count,
      case when r.structured is null then 0
        else coalesce(jsonb_array_length(r.structured -> 'retired_items'), 0)
      end as retirement_count,
      case when r.structured is null then 0
        else coalesce(jsonb_array_length(r.structured -> 'commitments'), 0)
      end as commitment_count
    from public.call_runs cr
    left join public.results r on r.call_run_id = cr.id
    where cr.user_id = p_user_id
      and cr.completed_at is not null
      and cr.completed_at < p_now
    order by cr.completed_at desc
    limit 1
  ), prior_facts as (
    select fact.priority, fact.line
    from prior_call pc
    cross join lateral (
      values
        (1, case when pc.disposition = 'not_answered'
          then 'Last call went unanswered.' end),
        (2, case when pc.disposition = 'canceled'
          then 'Last call was dropped before it connected.' end),
        (3, case when pc.disposition = 'answered_no_result'
          then 'Last call came through with nothing written down.' end),
        (4, case when pc.item_count > 0 then
          'Last call we wrote down ' || pc.item_count || ' new item'
          || case when pc.item_count = 1 then '' else 's' end || '.'
        end),
        (5, case when pc.retirement_count > 0 then
          'You closed ' || pc.retirement_count || ' item'
          || case when pc.retirement_count = 1 then '' else 's' end || '.'
        end),
        (6, case when pc.commitment_count > 0 then
          'You promised ' || pc.commitment_count || ' thing'
          || case when pc.commitment_count = 1 then '' else 's' end || '.'
        end)
    ) as fact(priority, line)
    where fact.line is not null
  ), prior_summary as (
    select coalesce(
      (select string_agg(pf.line, ' ' order by pf.priority) from prior_facts pf),
      case
        when exists (select 1 from prior_call) then 'Last call added nothing new.'
        else ''
      end
    ) as summary
  )
  select jsonb_build_object(
    'user_name', pr.display_name,
    'open_count', (select count(*)::integer from open_items),
    'lead_line', coalesce((
      select string_agg(lf.line, ' ' order by lf.rank, lf.priority)
      from lead_facts lf
    ), 'Everything open is still current.'),
    'open_items', coalesce((
      select string_agg('- ' || ri.text || ' (id: ' || ri.id || ')', E'\n' order by ri.rank)
      from ranked_items ri
      where ri.rank <= 5
    ), 'Nothing is open.'),
    'last_call_summary', (select summary from prior_summary),
    'slot_local_time', to_char(p_slot_local_time, 'HH24:MI')
  )
  from public.profiles pr
  where pr.id = p_user_id;
$$;

revoke all on function public.assemble_briefing(uuid, time, timestamptz) from public;
revoke all on function public.assemble_briefing(uuid, time, timestamptz) from anon;
revoke all on function public.assemble_briefing(uuid, time, timestamptz) from authenticated;
grant execute on function public.assemble_briefing(uuid, time, timestamptz) to service_role;
