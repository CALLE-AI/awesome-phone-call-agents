-- T7.1 computes the facts a pattern report is written from. Every value is a
-- query result and nothing is inferred, so the prose stage can only phrase
-- numbers that already exist as rows. The function is deterministic and takes
-- its window as arguments, because a report must be reproducible by hand.
create or replace function public.compute_pattern_facts(
  p_user_id uuid,
  p_period_start date,
  p_period_end date
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with tz as (
    select p.timezone
    from public.profiles p
    where p.id = p_user_id
  ),
  window_runs as (
    select cr.*
    from public.call_runs cr
    where cr.user_id = p_user_id
      and cr.local_date between p_period_start and p_period_end
  ),
  mention_items as (
    select
      i.id as item_id,
      i.text,
      count(im.id)::integer as mention_count
    from public.items i
    join tz on true
    join public.item_mentions im on im.item_id = i.id
    where i.user_id = p_user_id
      and (im.created_at at time zone tz.timezone)::date
        between p_period_start and p_period_end
    group by i.id, i.text
  ),
  open_items as (
    select
      i.id as item_id,
      i.text,
      greatest(
        0,
        p_period_end - coalesce(
          i.since_date,
          (i.created_at at time zone tz.timezone)::date
        )
      )::integer as age_days
    from public.items i
    join tz on true
    where i.user_id = p_user_id
      and i.status = 'open'
  ),
  retired_items as (
    select
      i.id as item_id,
      i.text,
      greatest(
        0,
        (i.retired_at at time zone tz.timezone)::date
          - (i.created_at at time zone tz.timezone)::date
      )::integer as days_open
    from public.items i
    join tz on true
    where i.user_id = p_user_id
      and i.retired_at is not null
      and (i.retired_at at time zone tz.timezone)::date
        between p_period_start and p_period_end
  ),
  slot_rates as (
    select
      cr.slot_id,
      s.part_of_day,
      to_char(s.local_time, 'HH24:MI') as local_time,
      count(*)::integer as scheduled,
      count(*) filter (
        where cr.disposition in ('answered_extracted', 'answered_no_result')
      )::integer as answered
    from window_runs cr
    join public.slots s on s.id = cr.slot_id
    where cr.slot_id is not null
      and cr.state <> 'canceled'
    group by cr.slot_id, s.part_of_day, s.local_time
  ),
  mood_counts as (
    select
      cr.mood,
      count(*)::integer as mood_count
    from window_runs cr
    where cr.mood is not null
    group by cr.mood
  )
  select jsonb_build_object(
    'period_start', p_period_start,
    'period_end', p_period_end,
    'period_days', (p_period_end - p_period_start + 1)::integer,
    'observed_days', (
      select (count(distinct cr.local_date))::integer from window_runs cr
    ),
    'completed_runs', (
      select count(*)::integer from window_runs cr
      where cr.state = 'completed'
    ),
    'answered_runs', (
      select count(*)::integer from window_runs cr
      where cr.disposition in ('answered_extracted', 'answered_no_result')
    ),
    'required_days', 3,
    'sufficient_history', (
      select (count(distinct cr.local_date))::integer from window_runs cr
    ) >= 3,
    'mentions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'item_id', mi.item_id,
        'text', mi.text,
        'mention_count', mi.mention_count
      ) order by mi.mention_count desc, mi.text, mi.item_id)
      from mention_items mi
    ), '[]'::jsonb),
    'ages', coalesce((
      select jsonb_agg(jsonb_build_object(
        'item_id', oi.item_id,
        'text', oi.text,
        'age_days', oi.age_days
      ) order by oi.age_days desc, oi.text, oi.item_id)
      from open_items oi
    ), '[]'::jsonb),
    'retirements', jsonb_build_object(
      'retired_count', (select count(*)::integer from retired_items),
      'avg_days_open', (
        select round(avg(ri.days_open), 1) from retired_items ri
      ),
      'items', coalesce((
        select jsonb_agg(jsonb_build_object(
          'item_id', ri.item_id,
          'text', ri.text,
          'days_open', ri.days_open
        ) order by ri.days_open desc, ri.text, ri.item_id)
        from retired_items ri
      ), '[]'::jsonb)
    ),
    'longest_surviving', coalesce((
      select jsonb_agg(jsonb_build_object(
        'item_id', top.item_id,
        'text', top.text,
        'age_days', top.age_days
      ) order by top.age_days desc, top.text, top.item_id)
      from (
        select oi.item_id, oi.text, oi.age_days
        from open_items oi
        order by oi.age_days desc, oi.text, oi.item_id
        limit 5
      ) top
    ), '[]'::jsonb),
    'answer_rate_by_slot', coalesce((
      select jsonb_agg(jsonb_build_object(
        'slot_id', sr.slot_id,
        'part_of_day', sr.part_of_day,
        'local_time', sr.local_time,
        'scheduled', sr.scheduled,
        'answered', sr.answered,
        'answer_rate', round(sr.answered::numeric / sr.scheduled, 2)
      ) order by sr.part_of_day, sr.local_time, sr.slot_id)
      from slot_rates sr
    ), '[]'::jsonb),
    'mood_distribution', coalesce((
      select jsonb_agg(jsonb_build_object(
        'mood', mc.mood,
        'count', mc.mood_count
      ) order by mc.mood_count desc, mc.mood)
      from mood_counts mc
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.compute_pattern_facts(uuid, date, date) from public;
revoke all on function public.compute_pattern_facts(uuid, date, date) from anon;
revoke all on function public.compute_pattern_facts(uuid, date, date) from authenticated;
grant execute on function public.compute_pattern_facts(uuid, date, date) to service_role;
