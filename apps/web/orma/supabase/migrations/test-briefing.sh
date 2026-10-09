#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
scratch_root="$(mktemp -d /tmp/orma-t2-2.XXXXXX)"
container_name="supabase_db_$(basename "$scratch_root")"

cleanup() {
  supabase stop --workdir "$scratch_root" >/dev/null 2>&1 || true
}

trap cleanup EXIT

mkdir -p "$scratch_root/supabase/migrations"
cp "$repo_root/supabase/migrations/20260911000000_core_schema.sql" \
  "$repo_root/supabase/migrations/20260912160000_briefing.sql" \
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
  echo "T2.2 local database did not become healthy." >&2
  exit 1
fi

# `supabase start` applies this scratch project's complete migration history to
# an empty database. A second CLI reset is unnecessary and can block on CLI
# profile I/O before the acceptance SQL runs.

docker exec -i "$container_name" psql -v ON_ERROR_STOP=1 -U postgres -d postgres <<'SQL'
begin;

insert into auth.users (id, aud, role, email)
values ('00000000-0000-0000-0000-000000000222', 'authenticated', 'authenticated', 't2-2@example.test');

insert into public.profiles (id, display_name, phone_e164, timezone)
values ('00000000-0000-0000-0000-000000000222', 'Briefing user', '+14155550222', 'Asia/Kolkata');

insert into public.items (id, user_id, text, source, created_at)
values (
  '10000000-0000-4000-8000-000000000222',
  '00000000-0000-0000-0000-000000000222',
  'local midnight item',
  'web',
  '2026-08-13 20:00:00+00'
);

do $$
declare briefing jsonb;
begin
  briefing := public.assemble_briefing(
    '00000000-0000-0000-0000-000000000222',
    '08:00',
    '2026-09-12 00:00:00+00'
  );
  if briefing ->> 'lead_line' <> 'Everything open is still current.' then
    raise exception 'created_at must use the profile local date: %', briefing ->> 'lead_line';
  end if;
end;
$$;

insert into public.items (id, user_id, text, since_date, source)
values (
  '20000000-0000-4000-8000-000000000222',
  '00000000-0000-0000-0000-000000000222',
  'dentist',
  '2026-08-09',
  'web'
);

insert into public.item_mentions (item_id)
select '20000000-0000-4000-8000-000000000222'
from generate_series(1, 4);

-- The previous call carries a provider-written sentence that counts the same
-- item twice and ages it, and its own rows carry one captured item and one
-- commitment. The summary the next briefing reads must come from those rows, so
-- no number the provider's model wrote can reach the task template.
insert into public.call_runs (
  id, user_id, local_date, part_of_day, scheduled_for, state, disposition,
  calle_call_id, idempotency_key, completed_at
)
values (
  '30000000-0000-4000-8000-000000000222',
  '00000000-0000-0000-0000-000000000222',
  '2026-09-11', 'morning', '2026-09-11 02:30:00+00', 'completed',
  'answered_extracted', 'call_t2_2_summary',
  'orma:t2-2:summary', '2026-09-11 02:32:00+00'
);

insert into public.transcripts (call_run_id, turns, raw)
values (
  '30000000-0000-4000-8000-000000000222',
  '[]',
  '{"summary":"You mentioned the dentist 7 times and it has been 99 days."}'
);

insert into public.results (call_run_id, structured, valid)
values (
  '30000000-0000-4000-8000-000000000222',
  '{"captured_items":[{"text":"book the dentist","evidence_offset_seconds":12}],"retired_items":[],"commitments":[{"item_id":"20000000-0000-4000-8000-000000000222","evidence_offset_seconds":30}]}'::jsonb,
  true
);

do $$
declare briefing jsonb;
begin
  briefing := public.assemble_briefing(
    '00000000-0000-0000-0000-000000000222',
    '08:00',
    '2026-09-12 00:00:00+00'
  );
  if briefing ->> 'lead_line' <> 'You''ve mentioned dentist 4 times. It''s been 34 days.' then
    raise exception 'golden lead changed: %', briefing ->> 'lead_line';
  end if;
  if briefing ->> 'last_call_summary' <> 'Last call we wrote down 1 new item. You promised 1 thing.' then
    raise exception 'the prior call summary must come from the run rows: %', briefing ->> 'last_call_summary';
  end if;
  if position('99 days' in briefing ->> 'last_call_summary') > 0
     or position('7 times' in briefing ->> 'last_call_summary') > 0 then
    raise exception 'the provider summary reached the briefing: %', briefing ->> 'last_call_summary';
  end if;
  if briefing ->> 'open_count' <> '2' then
    raise exception 'open item count changed: %', briefing ->> 'open_count';
  end if;
end;
$$;

delete from public.item_mentions;
delete from public.commitments;
delete from public.items;

insert into public.items (id, user_id, text, since_date, source)
values
  ('40000000-0000-4000-8000-000000000222', '00000000-0000-0000-0000-000000000222', 'first item', '2026-08-13', 'web'),
  ('50000000-0000-4000-8000-000000000222', '00000000-0000-0000-0000-000000000222', 'second item', '2026-08-13', 'web');

insert into public.item_mentions (item_id)
select item_id
from (
  select '40000000-0000-4000-8000-000000000222'::uuid as item_id from generate_series(1, 3)
  union all
  select '50000000-0000-4000-8000-000000000222'::uuid from generate_series(1, 3)
) as mentions;

insert into public.commitments (item_id, user_id, due, evidence_offset_seconds)
values
  ('40000000-0000-4000-8000-000000000222', '00000000-0000-0000-0000-000000000222', '2026-09-11 00:00:00+00', 0),
  ('50000000-0000-4000-8000-000000000222', '00000000-0000-0000-0000-000000000222', '2026-09-11 00:00:00+00', 0);

do $$
declare briefing jsonb;
begin
  briefing := public.assemble_briefing(
    '00000000-0000-0000-0000-000000000222',
    '08:00',
    '2026-09-12 00:00:00+00'
  );
  if briefing ->> 'lead_line' <> 'first item is overdue. You''ve mentioned first item 3 times.' then
    raise exception 'lead must contain no more than two facts: %', briefing ->> 'lead_line';
  end if;
end;
$$;

do $$
begin
  if not has_function_privilege('service_role', 'public.assemble_briefing(uuid, time without time zone, timestamp with time zone)', 'execute') then
    raise exception 'service_role cannot execute assemble_briefing';
  end if;
  if has_function_privilege('anon', 'public.assemble_briefing(uuid, time without time zone, timestamp with time zone)', 'execute') then
    raise exception 'anon can execute assemble_briefing';
  end if;
  if has_function_privilege('authenticated', 'public.assemble_briefing(uuid, time without time zone, timestamp with time zone)', 'execute') then
    raise exception 'authenticated can execute assemble_briefing';
  end if;
end;
$$;

rollback;
SQL

echo "T2.2 briefing acceptance passed."
