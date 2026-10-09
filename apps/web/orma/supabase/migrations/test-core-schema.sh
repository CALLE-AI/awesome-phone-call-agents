#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
scratch_root="$(mktemp -d /tmp/orma-t1-1.XXXXXX)"
container_name="supabase_db_$(basename "$scratch_root")"

cleanup() {
  supabase stop --workdir "$scratch_root" >/dev/null 2>&1 || true
}

trap cleanup EXIT

mkdir -p "$scratch_root/supabase/migrations"
cp "$repo_root/supabase/migrations/20260911000000_core_schema.sql" \
  "$scratch_root/supabase/migrations/"

supabase init --workdir "$scratch_root"
supabase start --workdir "$scratch_root"
supabase db reset --local --workdir "$scratch_root"

plan="$({
  docker exec -i "$container_name" psql -v ON_ERROR_STOP=1 -U postgres -d postgres <<'SQL'
begin;

insert into auth.users (id, aud, role, email)
values ('00000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 't1-1@example.test');

do $$
begin
  begin
    insert into public.profiles (id, display_name, phone_e164)
    values ('00000000-0000-0000-0000-000000000001', 'Invalid phone', '+01234567');
    raise exception 'profiles.phone_e164 accepted an invalid E.164 number';
  exception
    when check_violation then null;
  end;
end;
$$;

insert into public.profiles (id, display_name, phone_e164)
values ('00000000-0000-0000-0000-000000000001', 'Acceptance user', '+14155550100');

insert into public.call_runs (user_id, local_date, part_of_day, scheduled_for, idempotency_key)
values ('00000000-0000-0000-0000-000000000001', current_date, 'morning', now(), 't1-1-duplicate-key');

do $$
begin
  begin
    insert into public.call_runs (user_id, local_date, part_of_day, scheduled_for, idempotency_key)
    values ('00000000-0000-0000-0000-000000000001', current_date, 'morning', now(), 't1-1-duplicate-key');
    raise exception 'call_runs.idempotency_key accepted a duplicate';
  exception
    when unique_violation then null;
  end;
end;
$$;

insert into public.call_runs (user_id, local_date, part_of_day, scheduled_for, idempotency_key)
select
  '00000000-0000-0000-0000-000000000001',
  current_date,
  'morning',
  now() + interval '1 day' + (n * interval '1 second'),
  't1-1-future-' || n
from generate_series(1, 10000) as n;

analyze public.call_runs;

explain (costs false)
select id
from public.call_runs
where state = 'scheduled'
  and scheduled_for <= now()
order by scheduled_for
limit 20;

rollback;
SQL
})"

printf '%s\n' "$plan"
printf '%s\n' "$plan" | rg -q 'Index Scan using call_runs_state_scheduled_for_idx'

echo "T1.1 acceptance passed."
