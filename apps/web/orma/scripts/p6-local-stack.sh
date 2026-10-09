#!/usr/bin/env bash
# P6 local fixture harness. It builds a scratch Supabase stack for the web app.
#
#   scripts/p6-local-stack.sh up      start the stack, apply migrations, seed, add harness rows
#   scripts/p6-local-stack.sh env     print the two PUBLIC_ names npm run dev needs
#   scripts/p6-local-stack.sh psql    open psql inside the scratch database container
#   scripts/p6-local-stack.sh down    stop the stack and remove its workdir
#
# It never touches the linked project. It runs no link, no db push and no deploy.
# Harness rows live only in the scratch database. supabase/seed.sql stays untouched.

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
workdir="${ORMA_P6_WORKDIR:-/tmp/orma-p6-stack}"
project_id="orma-p6-local"
db_container="supabase_db_${project_id}"

# One block of ten ports. Other stacks on this machine hold 54321-57030.
port_shadow=58320
port_api=58321
port_db=58322
port_studio=58323
port_inbucket=58324
port_smtp=58325
port_pop3=58326
port_analytics=58327
port_inspector=58328
port_pooler=58329
all_ports=(
  "$port_shadow" "$port_api" "$port_db" "$port_studio" "$port_inbucket"
  "$port_smtp" "$port_pop3" "$port_analytics" "$port_inspector" "$port_pooler"
)

die() {
  echo "p6-local-stack: $*" >&2
  exit 1
}

guard_workdir() {
  case "$workdir" in
    /tmp/orma-p6-*) ;;
    *) die "ORMA_P6_WORKDIR must start with /tmp/orma-p6-" ;;
  esac
}

check_ports_free() {
  local port
  for port in "${all_ports[@]}"; do
    if ss -ltnH "sport = :$port" | grep -q .; then
      die "port $port is already in use"
    fi
  done
}

write_config() {
  {
    printf 'project_id = "%s"\n\n' "$project_id"
    # Drop function blocks and the SMTP block. Local auth needs neither.
    awk '
      /^\[/ { skip = ($0 ~ /^\[functions\./ || $0 ~ /^\[auth\.email\.smtp\]/) }
      !skip
    ' "$repo_root/supabase/config.toml"
    cat <<EOF

[api]
port = $port_api

[db]
port = $port_db
shadow_port = $port_shadow

[db.pooler]
enabled = false
port = $port_pooler

[studio]
enabled = false
port = $port_studio

[inbucket]
enabled = false
port = $port_inbucket
smtp_port = $port_smtp
pop3_port = $port_pop3

[analytics]
enabled = false
port = $port_analytics

[realtime]
enabled = false

[edge_runtime]
enabled = false
inspector_port = $port_inspector
EOF
  } > "$workdir/supabase/config.toml"
}

psql_exec() {
  docker exec -i "$db_container" psql -v ON_ERROR_STOP=1 -q -U postgres -d postgres "$@"
}

insert_harness_rows() {
  psql_exec <<'SQL'
begin;

-- A future scheduled run for the seed account, at the next 08:00 in Asia/Kolkata.
with next_local as (
  select case
    when ((date_trunc('day', now() at time zone 'Asia/Kolkata') + interval '8 hours') at time zone 'Asia/Kolkata') > now() + interval '10 minutes'
      then date_trunc('day', now() at time zone 'Asia/Kolkata') + interval '8 hours'
    else date_trunc('day', now() at time zone 'Asia/Kolkata') + interval '1 day 8 hours'
  end as at_local
)
insert into public.call_runs (id, user_id, slot_id, local_date, part_of_day, scheduled_for, state, idempotency_key, dry_run)
select
  '4f000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  at_local::date,
  'morning',
  at_local at time zone 'Asia/Kolkata',
  'scheduled',
  'orma:harness-p6:seed-next:v1',
  true
from next_local;

-- A canceled run that sits earlier than the scheduled one. Today must skip it.
insert into public.call_runs (id, user_id, local_date, part_of_day, scheduled_for, state, disposition, idempotency_key, dry_run)
values (
  '4f000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000001',
  (now() at time zone 'Asia/Kolkata')::date,
  'evening',
  now() + interval '5 minutes',
  'canceled',
  'canceled',
  'orma:harness-p6:seed-canceled:v1',
  true
);

-- A second account with a profile, a slot and two items, and no calls at all.
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'firstrun@example.com', extensions.crypt('local-dev-password', extensions.gen_salt('bf')), now(), '', '', '', '',
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'live@example.com', extensions.crypt('local-dev-password', extensions.gen_salt('bf')), now(), '', '', '', '',
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now());

insert into auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
values
  ('10000000-0000-4000-8000-0000000000f1', 'firstrun@example.com', '00000000-0000-4000-8000-0000000000f1',
   '{"sub":"00000000-0000-4000-8000-0000000000f1","email":"firstrun@example.com"}'::jsonb, 'email', now(), now(), now()),
  ('10000000-0000-4000-8000-0000000000c1', 'live@example.com', '00000000-0000-4000-8000-0000000000c1',
   '{"sub":"00000000-0000-4000-8000-0000000000c1","email":"live@example.com"}'::jsonb, 'email', now(), now(), now());

insert into public.profiles (id, display_name, phone_e164, phone_confirmed_at, timezone)
values
  ('00000000-0000-4000-8000-0000000000f1', 'First Run', '+15555550101', now(), 'America/New_York'),
  ('00000000-0000-4000-8000-0000000000c1', 'Live Caller', '+15555550102', now(), 'Europe/London');

insert into public.consents (user_id, kind, text_version, source)
values
  ('00000000-0000-4000-8000-0000000000f1', 'outbound_calls', 'local-harness-v1', 'web'),
  ('00000000-0000-4000-8000-0000000000c1', 'outbound_calls', 'local-harness-v1', 'web');

insert into public.slots (id, user_id, local_time, weekdays, part_of_day)
values
  ('20000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000f1', '08:00', '{1,2,3,4,5,6,7}', 'morning'),
  ('20000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000c1', '08:00', '{1,2,3,4,5,6,7}', 'morning');

insert into public.items (id, user_id, text, source, created_at)
values
  ('30000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000f1', 'Reply to the landlord', 'telegram', now() - interval '1 day'),
  ('30000000-0000-4000-8000-0000000000f2', '00000000-0000-4000-8000-0000000000f1', 'Fix the bike brakes', 'telegram', now() - interval '10 minutes'),
  ('30000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000c1', 'Book the boiler service', 'web', now() - interval '12 days'),
  ('30000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-0000000000c1', 'Send the tax form', 'telegram', now() - interval '3 days');

-- The live account has one run on the call, so Today shows its live state.
insert into public.call_runs (
  id, user_id, slot_id, local_date, part_of_day, scheduled_for, state,
  idempotency_key, dry_run, claimed_at, dispatched_at, poll_after
)
values (
  '4f000000-0000-4000-8000-0000000000c1',
  '00000000-0000-4000-8000-0000000000c1',
  '20000000-0000-4000-8000-0000000000c1',
  (now() at time zone 'Europe/London')::date,
  'morning',
  now() - interval '70 seconds',
  'awaiting_result',
  'orma:harness-p6:live:v1',
  true,
  now() - interval '65 seconds',
  now() - interval '62 seconds',
  now() + interval '20 seconds'
);

insert into public.item_mentions (item_id, call_run_id, offset_seconds, created_at)
values
  ('30000000-0000-4000-8000-0000000000c1', null, null, now() - interval '9 days'),
  ('30000000-0000-4000-8000-0000000000c1', null, null, now() - interval '4 days');
-- The dispatcher stores the briefing before it places a call. The live run carries one from the real SQL.
update public.call_runs
   set briefing = public.assemble_briefing('00000000-0000-4000-8000-0000000000c1', '08:00', now())
 where id = '4f000000-0000-4000-8000-0000000000c1';

-- Three earlier completed morning runs for the Patterns mood trend. Together
-- with the seed completed run they give four moods across four observed days.
insert into public.call_runs (id, user_id, slot_id, local_date, part_of_day, scheduled_for, state, disposition, mood, idempotency_key, completed_at, dry_run)
values
  ('4f000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', ((now() - interval '2 days') at time zone 'Asia/Kolkata')::date, 'morning', now() - interval '2 days', 'completed', 'answered_extracted', 'ok', 'orma:harness-p6:mood-ok:v1', now() - interval '2 days', true),
  ('4f000000-0000-4000-8000-000000000012', '00000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', ((now() - interval '3 days') at time zone 'Asia/Kolkata')::date, 'morning', now() - interval '3 days', 'completed', 'answered_extracted', 'low', 'orma:harness-p6:mood-low:v1', now() - interval '3 days', true),
  ('4f000000-0000-4000-8000-000000000013', '00000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', ((now() - interval '4 days') at time zone 'Asia/Kolkata')::date, 'morning', now() - interval '4 days', 'completed', 'answered_extracted', 'stressed', 'orma:harness-p6:mood-stressed:v1', now() - interval '4 days', true);

-- The fixture pattern report. Facts come from the real compute_pattern_facts
-- SQL over the last seven complete local days, so every number in the prose
-- below is one of them: 7 days, 4 answered calls, 1 of each mood.
with report_window as (
  select ((now() at time zone 'Asia/Kolkata')::date - 7) as period_start, ((now() at time zone 'Asia/Kolkata')::date - 1) as period_end
)
insert into public.pattern_reports (user_id, period_start, period_end, facts, prose)
select
  '00000000-0000-4000-8000-000000000001',
  period_start,
  period_end,
  public.compute_pattern_facts('00000000-0000-4000-8000-000000000001', period_start, period_end),
  'Across 7 days you answered 4 calls. The calls heard you as energised 1 time, ok 1 time, low 1 time and stressed 1 time.'
from report_window;

-- The pattern delivery that renders the sent line on the Patterns page.
insert into public.deliveries (user_id, channel, kind, call_run_id, payload, sent_at)
values ('00000000-0000-4000-8000-000000000001', 'telegram', 'pattern', null, '{"harness":"pattern"}'::jsonb, now() - interval '1 day');

 commit;
SQL
}

cmd_up() {
  guard_workdir
  command -v supabase >/dev/null || die "supabase CLI not found"
  command -v docker >/dev/null || die "docker not found"
  if [ -e "$workdir" ]; then
    die "$workdir exists. Run: scripts/p6-local-stack.sh down"
  fi
  if docker ps -a --format '{{.Names}}' | grep -q "_${project_id}\$"; then
    die "containers for ${project_id} already exist. Run: scripts/p6-local-stack.sh down"
  fi
  check_ports_free

  mkdir -p "$workdir/supabase/migrations"
  cp "$repo_root"/supabase/migrations/*.sql "$workdir/supabase/migrations/"
  cp "$repo_root/supabase/seed.sql" "$workdir/supabase/seed.sql"
  write_config

  echo "p6-local-stack: starting ${project_id} in ${workdir}"
  # The CLI ends with a status block that names local keys. Print only progress lines.
  set +o pipefail
  timeout 900 supabase start --workdir "$workdir" \
    -x studio,imgproxy,vector,logflare,realtime,edge-runtime,postgres-meta,supavisor,mailpit 2>&1 \
    | grep -E '^(Applying migration|Seeding data|Starting|Stopping|Pulling|failed|Error|error)' || true
  set -o pipefail
  docker ps --format '{{.Names}}' | grep -q "^${db_container}\$" || die "the database container did not start"

  echo "p6-local-stack: inserting harness rows"
  insert_harness_rows

  cat <<EOF

p6-local-stack: up
  API URL        http://127.0.0.1:${port_api}
  DB container   ${db_container}
  Accounts       local@example.com     seed profile, last call and a future scheduled run
                 firstrun@example.com  profile with no calls
                 live@example.com      a run in awaiting_result
  Password       local-dev-password (all three, local only)

Run the web app against it:
  cd web && env \$(../scripts/p6-local-stack.sh env) npm run dev

Names that command sets: PUBLIC_ORMA_API_URL, PUBLIC_SUPABASE_ANON_KEY
Tear down:       scripts/p6-local-stack.sh down
EOF
}

cmd_env() {
  guard_workdir
  [ -d "$workdir" ] || die "no stack at $workdir. Run: scripts/p6-local-stack.sh up"
  local anon
  anon="$(supabase status --workdir "$workdir" -o env 2>/dev/null | sed -n 's/^ANON_KEY="\{0,1\}\([^"]*\)"\{0,1\}$/\1/p')"
  [ -n "$anon" ] || die "could not read the local anon key"
  printf 'PUBLIC_ORMA_API_URL=http://127.0.0.1:%s PUBLIC_SUPABASE_ANON_KEY=%s\n' "$port_api" "$anon"
}

cmd_psql() {
  docker exec -it "$db_container" psql -U postgres -d postgres "$@"
}

cmd_down() {
  guard_workdir
  if [ -d "$workdir" ]; then
    timeout 300 supabase stop --workdir "$workdir" --no-backup || true
  fi
  local leftovers
  leftovers="$(docker ps -a --format '{{.Names}}' | grep "_${project_id}\$" || true)"
  if [ -n "$leftovers" ]; then
    # shellcheck disable=SC2086
    docker rm -f $leftovers >/dev/null
  fi
  docker volume ls --format '{{.Name}}' | grep "_${project_id}\$" | xargs -r docker volume rm >/dev/null || true
  rm -rf "$workdir"
  if docker ps -a --format '{{.Names}}' | grep -q "_${project_id}\$"; then
    die "containers for ${project_id} are still present"
  fi
  echo "p6-local-stack: down. No ${project_id} containers remain."
}

case "${1:-}" in
  up) cmd_up ;;
  env) cmd_env ;;
  psql) shift; cmd_psql "$@" ;;
  down) cmd_down ;;
  *)
    echo "usage: scripts/p6-local-stack.sh up|env|psql|down" >&2
    exit 2
    ;;
esac
