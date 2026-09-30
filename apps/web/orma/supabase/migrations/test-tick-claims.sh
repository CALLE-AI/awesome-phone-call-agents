#!/usr/bin/env bash

# Proves the claim RPC against two PostgreSQL sessions. This always uses a
# temporary local Supabase project and never contacts the linked project.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
scratch_root="$(mktemp -d /tmp/orma-t2-3.XXXXXX)"
container_name="supabase_db_$(basename "$scratch_root")"
first_output="$scratch_root/first-claim.out"

cleanup() {
  supabase stop --workdir "$scratch_root" >/dev/null 2>&1 || true
  rm -rf "$scratch_root"
}

trap cleanup EXIT

for command in docker supabase; do
  command -v "$command" >/dev/null || {
    echo "test-tick-claims requires $command" >&2
    exit 1
  }
done

mkdir -p "$scratch_root/supabase/migrations"
supabase init --workdir "$scratch_root"
# A temporary project gets unique host ports, so it cannot attach to or stop a
# developer's default local Supabase stack. Its Docker project name remains the
# mktemp basename used in container_name above.
port_base=$((56000 + ($$ % 500) * 10))
sed -i \
  -e "s/^port = 54321$/port = $((port_base + 1))/" \
  -e "s/^port = 54322$/port = $((port_base + 2))/" \
  -e "s/^shadow_port = 54320$/shadow_port = $port_base/" \
  -e "s/^port = 54323$/port = $((port_base + 3))/" \
  -e "s/^port = 54324$/port = $((port_base + 4))/" \
  -e "s/^port = 54327$/port = $((port_base + 7))/" \
  -e "s/^port = 54329$/port = $((port_base + 9))/" \
  "$scratch_root/supabase/config.toml"
cp "$repo_root"/supabase/migrations/*.sql "$scratch_root/supabase/migrations/"
cp "$repo_root/supabase/seed.sql" "$scratch_root/supabase/"
# The pin needs PostgreSQL only. Excluding application services makes the
# disposable test quick and prevents it from binding unrelated local ports.
supabase start --ignore-health-check \
  --exclude gotrue,realtime,storage-api,imgproxy,kong,mailpit,postgrest,postgres-meta,studio,edge-runtime,logflare,vector,supavisor \
  --workdir "$scratch_root"

psql() {
  docker exec -i "$container_name" psql -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres "$@"
}

psql <<'SQL'
insert into auth.users (id, aud, role, email)
values ('00000000-0000-0000-0000-000000000023', 'authenticated', 'authenticated', 't2-3@example.test');

insert into public.profiles (id, display_name, phone_e164)
values ('00000000-0000-0000-0000-000000000023', 'Tick test', '+14155550123');

insert into public.call_runs (user_id, local_date, part_of_day, scheduled_for, idempotency_key)
values (
  '00000000-0000-0000-0000-000000000023',
  current_date,
  'morning',
  now() - interval '1 minute',
  't2-3-two-session-claim'
);
SQL

# Session one holds its transaction open after the RPC claims the only row.
# Seeing its first result before starting session two guarantees the row lock is
# held. A correct SKIP LOCKED query lets session two return zero before commit.
(
  psql <<'SQL'
begin;
set role service_role;
select count(*) from public.claim_due_call_runs(20);
select pg_sleep(3);
commit;
SQL
) >"$first_output" &
first_pid=$!

for _ in $(seq 1 60); do
  if rg -qx '1' "$first_output"; then
    break
  fi
  sleep 0.05
done

rg -qx '1' "$first_output" || {
  echo "first PostgreSQL session did not claim the due run" >&2
  exit 1
}

# Python's monotonic clock gives this pin a sub-second deadline that cannot be
# shortened by a wall-clock adjustment. A correct SKIP LOCKED claim returns
# immediately. Ordinary FOR UPDATE remains blocked by session one for nearly
# three seconds and raises TimeoutExpired before it can return zero after commit.
second_output="$(python3 - "$container_name" <<'PY'
import subprocess
import sys
import time

query = "set role service_role;\nselect count(*) from public.claim_due_call_runs(20);\n"
command = [
    "docker", "exec", "-i", sys.argv[1], "psql", "-qAt",
    "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres",
]
started = time.monotonic()
try:
    result = subprocess.run(
        command,
        input=query,
        text=True,
        capture_output=True,
        check=True,
        timeout=0.75,
    )
except subprocess.TimeoutExpired:
    elapsed = time.monotonic() - started
    raise SystemExit(
        f"second claim exceeded the 750ms monotonic deadline ({elapsed:.3f}s), "
        "so it blocked instead of skipping the locked due run"
    )
except subprocess.CalledProcessError as error:
    raise SystemExit(error.stderr)

print(result.stdout, end="")
PY
)"

wait "$first_pid"
first_output="$(rg -x '[01]' "$first_output" | head -n 1)"

[[ "$first_output" == "1" ]]
[[ "$second_output" == "0" ]]

claimed_rows="$(psql <<'SQL'
select count(*)
from public.call_runs
where idempotency_key = 't2-3-two-session-claim'
  and state = 'claimed';
SQL
)"

[[ "$claimed_rows" == "1" ]]
echo "T2.3 two-session claim acceptance passed."
