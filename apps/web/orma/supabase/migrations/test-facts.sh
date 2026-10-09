#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
scratch_root="$(mktemp -d /tmp/orma-t7-1.XXXXXX)"
container_name="supabase_db_$(basename "$scratch_root")"

# Stop the stack without keeping a backup volume and remove the scratch root.
# Safe to repeat, so the exit trap may run it again after the residue guard.
cleanup() {
  supabase stop --workdir "$scratch_root" --no-backup >/dev/null 2>&1 || true
  rm -rf "$scratch_root"
}

trap cleanup EXIT

mkdir -p "$scratch_root/supabase/migrations"
cp "$repo_root/supabase/migrations/20260911000000_core_schema.sql" \
  "$repo_root/supabase/migrations/20260913190000_facts.sql" \
  "$scratch_root/supabase/migrations/"

supabase init --workdir "$scratch_root"

# A local stack may already hold the default 5432x ports. Keep this isolated
# runner independent of that stack instead of stopping another task's database.
port_base=$((55000 + RANDOM % 3000))
sed -i \
  -e "s/port = 54321/port = $port_base/" \
  -e "s/port = 54322/port = $((port_base + 1))/" \
  -e "s/shadow_port = 54320/shadow_port = $((port_base + 2))/" \
  -e "s/port = 54323/port = $((port_base + 3))/" \
  -e "s/port = 54324/port = $((port_base + 4))/" \
  -e "s/port = 54327/port = $((port_base + 5))/" \
  -e "s/port = 54329/port = $((port_base + 6))/" \
  -e "s/inspector_port = 8083/inspector_port = $((port_base + 7))/" \
  -e '/\[db.seed\]/,/^\[/ s/enabled = true/enabled = false/' \
  "$scratch_root/supabase/config.toml"

if ! start_output="$(supabase start \
  --exclude gotrue,realtime,storage-api,imgproxy,kong,mailpit,postgrest,postgres-meta,studio,edge-runtime,logflare,vector,supavisor \
  --workdir "$scratch_root" 2>&1)"; then
  printf '%s\n' "$start_output" >&2
  exit 1
fi
printf '%s\n' "$start_output"

for attempt in {1..60}; do
  health="$(docker inspect --format '{{.State.Health.Status}}' "$container_name" 2>/dev/null || true)"
  if [ "$health" = "healthy" ]; then
    break
  fi
  sleep 1
done

if [ "${health:-}" != "healthy" ]; then
  docker logs "$container_name" 2>&1 || true
  echo "T7.1 local database did not become healthy." >&2
  exit 1
fi

# `supabase start` applies this scratch project's complete migration history to
# an empty database. A second CLI reset is unnecessary and can block on CLI
# profile I/O before the acceptance SQL runs.

docker exec -i "$container_name" psql -v ON_ERROR_STOP=1 -U postgres -d postgres <<'SQL'
begin;

-- One week of history for the main profile. In-window timestamps sit at
-- 01:00+05:30, so the Asia/Kolkata calendar date and the UTC date disagree by
-- one day and only the profile-timezone conversion keeps them in the window.
insert into auth.users (id, aud, role, email)
values
  ('00000000-0000-0000-0000-000000000771', 'authenticated', 'authenticated', 't7-1-main@example.test'),
  ('00000000-0000-0000-0000-000000000772', 'authenticated', 'authenticated', 't7-1-short@example.test'),
  ('00000000-0000-0000-0000-000000000773', 'authenticated', 'authenticated', 't7-1-empty@example.test'),
  ('00000000-0000-0000-0000-000000000774', 'authenticated', 'authenticated', 't7-1-boundary@example.test');

insert into public.profiles (id, display_name, phone_e164, timezone)
values
  ('00000000-0000-0000-0000-000000000771', 'Pattern user', '+14155550771', 'Asia/Kolkata'),
  ('00000000-0000-0000-0000-000000000772', 'Short user', '+14155550772', 'Asia/Kolkata'),
  ('00000000-0000-0000-0000-000000000773', 'Empty user', '+14155550773', 'Asia/Kolkata'),
  ('00000000-0000-0000-0000-000000000774', 'Boundary user', '+14155550774', 'Asia/Kolkata');

insert into public.slots (id, user_id, local_time, part_of_day)
values
  ('11111111-1111-1111-1111-000000000771', '00000000-0000-0000-0000-000000000771', '08:00', 'morning'),
  ('22222222-2222-2222-2222-000000000771', '00000000-0000-0000-0000-000000000771', '13:00', 'afternoon');

insert into public.items (id, user_id, text, status, since_date, source, created_at)
values
  ('33333333-3333-3333-3333-000000000771', '00000000-0000-0000-0000-000000000771', 'dentist', 'open', '2026-08-09', 'web', '2026-08-09 06:00+05:30'),
  ('33333333-3333-3333-3333-000000000772', '00000000-0000-0000-0000-000000000771', 'email Amma', 'open', null, 'web', '2026-08-20 01:00+05:30'),
  ('33333333-3333-3333-3333-000000000773', '00000000-0000-0000-0000-000000000771', 'physio', 'retired', '2026-08-01', 'web', '2026-08-01 06:00+05:30'),
  ('33333333-3333-3333-3333-000000000774', '00000000-0000-0000-0000-000000000771', 'refuel scooter', 'retired', null, 'web', '2026-08-02 06:00+05:30'),
  ('33333333-3333-3333-3333-000000000775', '00000000-0000-0000-0000-000000000771', 'tax return', 'open', '2026-09-10', 'web', '2026-09-01 06:00+05:30'),
  ('33333333-3333-3333-3333-000000000776', '00000000-0000-0000-0000-000000000771', 'water plants', 'open', '2026-08-28', 'web', '2026-08-28 06:00+05:30'),
  ('33333333-3333-3333-3333-000000000777', '00000000-0000-0000-0000-000000000771', 'book flight', 'open', '2026-09-02', 'web', '2026-09-02 06:00+05:30'),
  ('33333333-3333-3333-3333-000000000778', '00000000-0000-0000-0000-000000000771', 'replace bulb', 'open', '2026-09-06', 'web', '2026-09-06 06:00+05:30');

-- The retirement sits at 01:00+05:30 on 2026-09-01. Its Asia/Kolkata date is
-- 2026-09-01, the first day of the window. Its UTC date is 2026-08-31, one day
-- before the window, so only the profile-timezone cast keeps it in the report.
update public.items
set retired_at = '2026-09-01 01:00+05:30', retired_reason = 'done'
where id = '33333333-3333-3333-3333-000000000773';

-- This retirement lands outside the window, so it must stay out of the report.
update public.items
set retired_at = '2026-09-10 06:00+05:30', retired_reason = 'done'
where id = '33333333-3333-3333-3333-000000000774';

insert into public.call_runs (
  id, user_id, slot_id, local_date, part_of_day, scheduled_for, state,
  disposition, mood, idempotency_key
)
values
  ('44444444-4444-4444-4444-000000000001', '00000000-0000-0000-0000-000000000771', '11111111-1111-1111-1111-000000000771', '2026-09-01', 'morning',   '2026-09-01 02:30+00', 'completed', 'answered_extracted',  'ok',        'orma:t7-1:r01'),
  ('44444444-4444-4444-4444-000000000002', '00000000-0000-0000-0000-000000000771', '22222222-2222-2222-2222-000000000771', '2026-09-01', 'afternoon', '2026-09-01 07:30+00', 'completed', 'answered_no_result',  'low',       'orma:t7-1:r02'),
  ('44444444-4444-4444-4444-000000000003', '00000000-0000-0000-0000-000000000771', '11111111-1111-1111-1111-000000000771', '2026-09-02', 'morning',   '2026-09-02 02:30+00', 'completed', 'answered_extracted',  'ok',        'orma:t7-1:r03'),
  ('44444444-4444-4444-4444-000000000004', '00000000-0000-0000-0000-000000000771', '11111111-1111-1111-1111-000000000771', '2026-09-03', 'morning',   '2026-09-03 02:30+00', 'completed', 'answered_extracted',  'stressed',  'orma:t7-1:r04'),
  ('44444444-4444-4444-4444-000000000005', '00000000-0000-0000-0000-000000000771', '11111111-1111-1111-1111-000000000771', '2026-09-03', 'morning',   '2026-09-03 12:30+00', 'completed', 'not_answered',        'unknown',   'orma:t7-1:r05'),
  ('44444444-4444-4444-4444-000000000006', '00000000-0000-0000-0000-000000000771', '11111111-1111-1111-1111-000000000771', '2026-09-04', 'morning',   '2026-09-04 02:30+00', 'canceled',  'canceled',            null,        'orma:t7-1:r06'),
  ('44444444-4444-4444-4444-000000000007', '00000000-0000-0000-0000-000000000771', '11111111-1111-1111-1111-000000000771', '2026-09-05', 'morning',   '2026-09-05 02:30+00', 'completed', 'answered_extracted',  'energised', 'orma:t7-1:r07'),
  ('44444444-4444-4444-4444-000000000008', '00000000-0000-0000-0000-000000000771', '22222222-2222-2222-2222-000000000771', '2026-09-05', 'afternoon', '2026-09-05 07:30+00', 'completed', 'answered_extracted',  'ok',        'orma:t7-1:r08'),
  ('44444444-4444-4444-4444-000000000009', '00000000-0000-0000-0000-000000000771', '11111111-1111-1111-1111-000000000771', '2026-09-06', 'morning',   '2026-09-06 02:30+00', 'completed', 'answered_no_result',  'low',       'orma:t7-1:r09'),
  ('44444444-4444-4444-4444-000000000010', '00000000-0000-0000-0000-000000000771', '11111111-1111-1111-1111-000000000771', '2026-09-06', 'morning',   '2026-09-06 12:30+00', 'completed', 'answered_extracted',  'ok',        'orma:t7-1:r10'),
  ('44444444-4444-4444-4444-000000000011', '00000000-0000-0000-0000-000000000771', '11111111-1111-1111-1111-000000000771', '2026-09-07', 'morning',   '2026-09-07 02:30+00', 'completed', 'answered_extracted',  'ok',        'orma:t7-1:r11'),
  ('44444444-4444-4444-4444-000000000012', '00000000-0000-0000-0000-000000000771', '22222222-2222-2222-2222-000000000771', '2026-09-07', 'afternoon', '2026-09-07 07:30+00', 'completed', 'answered_no_result',  'stressed',  'orma:t7-1:r12'),
  ('44444444-4444-4444-4444-000000000013', '00000000-0000-0000-0000-000000000771', '11111111-1111-1111-1111-000000000771', '2026-08-31', 'morning',   '2026-08-31 02:30+00', 'completed', 'answered_extracted',  'ok',        'orma:t7-1:r13'),
  ('44444444-4444-4444-4444-000000000014', '00000000-0000-0000-0000-000000000771', '22222222-2222-2222-2222-000000000771', '2026-09-08', 'afternoon', '2026-09-08 07:30+00', 'completed', 'answered_no_result',  'low',       'orma:t7-1:r14');

-- The short profile covers two distinct local days, including a repeat, so
-- sufficient_history must stay false rather than extrapolating from rows.
insert into public.call_runs (
  id, user_id, slot_id, local_date, part_of_day, scheduled_for, state,
  disposition, mood, idempotency_key
)
values
  ('44444444-4444-4444-4444-000000000021', '00000000-0000-0000-0000-000000000772', null, '2026-09-01', 'morning', '2026-09-01 02:30+00', 'completed', 'answered_extracted', 'ok',  'orma:t7-1:s01'),
  ('44444444-4444-4444-4444-000000000022', '00000000-0000-0000-0000-000000000772', null, '2026-09-02', 'morning', '2026-09-02 02:30+00', 'completed', 'answered_no_result', 'low', 'orma:t7-1:s02'),
  ('44444444-4444-4444-4444-000000000023', '00000000-0000-0000-0000-000000000772', null, '2026-09-02', 'morning', '2026-09-02 12:30+00', 'completed', 'answered_extracted', 'ok',  'orma:t7-1:s03');

-- The boundary profile covers exactly three distinct local days with a repeat
-- among four completed runs. sufficient_history must turn true at exactly
-- three observed days, so any stricter comparison fails this block.
insert into public.call_runs (
  id, user_id, slot_id, local_date, part_of_day, scheduled_for, state,
  disposition, mood, idempotency_key
)
values
  ('44444444-4444-4444-4444-000000000031', '00000000-0000-0000-0000-000000000774', null, '2026-09-01', 'morning', '2026-09-01 02:30+00', 'completed', 'answered_extracted', 'ok', 'orma:t7-1:b01'),
  ('44444444-4444-4444-4444-000000000032', '00000000-0000-0000-0000-000000000774', null, '2026-09-02', 'morning', '2026-09-02 02:30+00', 'completed', 'answered_extracted', 'ok', 'orma:t7-1:b02'),
  ('44444444-4444-4444-4444-000000000033', '00000000-0000-0000-0000-000000000774', null, '2026-09-03', 'morning', '2026-09-03 02:30+00', 'completed', 'answered_extracted', 'ok', 'orma:t7-1:b03'),
  ('44444444-4444-4444-4444-000000000034', '00000000-0000-0000-0000-000000000774', null, '2026-09-03', 'morning', '2026-09-03 12:30+00', 'completed', 'answered_extracted', 'ok', 'orma:t7-1:b04');

-- Mentions. dentist has four inside the window plus one on each edge day.
-- The four inside sit at 01:00+05:30, so each UTC date lands one day earlier
-- and a dropped profile-timezone cast lifts one out of the window. email Amma
-- has two inside. physio has three inside. Every edge mention sits exactly one
-- local day outside, so an inclusive filter cannot pass by luck.
insert into public.item_mentions (item_id, call_run_id, created_at)
values
  ('33333333-3333-3333-3333-000000000771', '44444444-4444-4444-4444-000000000013', '2026-08-31 06:00+05:30'),
  ('33333333-3333-3333-3333-000000000771', '44444444-4444-4444-4444-000000000001', '2026-09-01 01:00+05:30'),
  ('33333333-3333-3333-3333-000000000771', '44444444-4444-4444-4444-000000000004', '2026-09-03 01:00+05:30'),
  ('33333333-3333-3333-3333-000000000771', '44444444-4444-4444-4444-000000000007', '2026-09-05 01:00+05:30'),
  ('33333333-3333-3333-3333-000000000771', '44444444-4444-4444-4444-000000000011', '2026-09-07 01:00+05:30'),
  ('33333333-3333-3333-3333-000000000771', null, '2026-09-08 06:00+05:30'),
  ('33333333-3333-3333-3333-000000000772', '44444444-4444-4444-4444-000000000003', '2026-09-02 06:00+05:30'),
  ('33333333-3333-3333-3333-000000000772', '44444444-4444-4444-4444-000000000010', '2026-09-06 06:00+05:30'),
  ('33333333-3333-3333-3333-000000000773', '44444444-4444-4444-4444-000000000004', '2026-09-03 06:30+05:30'),
  ('33333333-3333-3333-3333-000000000773', '44444444-4444-4444-4444-000000000007', '2026-09-05 06:30+05:30'),
  ('33333333-3333-3333-3333-000000000773', '44444444-4444-4444-4444-000000000011', '2026-09-07 06:30+05:30');

do $$
declare facts jsonb;
begin
  facts := public.compute_pattern_facts(
    '00000000-0000-0000-0000-000000000771',
    '2026-09-01',
    '2026-09-07'
  );

  if facts ->> 'period_start' <> '2026-09-01' then
    raise exception 'period_start changed: %', facts ->> 'period_start';
  end if;
  if facts ->> 'period_end' <> '2026-09-07' then
    raise exception 'period_end changed: %', facts ->> 'period_end';
  end if;
  if facts ->> 'period_days' <> '7' then
    raise exception 'period_days must be inclusive: %', facts ->> 'period_days';
  end if;
  if facts ->> 'observed_days' <> '7' then
    raise exception 'observed_days must count distinct local dates only inside the window: %', facts ->> 'observed_days';
  end if;
  if facts ->> 'completed_runs' <> '11' then
    raise exception 'completed_runs must ignore only the canceled run: %', facts ->> 'completed_runs';
  end if;
  if facts ->> 'answered_runs' <> '10' then
    raise exception 'answered_runs must count the two answered dispositions: %', facts ->> 'answered_runs';
  end if;
  if facts ->> 'required_days' <> '3' then
    raise exception 'required_days must stay 3: %', facts ->> 'required_days';
  end if;
  if (facts ->> 'sufficient_history') <> 'true' then
    raise exception 'seven observed days must be sufficient history';
  end if;

  if facts -> 'retirements' <> '{"avg_days_open": 31.0, "items": [{"days_open": 31, "item_id": "33333333-3333-3333-3333-000000000773", "text": "physio"}], "retired_count": 1}'::jsonb then
    raise exception 'retirements must cover only this window and measure local days open: %', facts -> 'retirements';
  end if;

  if facts -> 'mentions' <> '[
    {"item_id":"33333333-3333-3333-3333-000000000771","text":"dentist","mention_count":4},
    {"item_id":"33333333-3333-3333-3333-000000000773","text":"physio","mention_count":3},
    {"item_id":"33333333-3333-3333-3333-000000000772","text":"email Amma","mention_count":2}
  ]'::jsonb then
    raise exception 'mentions must count this window through the profile timezone: %', facts -> 'mentions';
  end if;

  if facts -> 'ages' <> '[
    {"item_id":"33333333-3333-3333-3333-000000000771","text":"dentist","age_days":29},
    {"item_id":"33333333-3333-3333-3333-000000000772","text":"email Amma","age_days":18},
    {"item_id":"33333333-3333-3333-3333-000000000776","text":"water plants","age_days":10},
    {"item_id":"33333333-3333-3333-3333-000000000777","text":"book flight","age_days":5},
    {"item_id":"33333333-3333-3333-3333-000000000778","text":"replace bulb","age_days":1},
    {"item_id":"33333333-3333-3333-3333-000000000775","text":"tax return","age_days":0}
  ]'::jsonb then
    raise exception 'ages must use since_date, then local created date, and clamp the future to zero: %', facts -> 'ages';
  end if;

  if facts -> 'longest_surviving' <> '[
    {"item_id":"33333333-3333-3333-3333-000000000771","text":"dentist","age_days":29},
    {"item_id":"33333333-3333-3333-3333-000000000772","text":"email Amma","age_days":18},
    {"item_id":"33333333-3333-3333-3333-000000000776","text":"water plants","age_days":10},
    {"item_id":"33333333-3333-3333-3333-000000000777","text":"book flight","age_days":5},
    {"item_id":"33333333-3333-3333-3333-000000000778","text":"replace bulb","age_days":1}
  ]'::jsonb then
    raise exception 'longest_surviving must cap at five items and drop the youngest: %', facts -> 'longest_surviving';
  end if;

  if facts -> 'answer_rate_by_slot' <> '[
    {"slot_id":"22222222-2222-2222-2222-000000000771","part_of_day":"afternoon","local_time":"13:00","scheduled":3,"answered":3,"answer_rate":1.00},
    {"slot_id":"11111111-1111-1111-1111-000000000771","part_of_day":"morning","local_time":"08:00","scheduled":8,"answered":7,"answer_rate":0.88}
  ]'::jsonb then
    raise exception 'answer rates must skip the canceled run and the null slot: %', facts -> 'answer_rate_by_slot';
  end if;

  if facts -> 'mood_distribution' <> '[
    {"mood":"ok","count":5},
    {"mood":"low","count":2},
    {"mood":"stressed","count":2},
    {"mood":"energised","count":1},
    {"mood":"unknown","count":1}
  ]'::jsonb then
    raise exception 'mood distribution must count in-window moods only: %', facts -> 'mood_distribution';
  end if;
end;
$$;

do $$
declare facts jsonb;
begin
  facts := public.compute_pattern_facts(
    '00000000-0000-0000-0000-000000000772',
    '2026-09-01',
    '2026-09-07'
  );

  if facts ->> 'observed_days' <> '2' then
    raise exception 'the short profile must observe two distinct days: %', facts ->> 'observed_days';
  end if;
  if (facts ->> 'sufficient_history') <> 'false' then
    raise exception 'two observed days must not become sufficient history';
  end if;
  if facts ->> 'completed_runs' <> '3' or facts ->> 'answered_runs' <> '3' then
    raise exception 'the short profile run counts changed: % %', facts ->> 'completed_runs', facts ->> 'answered_runs';
  end if;
  if facts -> 'answer_rate_by_slot' <> '[]'::jsonb then
    raise exception 'a null slot must stay out of answer rates: %', facts -> 'answer_rate_by_slot';
  end if;
end;
$$;

do $$
declare facts jsonb;
begin
  facts := public.compute_pattern_facts(
    '00000000-0000-0000-0000-000000000774',
    '2026-09-01',
    '2026-09-07'
  );

  if facts ->> 'observed_days' <> '3' then
    raise exception 'the boundary profile must observe exactly three distinct days: %', facts ->> 'observed_days';
  end if;
  if (facts ->> 'sufficient_history') <> 'true' then
    raise exception 'three observed days must already be sufficient history';
  end if;
  if facts ->> 'completed_runs' <> '4' or facts ->> 'answered_runs' <> '4' then
    raise exception 'the boundary profile run counts changed: % %', facts ->> 'completed_runs', facts ->> 'answered_runs';
  end if;
end;
$$;

do $$
declare facts jsonb;
begin
  facts := public.compute_pattern_facts(
    '00000000-0000-0000-0000-000000000773',
    '2026-09-01',
    '2026-09-07'
  );

  if facts ->> 'observed_days' <> '0' or (facts ->> 'sufficient_history') <> 'false' then
    raise exception 'an empty profile must observe nothing and claim no history: %', facts;
  end if;
  if facts -> 'mentions' <> '[]'::jsonb
     or facts -> 'ages' <> '[]'::jsonb
     or facts -> 'longest_surviving' <> '[]'::jsonb
     or facts -> 'answer_rate_by_slot' <> '[]'::jsonb
     or facts -> 'mood_distribution' <> '[]'::jsonb then
    raise exception 'an empty profile must return empty arrays: %', facts;
  end if;
  if facts -> 'retirements' <> '{"retired_count":0,"avg_days_open":null,"items":[]}'::jsonb then
    raise exception 'an empty profile must retire nothing and carry a null average: %', facts -> 'retirements';
  end if;
end;
$$;

do $$
begin
  if not has_function_privilege('service_role', 'public.compute_pattern_facts(uuid, date, date)', 'execute') then
    raise exception 'service_role cannot execute compute_pattern_facts';
  end if;
  if has_function_privilege('anon', 'public.compute_pattern_facts(uuid, date, date)', 'execute') then
    raise exception 'anon can execute compute_pattern_facts';
  end if;
  if has_function_privilege('authenticated', 'public.compute_pattern_facts(uuid, date, date)', 'execute') then
    raise exception 'authenticated can execute compute_pattern_facts';
  end if;
  if has_function_privilege('public', 'public.compute_pattern_facts(uuid, date, date)', 'execute') then
    raise exception 'public can execute compute_pattern_facts';
  end if;
end;
$$;

rollback;
SQL

# Prove the run left no harness residue behind. The exit trap may repeat the
# cleanup safely after this guard.
cleanup

if docker volume inspect "$container_name" >/dev/null 2>&1; then
  echo "T7.1 cleanup left the database volume $container_name behind." >&2
  exit 1
fi

if [ -d "$scratch_root" ]; then
  echo "T7.1 cleanup left the scratch root $scratch_root behind." >&2
  exit 1
fi

echo "T7.1 facts acceptance passed."
