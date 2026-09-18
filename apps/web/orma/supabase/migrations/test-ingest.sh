#!/usr/bin/env bash

# Proves the ingestion RPC against a throwaway local Supabase project. The
# completed and invalid cases are driven by the recorded CALL-E fixtures. This
# script never contacts the linked project and never places a call.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
fixtures="$repo_root/testdata/calle"
scratch_root="$(mktemp -d /tmp/orma-t2-7.XXXXXX)"
container_name="supabase_db_$(basename "$scratch_root")"
first_output="$scratch_root/first-ingest.out"

user_id="00000000-0000-0000-0000-000000000027"
main_run="00000000-0000-0000-0000-0000000000a7"
invalid_run="00000000-0000-0000-0000-0000000000a8"
reject_run="00000000-0000-0000-0000-0000000000a9"
lock_run="00000000-0000-0000-0000-0000000000aa"
boundary_run="00000000-0000-0000-0000-0000000000ab"
fixture_run="00000000-0000-0000-0000-0000000000ac"
recovered_run="00000000-0000-0000-0000-0000000000ad"
flag_run="00000000-0000-0000-0000-0000000000ae"
failed_run="00000000-0000-0000-0000-0000000000af"
webhook_failed_run="00000000-0000-0000-0000-0000000000b0"
slot_run="00000000-0000-0000-0000-0000000000b1"
retired_item="00000000-0000-0000-0000-0000000000b7"
# The second user owns one item that the runs below never touch. The ownership
# reject cases name it, so a predicate that drops `user_id` changes a row.
other_user="00000000-0000-0000-0000-000000000028"
foreign_item="00000000-0000-0000-0000-0000000000b8"
# The poll stored CALL-E's own failure on this run with a code the fixture does
# not use, and the payload names no failure at all.
kept_run="00000000-0000-0000-0000-0000000000b2"
# A run CALL-E reported as canceled. Nothing else drives the canceled state or
# the canceled disposition, so the pair is unmeasured without this row.
canceled_run="00000000-0000-0000-0000-0000000000b3"
# A call whose result failed validation. CALL-E names that under a status of
# its own, so the run takes the `no_result` state the spec gives it.
validation_run="00000000-0000-0000-0000-0000000000b4"
# A rehearsal. The dry path writes a synthetic call id and places no call, so
# this run must never read as billed.
rehearsal_run="00000000-0000-0000-0000-0000000000b5"
# A terminal run the finaliser gave up on. The webhook terminalised it
# `completed` and left the disposition unwritten, and its re-fetch then failed
# every attempt. The give-up therefore owns the whole pair, the state included.
abandon_run="00000000-0000-0000-0000-0000000000b6"
# The same give-up on a run that never received a provider call id, holding the
# state the poll's own give-up writes.
abandon_noid_run="00000000-0000-0000-0000-0000000000b7"
# A rehearsal of the validation-failure shape. It carries the disposition that
# shape gives, and the billing a rehearsal carries, which is none.
no_result_rehearsal_run="00000000-0000-0000-0000-0000000000b8"

cleanup() {
  supabase stop --workdir "$scratch_root" >/dev/null 2>&1 || true
  rm -rf "$scratch_root"
}

trap cleanup EXIT

for command in base64 docker jq python3 rg supabase; do
  command -v "$command" >/dev/null || {
    echo "test-ingest requires $command" >&2
    exit 1
  }
done

# port_free succeeds when no socket holds the host port on either stack. A
# listener on one address still blocks Docker's wildcard bind, so probe that.
port_free() {
  python3 - "$1" <<'PY'
import socket
import sys

port = int(sys.argv[1])
for family, host in ((socket.AF_INET, "0.0.0.0"), (socket.AF_INET6, "::")):
    try:
        probe = socket.socket(family, socket.SOCK_STREAM)
    except OSError:
        continue
    try:
        if family == socket.AF_INET6:
            probe.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 1)
        probe.bind((host, port))
    except OSError:
        sys.exit(1)
    finally:
        probe.close()
PY
}

# These offsets match the ports rewritten into config.toml below.
port_offsets=(0 1 2 3 4 7 9)

ports_free() {
  local offset
  for offset in "${port_offsets[@]}"; do
    port_free $(($1 + offset)) || return 1
  done
}

# pick_port_base shifts a candidate band by ten until every port in it is free.
pick_port_base() {
  local base=$1
  for _ in $(seq 1 100); do
    if ports_free "$base"; then
      echo "$base"
      return 0
    fi
    base=$((base + 10))
    if ((base > 64980)); then base=57000; fi
  done
  echo "test-ingest found no free port band near $1" >&2
  return 1
}

# Case zero: a busy port shifts the band. A listener bounded at spawn holds the
# database port of a free band, so an unshifted base would fail to bind.
candidate_base="$(pick_port_base $((57000 + ($$ % 500) * 10)))"
held_port=$((candidate_base + 2))
timeout 60 python3 -c '
import socket, sys, time
held = socket.socket()
held.bind(("127.0.0.1", int(sys.argv[1])))
held.listen()
print("ready", flush=True)
time.sleep(60)
' "$held_port" >"$scratch_root/held-port.out" &
holder_pid=$!
for _ in $(seq 1 100); do
  if rg -q ready "$scratch_root/held-port.out"; then break; fi
  sleep 0.05
done
rg -q ready "$scratch_root/held-port.out"
shifted_base="$(pick_port_base "$candidate_base")"
kill "$holder_pid" 2>/dev/null || true
wait "$holder_pid" 2>/dev/null || true
[[ "$shifted_base" != "$candidate_base" ]] || {
  echo "a busy port $held_port did not shift the port band" >&2
  exit 1
}
echo "T2.7 a busy port shifted the port band."

# The recorded call retired nothing and promised nothing, so the completed
# payload adds one retirement and one commitment to drive those branches.
completed_id="$(jq -r '.id' "$fixtures/call-completed.json")"
completed_turns="$(jq -c '.recipients[0].attempts[0].transcript_turns' "$fixtures/call-completed.json" | base64 -w0)"
completed_raw="$(base64 -w0 "$fixtures/call-completed.json")"
completed_structured="$(
  jq -c --arg item "$retired_item" \
    '.structured_result + {retired_items:[{item_id:$item,evidence_offset_seconds:62}], commitments:[{item_id:$item,due:"2026-09-12T03:00:00Z",evidence_offset_seconds:80}]}' \
    "$fixtures/call-completed.json" | base64 -w0
)"
fixture_structured="$(jq -c '.structured_result' "$fixtures/call-completed.json" | base64 -w0)"
completed_turn_count="$(jq '.recipients[0].attempts[0].transcript_turns | length' "$fixtures/call-completed.json")"

# The invalid call finished with no usable extract. Its raw payload mirrors the
# documented result_validation_failed webhook.
invalid_call_id="$(jq -r '.body.data.id' "$fixtures/webhook-result-validation-failed.documented.json")"
invalid_raw="$(
  jq -cn --arg id "$invalid_call_id" '{id:$id,status:"completed",structured_result:null}' | base64 -w0
)"

# The failed call reported a terminal CALL-E failure. The poll writes that
# failure verbatim and leaves `completed_at` null, so the finaliser re-fetches it.
failed_id="$(jq -r '.id' "$fixtures/call-failed.json")"
failed_completed_at="$(jq -r '.completed_at' "$fixtures/call-failed.json")"
failed_turns="$(jq -c '.recipients[0].attempts[0].transcript_turns' "$fixtures/call-failed.json" | base64 -w0)"
failed_raw="$(base64 -w0 "$fixtures/call-failed.json")"
failed_confidence="$(jq -c '.completion_confidence' "$fixtures/call-failed.json")"

mkdir -p "$scratch_root/supabase/migrations"
supabase init --workdir "$scratch_root"
# A temporary project gets its own host ports, so it cannot attach to or stop a
# developer's local stack. The band is re-probed here, after case zero freed its
# held port, and shifts past any band another stack already binds.
port_base="$(pick_port_base "$candidate_base")"
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
# disposable test quick and stops it from binding unrelated local ports.
supabase start --ignore-health-check \
  --exclude gotrue,realtime,storage-api,imgproxy,kong,mailpit,postgrest,postgres-meta,studio,edge-runtime,logflare,vector,supavisor \
  --workdir "$scratch_root"

psql() {
  docker exec -i "$container_name" psql -qAt -v ON_ERROR_STOP=1 -U postgres -d postgres "$@"
}

# decode_utf8 turns a base64 CLI argument back into jsonb, so a fixture with an
# apostrophe or a newline cannot break the SQL literal.
decode_utf8() {
  printf "convert_from(decode('%s','base64'),'UTF8')::jsonb" "$1"
}
# named_values prints the values the task names and a count cannot see. They
# are the stored due, the evidence offset on the commitment row, and the
# evidence offsets on the mentions of the one retired item. The retirement and
# the commitment name that item, so the commitment's own offset says which of
# its mentions the retirement wrote.
named_values() {
  psql <<SQL
select 'due=' || coalesce((select to_char(c.due at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
                             from public.commitments c where c.call_run_id = '$1'), 'none')
  || ' retired_mentions=' || coalesce((select string_agg(m.offset_seconds::text, ',' order by m.offset_seconds)
                                         from public.item_mentions m
                                        where m.call_run_id = '$1' and m.item_id = '$retired_item'), 'none')
  || ' commitment_offset=' || coalesce((select c.evidence_offset_seconds::text
                                          from public.commitments c where c.call_run_id = '$1'), 'none')
  || ' commitments=' || (select count(*) from public.commitments where call_run_id = '$1');
SQL
}

# stored_completed_at asserts one run stored exactly the completion time its
# caller named. A non-null flag cannot see a timestamp the RPC replaced, and the
# ordered story T2.9 builds reads this value.
stored_completed_at() {
  local run=$1 named=$2 stored expected
  stored="$(psql <<SQL
select to_char(c.completed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
from public.call_runs c where c.id = '$run';
SQL
)"
  expected="$(psql <<SQL
select to_char('$named'::timestamptz at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
SQL
)"
  [[ "$stored" == "$expected" ]] || {
    echo "the run stored the completion time '$stored', not the named '$expected'" >&2
    exit 1
  }
}

psql <<SQL
insert into auth.users (id, aud, role, email)
values
  ('$user_id', 'authenticated', 'authenticated', 't2-7@example.test'),
  ('$other_user', 'authenticated', 'authenticated', 't2-7-other@example.test');

insert into public.profiles (id, display_name, phone_e164)
values ('$user_id', 'Ingest test', '+14155550127');

insert into public.profiles (id, display_name)
values ('$other_user', 'Ingest test other');

insert into public.call_runs (id, user_id, local_date, part_of_day, scheduled_for, idempotency_key, calle_call_id)
values
  ('$main_run', '$user_id', current_date, 'morning', now() - interval '5 minutes', 't2-7-ingest', '$completed_id'),
  ('$invalid_run', '$user_id', current_date, 'morning', now() - interval '4 minutes', 't2-7-invalid', '$invalid_call_id'),
  ('$reject_run', '$user_id', current_date, 'morning', now() - interval '3 minutes', 't2-7-reject', 'call_t2_7_reject'),
  ('$lock_run', '$user_id', current_date, 'morning', now() - interval '2 minutes', 't2-7-lock', 'call_t2_7_lock'),
  ('$boundary_run', '$user_id', current_date, 'morning', now() - interval '1 minute', 't2-7-boundary', 'call_t2_7_boundary'),
  ('$fixture_run', '$user_id', current_date, 'morning', now(), 't2-7-fixture', '$completed_id'),
  -- The poll gave up on this run. Ingestion must supersede it.
  ('$recovered_run', '$user_id', current_date, 'evening', now(), 't2-7-recovered', '$completed_id'),
  -- The poll reported CALL-E's own terminal failure and left completed_at null.
  ('$failed_run', '$user_id', current_date, 'evening', now(), 't2-7-failed', '$failed_id'),
  -- The webhook moved this run to failed and wrote no failure of its own.
  ('$webhook_failed_run', '$user_id', current_date, 'evening', now(), 't2-7-webhook-failed', '$failed_id'),
  ('$slot_run', '$user_id', current_date, 'evening', now(), 't2-7-slot', 'call_t2_7_slot'),
  ('$flag_run', '$user_id', current_date, 'evening', now(), 't2-7-flag', 'call_t2_7_flag'),
  -- The poll stored a CALL-E failure with a code the fixture never repeats.
  ('$kept_run', '$user_id', current_date, 'evening', now(), 't2-7-kept', 'call_t2_7_kept'),
  -- CALL-E canceled this run in flight. Nothing else drives the canceled state.
  ('$canceled_run', '$user_id', current_date, 'evening', now(), 't2-7-canceled', 'call_t2_7_canceled'),
  -- A call whose result failed validation. CALL-E names that under a status of
  -- its own, and the run must read as no_result.
  ('$validation_run', '$user_id', current_date, 'morning', now(), 't2-7-no-result', 'call_t2_10_no_result'),
  -- A rehearsal. The dry path writes a synthetic call id, and no real call was
  -- placed, so this run must never read as billed.
  ('$rehearsal_run', '$user_id', current_date, 'morning', now(), 't2-7-rehearsal', 'fixture:call_t2_10_rehearsal'),
  -- A call the finaliser gave up on after CALL-E placed and answered it.
  ('$abandon_run', '$user_id', current_date, 'evening', now(), 't2-10-abandon', 'call_t2_10_abandon'),
  -- The same give-up on a run that never received a provider call id.
  ('$abandon_noid_run', '$user_id', current_date, 'evening', now(), 't2-10-abandon-noid', null),
  -- A rehearsal of the validation-failure shape, on a synthetic call id.
  ('$no_result_rehearsal_run', '$user_id', current_date, 'morning', now(), 't2-10-no-result-rehearsal', 'fixture:call_t2_10_no_result_rehearsal');

update public.call_runs
   set state = 'failed',
       terminal_writer = 'poll',
       calle_failure = '{"failure_code":"no_answer","failure_message":"CALL-E reported no answer"}'::jsonb
 where id = '$abandon_noid_run';

update public.call_runs
   set state = 'completed',
       terminal_writer = 'webhook:evt_t2_10_give_up'
 where id = '$abandon_run';

update public.call_runs
   set state = 'failed',
       disposition = 'not_answered',
       calle_failure = '{"failure_code":"poll_timeout","failure_message":"CALL-E re-fetch failed past the give-up window"}'::jsonb
 where id = '$recovered_run';

-- The poll's terminal write: it sets the state, its own writer tag, the
-- confidence and CALL-E's failure verbatim. The stored code is deliberately not
-- the fixture's code, so the payload below must supersede it. The poll writes no
-- disposition and no completed_at.
update public.call_runs
   set state = 'failed',
       terminal_writer = 'poll',
       calle_confidence = '$failed_confidence'::jsonb,
       calle_failure = '{"failure_code":"no_answer","failure_message":"CALL-E reported no answer"}'::jsonb
 where id = '$failed_run';

-- The same poll write on a run whose payload repeats no failure at all, so the
-- keep branch is the only writer of this column.
update public.call_runs
   set state = 'failed',
       terminal_writer = 'poll',
       calle_failure = '{"failure_code":"busy","failure_message":"CALL-E reported a busy line"}'::jsonb
 where id = '$kept_run';

-- CALL-E canceled this run while it was still in flight, so ingestion moves it
-- from a calling run to a terminal canceled state.
update public.call_runs set state = 'calling' where id = '$canceled_run';

-- The webhook writes the terminal state alone, with no failure at all.
update public.call_runs
   set state = 'failed',
       terminal_writer = 'webhook:evt_terminal'
 where id = '$webhook_failed_run';

insert into public.items (id, user_id, text, source)
values
  ('$retired_item', '$user_id', 'renew the passport', 'seed'),
  ('$foreign_item', '$other_user', 'the other user item', 'seed');
SQL

# Case one: the completed fixture produces an item, a retirement, a commitment
# and one item_mentions row for each, so three mentions in total.
first_summary="$(psql <<SQL
set role service_role;
select public.ingest_call_result(
  '$main_run',
  '$user_id',
  $(decode_utf8 "$completed_turns"),
  $(decode_utf8 "$completed_raw"),
  $(decode_utf8 "$completed_structured"),
  true,
  null,
  'completed',
  'answered_extracted',
  'unknown',
  '2026-09-12T02:20:18Z'
);
SQL
)"
[[ "$(jq -r .already_ingested <<<"$first_summary")" == "false" ]]
[[ "$(jq -r .disposition <<<"$first_summary")" == "answered_extracted" ]]
[[ "$(jq -r .counts.items <<<"$first_summary")" == "1" ]]
[[ "$(jq -r .counts.mentions <<<"$first_summary")" == "3" ]]
[[ "$(jq -r .counts.retirements <<<"$first_summary")" == "1" ]]
[[ "$(jq -r .counts.commitments <<<"$first_summary")" == "1" ]]

[[ "$(psql <<SQL
select count(*) from public.items where user_id = '$user_id' and source = 'call';
SQL
)" == "1" ]]
[[ "$(psql <<SQL
select count(*) from public.item_mentions where call_run_id = '$main_run';
SQL
)" == "3" ]]
[[ "$(psql <<SQL
select count(*) from public.commitments where call_run_id = '$main_run';
SQL
)" == "1" ]]
[[ "$(psql <<SQL
select count(*) from public.items where id = '$retired_item' and status = 'retired' and retired_at is not null and retired_reason is not null;
SQL
)" == "1" ]]
# The spec bills `answered_extracted`, and this run holds a provider call id.
main_billing="$(psql <<SQL
select state || ' ' || coalesce(disposition, 'null') || ' ' || mood || ' ' || billable::text from public.call_runs where id = '$main_run';
SQL
)"
[[ "$main_billing" == "completed answered_extracted unknown true" ]] || {
  echo "the completed run read '$main_billing' beside its disposition" >&2
  exit 1
}
# The transcript keeps every recorded turn and the raw payload keeps its call id.
[[ "$(psql <<SQL
select jsonb_array_length(turns) from public.transcripts where call_run_id = '$main_run';
SQL
)" == "$completed_turn_count" ]]
[[ "$(psql <<SQL
select raw ->> 'id' from public.transcripts where call_run_id = '$main_run';
SQL
)" == "$completed_id" ]]
[[ "$(psql <<SQL
select valid || ' ' || (structured -> 'captured_items' -> 0 ->> 'text') from public.results where call_run_id = '$main_run';
SQL
)" == "true Continental" ]]
# Ingestion never writes a slot. A slot change stays a proposal.
[[ "$(psql <<SQL
select count(*) from public.slots where user_id = '$user_id';
SQL
)" == "0" ]]
# The RPC writes the timeline row inside its own transaction. Its counts must
# equal the rows that same transaction wrote, and it must name the provider call.
main_event="$(psql <<SQL
select e.detail ->> 'state' || ' ' || (e.detail ->> 'item_count') || ' ' || (e.detail ->> 'mention_count')
  || ' ' || (e.detail ->> 'retirement_count') || ' ' || (e.detail ->> 'commitment_count')
  || ' ' || (e.detail ->> 'calle_call_id') || ' ' || coalesce(e.detail -> 'skipped', 'null'::jsonb)::text
from public.call_events e where e.call_run_id = '$main_run' and e.kind = 'ingested';
SQL
)"
[[ "$main_event" == "completed 1 3 1 1 $completed_id []" ]] || {
  echo "the ingested row read '$main_event', not the counts of the rows" >&2
  exit 1
}
# The counts above cannot see a stolen value. Read the stored due and the
# evidence offsets back, because those are the values the task names.
main_values="$(named_values "$main_run")"
[[ "$main_values" == "due=2026-09-12T03:00:00Z retired_mentions=62,80 commitment_offset=80 commitments=1" ]] || {
  echo "the committed values read '$main_values', not the values the result named" >&2
  exit 1
}
# The stored completion time is a value the finaliser reads, so it is read back
# by value rather than tested for presence.
stored_completed_at "$main_run" '2026-09-12T02:20:18Z'
echo "T2.7 completed fixture produced its rows."

# Case two: a second identical call changes no row.
second_summary="$(psql <<SQL
set role service_role;
select public.ingest_call_result(
  '$main_run',
  '$user_id',
  $(decode_utf8 "$completed_turns"),
  $(decode_utf8 "$completed_raw"),
  $(decode_utf8 "$completed_structured"),
  true,
  null,
  'completed',
  'answered_extracted',
  'unknown',
  '2026-09-12T02:20:18Z'
);
SQL
)"
[[ "$(jq -r .already_ingested <<<"$second_summary")" == "true" ]]
[[ "$(jq -r .counts.items <<<"$second_summary")" == "0" ]]
[[ "$(psql <<SQL
select (select count(*) from public.items where user_id = '$user_id' and source = 'call')
  || ' ' || (select count(*) from public.item_mentions where call_run_id = '$main_run')
  || ' ' || (select count(*) from public.commitments where call_run_id = '$main_run')
  || ' ' || (select count(*) from public.transcripts where call_run_id = '$main_run')
  || ' ' || (select count(*) from public.results where call_run_id = '$main_run');
SQL
)" == "1 3 1 1 1" ]]
main_events="$(psql <<SQL
select count(*) from public.call_events where call_run_id = '$main_run' and kind = 'ingested';
SQL
)"
[[ "$main_events" == "1" ]] || {
  echo "a re-ingest wrote $main_events ingested rows" >&2
  exit 1
}
# A replay changes no row, so it changes no named value either.
replay_values="$(named_values "$main_run")"
[[ "$replay_values" == "$main_values" ]] || {
  echo "the replay changed a named value: '$replay_values' against '$main_values'" >&2
  exit 1
}
echo "T2.7 re-ingest changed no row."

# Case three: the invalid fixture writes a transcript and a disposition and no
# partial state. The structured result is null and valid is false.
invalid_summary="$(psql <<SQL
set role service_role;
select public.ingest_call_result(
  '$invalid_run',
  '$user_id',
  '[]'::jsonb,
  $(decode_utf8 "$invalid_raw"),
  null,
  false,
  'structured_result.captured_items must be an array',
  'completed',
  'answered_no_result',
  null,
  '2026-09-12T02:25:00Z'
);
SQL
)"
[[ "$(jq -r .already_ingested <<<"$invalid_summary")" == "false" ]]
[[ "$(jq -r .disposition <<<"$invalid_summary")" == "answered_no_result" ]]
[[ "$(jq -r .counts.items <<<"$invalid_summary")" == "0" ]]
[[ "$(psql <<SQL
select valid || ' ' || coalesce(error, '') || ' ' || (structured is null)::text from public.results where call_run_id = '$invalid_run';
SQL
)" == "false structured_result.captured_items must be an array true" ]]
[[ "$(psql <<SQL
select count(*) from public.transcripts where call_run_id = '$invalid_run';
SQL
)" == "1" ]]
# The spec bills `answered_no_result` too, and this run placed a real call.
invalid_billing="$(psql <<SQL
select state || ' ' || coalesce(disposition, 'null') || ' ' || billable::text from public.call_runs where id = '$invalid_run';
SQL
)"
[[ "$invalid_billing" == "completed answered_no_result true" ]] || {
  echo "the answered run with no result read '$invalid_billing'" >&2
  exit 1
}
# No partial state: no new item, mention or commitment anywhere.
[[ "$(psql <<SQL
select (select count(*) from public.items where user_id = '$user_id' and source = 'call')
  || ' ' || (select count(*) from public.item_mentions where call_run_id = '$invalid_run')
  || ' ' || (select count(*) from public.commitments where call_run_id = '$invalid_run');
SQL
)" == "1 0 0" ]]
stored_completed_at "$invalid_run" '2026-09-12T02:25:00Z'
echo "T2.7 invalid fixture left a transcript and a disposition."

# Case four: a retirement without an evidence offset raises the specific error,
# and its whole transaction rolls back.
reject_output="$(
  psql <<SQL 2>&1
set role service_role;
select public.ingest_call_result(
  '$reject_run',
  '$user_id',
  '[]'::jsonb,
  '{"id":"call_t2_7_reject"}'::jsonb,
  '{"captured_items":[],"retired_items":[{"item_id":"$retired_item"}]}'::jsonb,
  true,
  null,
  'completed',
  'answered_extracted',
  null,
  now()
);
SQL
)" || true
rg -q 'requires an evidence offset' <<<"$reject_output" || {
  echo "an unoffset retirement did not raise the evidence-offset error" >&2
  printf '%s\n' "$reject_output" >&2
  exit 1
}
[[ "$(psql <<SQL
select (select count(*) from public.results where call_run_id = '$reject_run')
  || ' ' || (select count(*) from public.transcripts where call_run_id = '$reject_run');
SQL
)" == "0 0" ]]
echo "T2.7 unoffset retirement was rejected."

# Case five: a concurrent second ingest waits on the locked run row and then
# changes nothing. Session one holds its transaction open after the RPC returns.
# Session two runs to completion, so a missing row lock shows up as a duplicate
# item, a duplicate mention and a second timeline row rather than as a block.
lock_structured='{"captured_items":[{"text":"lock session one","evidence_offset_seconds":7}],"retired_items":[]}'
(
  psql <<SQL
begin;
set role service_role;
select public.ingest_call_result(
  '$lock_run',
  '$user_id',
  '[]'::jsonb,
  '{"id":"call_t2_7_lock"}'::jsonb,
  '$lock_structured'::jsonb,
  true,
  null,
  'completed',
  'answered_extracted',
  null,
  now()
);
select pg_sleep(3);
commit;
SQL
) >"$first_output" &
first_pid=$!

for _ in $(seq 1 60); do
  if rg -q 'already_ingested' "$first_output"; then
    break
  fi
  sleep 0.05
done

rg -q 'already_ingested' "$first_output" || {
  echo "first PostgreSQL session did not ingest the locked run" >&2
  exit 1
}

# Python's monotonic clock proves session two waited at all, which a slow start
# would otherwise hide. Without the row lock session two waits on the transcript
# insert instead, then re-inserts the captured item and the row counts below
# catch it.
second_summary="$(python3 - "$container_name" "$lock_run" "$user_id" "$lock_structured" <<'PY'
import subprocess
import sys
import time

query = (
    "set role service_role;\n"
    "select public.ingest_call_result("
    f"'{sys.argv[2]}', '{sys.argv[3]}', '[]'::jsonb, "
    "'{\"id\":\"call_t2_7_lock\"}'::jsonb, "
    f"'{sys.argv[4]}'::jsonb, "
    "true, null, 'completed', 'answered_extracted', null, now());\n"
)
command = [
    "docker", "exec", "-i", sys.argv[1], "psql", "-qAt",
    "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres",
]
started = time.monotonic()
try:
    done = subprocess.run(command, input=query, text=True, capture_output=True, check=True, timeout=30)
except subprocess.CalledProcessError as error:
    raise SystemExit(error.stderr)
elapsed = time.monotonic() - started
if elapsed < 1:
    raise SystemExit(f"the second ingest returned after {elapsed:.3f}s, so it never waited on the run lock")
print(done.stdout.strip())
PY
)"

wait "$first_pid"
# One item, one mention, one ingested row and one result for the locked run.
lock_rows="$(psql <<SQL
select (select count(*) from public.item_mentions where call_run_id = '$lock_run')
  || ' ' || (select count(*) from public.items i
              join public.item_mentions m on m.item_id = i.id
             where m.call_run_id = '$lock_run' and i.text = 'lock session one')
  || ' ' || (select count(*) from public.call_events where call_run_id = '$lock_run' and kind = 'ingested')
  || ' ' || (select count(*) from public.results where call_run_id = '$lock_run');
SQL
)"
[[ "$lock_rows" == "1 1 1 1" ]] || {
  echo "a concurrent ingest duplicated the locked run: $lock_rows" >&2
  exit 1
}
[[ "$(jq -r .already_ingested <<<"$second_summary")" == "true" ]] || {
  echo "the second ingest did not read the committed result: $second_summary" >&2
  exit 1
}
[[ "$(jq -r .counts.items <<<"$second_summary")" == "0" ]] || {
  echo "the second ingest reported new rows: $second_summary" >&2
  exit 1
}
[[ "$(jq -r .counts.mentions <<<"$second_summary")" == "0" ]] || {
  echo "the second ingest reported new mentions: $second_summary" >&2
  exit 1
}
# The locked run's one mention carries the offset its result named.
[[ "$(psql <<SQL
select coalesce(offset_seconds::text, 'null') from public.item_mentions where call_run_id = '$lock_run';
SQL
)" == "7" ]] || {
  echo "the locked run's mention lost the offset its result named" >&2
  exit 1
}
echo "T2.7 concurrent ingest waited on the run lock."

# Case six: the boundary values ingest.ts accepts all commit in PostgreSQL. The
# Deno test "boundary values that PostgreSQL accepts stay valid" uses the same
# values, so ingest.ts can never accept a result this RPC would refuse there.
boundary_upper="$(tr '[:lower:]' '[:upper:]' <<<"$retired_item")"
boundary_structured="$(
  printf '%s' '{"captured_items":[{"text":" x","evidence_offset_seconds":-2147483648},{"text":"café 😀","evidence_offset_seconds":2147483647}],"retired_items":[{"item_id":"UPPER","evidence_offset_seconds":0}],"commitments":[{"item_id":"ITEM","due":"2026-09-15","evidence_offset_seconds":1},{"item_id":"ITEM","due":"2026-09-15T10:00Z","evidence_offset_seconds":1},{"item_id":"ITEM","due":"2026-09-15 10:00:00.123456+15:59","evidence_offset_seconds":1},{"item_id":"ITEM","due":"2028-02-29T23:59:59-0530","evidence_offset_seconds":1},{"item_id":"ITEM","due":"0001-01-01T00:00:00Z","evidence_offset_seconds":1},{"item_id":"ITEM","due":"2026-09-15T10:00:00.123456789Z","evidence_offset_seconds":1},{"item_id":"ITEM","due":"2026-09-15t10:00:00z","evidence_offset_seconds":1},{"item_id":"ITEM","due":"2026-09-15T10:00+05","evidence_offset_seconds":1},{"item_id":"ITEM","due":"2026-09-15 10:00:00+0530","evidence_offset_seconds":1}]}' |
    sed -e "s/UPPER/$boundary_upper/" -e "s/ITEM/$retired_item/g" | base64 -w0
)"
boundary_summary="$(psql <<SQL
set role service_role;
select public.ingest_call_result(
  '$boundary_run', '$user_id', '[]'::jsonb, '{"id":"call_t2_7_boundary"}'::jsonb,
  $(decode_utf8 "$boundary_structured"),
  true, null, 'completed', 'answered_extracted', null, now()
);
SQL
)"
[[ "$(jq -S -c .counts <<<"$boundary_summary")" == '{"commitments":9,"items":2,"mentions":12,"retirements":1}' ]] || {
  echo "boundary ingest returned unexpected counts: $boundary_summary" >&2
  exit 1
}
[[ "$(psql <<SQL
select (select count(*) from public.commitments where call_run_id = '$boundary_run')
  || ' ' || (select count(*) from public.item_mentions where call_run_id = '$boundary_run')
  || ' ' || (select min(offset_seconds) || ' ' || max(offset_seconds) from public.item_mentions where call_run_id = '$boundary_run');
SQL
)" == "9 12 -2147483648 2147483647" ]]
# A count cannot see a due that changed. Read every stored due back beside the
# value PostgreSQL makes of the same literal.
boundary_dues="$(psql <<SQL
select coalesce(string_agg(to_char(due at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS.US'), ',' order by due), 'none')
  from public.commitments where call_run_id = '$boundary_run';
SQL
)"
boundary_expected="$(psql <<SQL
select string_agg(to_char(v at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS.US'), ',' order by v)
  from (values
    ('2026-09-15'::timestamptz),
    ('2026-09-15T10:00Z'::timestamptz),
    ('2026-09-15 10:00:00.123456+15:59'::timestamptz),
    ('2028-02-29T23:59:59-0530'::timestamptz),
    ('0001-01-01T00:00:00Z'::timestamptz),
    ('2026-09-15T10:00:00.123456789Z'::timestamptz),
    ('2026-09-15t10:00:00z'::timestamptz),
    ('2026-09-15T10:00+05'::timestamptz),
    ('2026-09-15 10:00:00+0530'::timestamptz)
  ) as t(v);
SQL
)"
[[ "$boundary_dues" == "$boundary_expected" ]] || {
  echo "the boundary dues read '$boundary_dues', not '$boundary_expected'" >&2
  exit 1
}
echo "T2.7 every boundary value ingest.ts accepts committed in PostgreSQL."

# Case seven: each value ingest.ts repairs per entry still makes the RPC raise
# and roll back when a caller sends it raw. The Deno test "one bad entry never
# discards the rest of the extraction" repairs the same values instead.
# The last two entries name an item that belongs to a second user, so only the
# RPC's own ownership predicates can refuse them. An id that exists for nobody
# would raise on the missing row and pin nothing about ownership.
reject_cases=(
  '{"captured_items":[],"retired_items":[],"commitments":[{"item_id":"ITEM","due":"next Tuesday after work","evidence_offset_seconds":80}]}'
  '{"captured_items":[],"retired_items":[],"commitments":[{"item_id":"ITEM","due":"2026","evidence_offset_seconds":80}]}'
  '{"captured_items":[],"retired_items":[],"commitments":[{"item_id":"ITEM","due":"","evidence_offset_seconds":80}]}'
  '{"captured_items":[],"retired_items":[],"commitments":[{"item_id":"ITEM","due":"2026-02-30T10:00:00Z","evidence_offset_seconds":80}]}'
  '{"captured_items":[],"retired_items":[],"commitments":[{"item_id":"ITEM","due":"0000-09-15T10:00:00Z","evidence_offset_seconds":80}]}'
  '{"captured_items":[],"retired_items":[],"commitments":[{"item_id":"ITEM","due":"2026-09-15T10:00:00+16:00","evidence_offset_seconds":80}]}'
  '{"captured_items":[],"retired_items":[{"item_id":"the museum one","evidence_offset_seconds":62}]}'
  '{"captured_items":[],"retired_items":[],"commitments":[{"item_id":"passport","evidence_offset_seconds":80}]}'
  '{"captured_items":[{"text":"   ","evidence_offset_seconds":44}],"retired_items":[]}'
  '{"captured_items":[{"text":"","evidence_offset_seconds":44}],"retired_items":[]}'
  '{"captured_items":[{"text":"pass\u0000port","evidence_offset_seconds":44}],"retired_items":[]}'
  '{"captured_items":[{"text":"pass\ud800port","evidence_offset_seconds":44}],"retired_items":[]}'
  '{"captured_items":[],"retired_items":[],"slot_change_requested":"yes","slot_change_time":"7\u0000am"}'
  '{"captured_items":[{"text":"Continental","evidence_offset_seconds":2147483648}],"retired_items":[]}'
  '{"captured_items":[],"retired_items":[{"item_id":"ITEM","evidence_offset_seconds":1e21}]}'
  '{"captured_items":[],"retired_items":[],"commitments":[{"item_id":"ITEM","evidence_offset_seconds":-2147483649}]}'
  '{"captured_items":[],"retired_items":[{"item_id":"FOREIGN","evidence_offset_seconds":62}]}'
  '{"captured_items":[],"retired_items":[],"commitments":[{"item_id":"FOREIGN","evidence_offset_seconds":80}]}'
)
for structured in "${reject_cases[@]}"; do
  filled="${structured//ITEM/$retired_item}"
  filled="${filled//FOREIGN/$foreign_item}"
  encoded="$(printf '%s' "$filled" | base64 -w0)"
  if psql >/dev/null 2>&1 <<SQL
set role service_role;
select public.ingest_call_result(
  '$reject_run', '$user_id', '[]'::jsonb, '{"id":"call_t2_7_reject"}'::jsonb,
  $(decode_utf8 "$encoded"),
  true, null, 'completed', 'answered_extracted', null, now()
);
SQL
  then
    echo "PostgreSQL accepted a result that ingest.ts rejects: $filled" >&2
    exit 1
  fi
done
[[ "$(psql <<SQL
select (select count(*) from public.results where call_run_id = '$reject_run')
  || ' ' || (select count(*) from public.transcripts where call_run_id = '$reject_run')
  || ' ' || (select count(*) from public.item_mentions where call_run_id = '$reject_run');
SQL
)" == "0 0 0" ]]
echo "T2.7 all ${#reject_cases[@]} values ingest.ts rejects raise in PostgreSQL."

# Case eight: the committed fixture, unmodified, is one captured item and
# nothing else. Cases one and two add a retirement and a commitment to it. Every
# number below is one count of one table, and `user_items` catches a duplicated
# item that a mention count alone would miss.
psql <<SQL >/dev/null
set role service_role;
select public.ingest_call_result(
  '$fixture_run', '$user_id',
  $(decode_utf8 "$completed_turns"),
  $(decode_utf8 "$completed_raw"),
  $(decode_utf8 "$fixture_structured"),
  true, null, 'completed', 'answered_extracted', 'unknown', '2026-09-12T02:20:18Z'
);
SQL
fixture_rows="$(psql <<SQL
select 'run_items=' || (select count(distinct m.item_id) from public.item_mentions m
                          join public.items i on i.id = m.item_id
                         where m.call_run_id = '$fixture_run' and i.source = 'call')
  || ' user_items=' || (select count(*) from public.items where user_id = '$user_id' and source = 'call')
  || ' mentions=' || (select count(*) from public.item_mentions where call_run_id = '$fixture_run')
  || ' offsets=' || (select coalesce(string_agg(offset_seconds::text, ',' order by offset_seconds), 'none')
                       from public.item_mentions where call_run_id = '$fixture_run')
  || ' commitments=' || (select count(*) from public.commitments where call_run_id = '$fixture_run')
  || ' retired=' || (select count(*) from public.items where user_id = '$user_id' and status = 'retired');
SQL
)"
echo "T2.7 unmodified completed fixture rows: $fixture_rows"
[[ "$fixture_rows" == "run_items=1 user_items=5 mentions=1 offsets=44 commitments=0 retired=1" ]]
stored_completed_at "$fixture_run" '2026-09-12T02:20:18Z'

# Case nine: the poll gave up on this run and wrote `poll_timeout`. That column
# holds CALL-E's own failure verbatim, so the authoritative payload must clear
# it. The run read failed with not_answered before this call.
recovered_summary="$(psql <<SQL
set role service_role;
select public.ingest_call_result(
  '$recovered_run', '$user_id',
  $(decode_utf8 "$completed_turns"),
  $(decode_utf8 "$completed_raw"),
  $(decode_utf8 "$fixture_structured"),
  true, null, 'completed', 'answered_extracted', 'unknown', '2026-09-12T02:20:18Z'
);
SQL
)"
[[ "$(jq -r .already_ingested <<<"$recovered_summary")" == "false" ]] || {
  echo "the recovered run was already ingested: $recovered_summary" >&2
  exit 1
}
recovered_row="$(psql <<SQL
select state || ' ' || disposition || ' ' || mood || ' ' || coalesce(calle_failure::text, 'null')
  || ' ' || (completed_at is not null)::text
from public.call_runs where id = '$recovered_run';
SQL
)"
[[ "$recovered_row" == "completed answered_extracted unknown null true" ]] || {
  echo "the recovered run read '$recovered_row'" >&2
  exit 1
}
stored_completed_at "$recovered_run" '2026-09-12T02:20:18Z'
echo "T2.7 a call that recovered after a give-up cleared the give-up marker."

# Case ten: the repair list a caller passes lands on the timeline row inside the
# RPC transaction, beside counts that equal the rows it wrote. A commitment
# whose spoken due was repaired reaches the RPC with a null due and keeps its
# row, which is what a caller who says "tomorrow after work" must produce.
flag_structured="$(
  jq -c --arg item "$retired_item" \
    '.structured_result + {commitments:[{item_id:$item,due:null,evidence_offset_seconds:80}]}' \
    "$fixtures/call-completed.json" | base64 -w0
)"
flag_summary="$(psql <<SQL
set role service_role;
select public.ingest_call_result(
  '$flag_run', '$user_id',
  '[]'::jsonb,
  '{"id":"call_t2_7_flag"}'::jsonb,
  $(decode_utf8 "$flag_structured"),
  true, null, 'completed', 'answered_extracted', 'unknown', now(),
  '["structured_result.commitments[0].due is not a timestamp"]'::jsonb
);
SQL
)"
[[ "$(jq -S -c .counts <<<"$flag_summary")" == '{"commitments":1,"items":1,"mentions":2,"retirements":0}' ]] || {
  echo "the repaired result returned unexpected counts: $flag_summary" >&2
  exit 1
}
flag_values="$(named_values "$flag_run")"
[[ "$flag_values" == "due=none retired_mentions=80 commitment_offset=80 commitments=1" ]] || {
  echo "the repaired commitment's values read '$flag_values'" >&2
  exit 1
}
flag_event="$(psql <<SQL
select e.detail ->> 'calle_call_id' || ' ' || coalesce(e.detail -> 'skipped', 'null'::jsonb)::text
  || ' ' || (e.detail ->> 'mention_count')
  || ' ' || (select count(*) from public.item_mentions where call_run_id = '$flag_run')
  || ' ' || (select count(*) from public.call_events where call_run_id = '$flag_run' and kind = 'ingested')
from public.call_events e where e.call_run_id = '$flag_run' and e.kind = 'ingested';
SQL
)"
[[ "$flag_event" == 'call_t2_7_flag ["structured_result.commitments[0].due is not a timestamp"] 2 2 1' ]] || {
  echo "the ingested row of the repaired result read '$flag_event'" >&2
  exit 1
}
echo "T2.7 the ingested row carried the repair list beside the counts of the rows."

# Case eleven: `calle_failure` holds CALL-E's own failure verbatim, so the
# payload and the stored column each need a run that cannot pass by accident.
#   * `failed_run` stores `no_answer` and the payload names the fixture's
#     `call_failed`, so the payload must supersede a different stored code.
#   * `kept_run` stores `busy` and the payload names no failure at all, so only
#     the final `else v_run.calle_failure` can write that value.
#   * `webhook_failed_run` stores none, so the payload is the only source.
# Seeding this half with the fixture's own code let the payload branch alone
# satisfy it, which left the keep branch unmeasured.
failed_summary="$(psql <<SQL
set role service_role;
select public.ingest_call_result(
  '$failed_run', '$user_id',
  $(decode_utf8 "$failed_turns"),
  $(decode_utf8 "$failed_raw"),
  null, false, null, 'failed', 'not_answered', null, '$failed_completed_at'
);
SQL
)"
[[ "$(jq -r .already_ingested <<<"$failed_summary")" == "false" ]] || {
  echo "the failed run was already ingested: $failed_summary" >&2
  exit 1
}
psql >/dev/null <<SQL
set role service_role;
select public.ingest_call_result(
  '$webhook_failed_run', '$user_id',
  $(decode_utf8 "$failed_turns"),
  $(decode_utf8 "$failed_raw"),
  null, false, null, 'failed', 'not_answered', null, '$failed_completed_at'
);
SQL
failed_expected="failed not_answered null $(jq -r '.failure_code' "$fixtures/call-failed.json") $(jq -r '.failure_message' "$fixtures/call-failed.json") true false"
failed_row="$(psql <<SQL
select state || ' ' || disposition || ' ' || coalesce(mood, 'null')
  || ' ' || coalesce(calle_failure ->> 'failure_code', 'null')
  || ' ' || coalesce(calle_failure ->> 'failure_message', 'null')
  || ' ' || (completed_at is not null)::text
  || ' ' || billable::text
from public.call_runs where id = '$failed_run';
SQL
)"
[[ "$failed_row" == "$failed_expected" ]] || {
  echo "the run the poll failed did not take the payload's failure: '$failed_row'" >&2
  exit 1
}
webhook_failed_row="$(psql <<SQL
select state || ' ' || disposition || ' ' || coalesce(mood, 'null')
  || ' ' || coalesce(calle_failure ->> 'failure_code', 'null')
  || ' ' || coalesce(calle_failure ->> 'failure_message', 'null')
  || ' ' || (completed_at is not null)::text
  || ' ' || billable::text
from public.call_runs where id = '$webhook_failed_run';
SQL
)"
[[ "$webhook_failed_row" == "$failed_expected" ]] || {
  echo "the run the webhook failed read '$webhook_failed_row'" >&2
  exit 1
}
kept_summary="$(psql <<SQL
set role service_role;
select public.ingest_call_result(
  '$kept_run', '$user_id', '[]'::jsonb, '{"id":"call_t2_7_kept","status":"failed"}'::jsonb,
  null, false, null, 'failed', 'not_answered', null, now()
);
SQL
)"
[[ "$(jq -r .already_ingested <<<"$kept_summary")" == "false" ]] || {
  echo "the kept run was already ingested: $kept_summary" >&2
  exit 1
}
kept_row="$(psql <<SQL
select state || ' ' || disposition || ' ' || coalesce(mood, 'null')
  || ' ' || coalesce(calle_failure ->> 'failure_code', 'null')
  || ' ' || coalesce(calle_failure ->> 'failure_message', 'null')
  || ' ' || (completed_at is not null)::text
from public.call_runs where id = '$kept_run';
SQL
)"
[[ "$kept_row" == "failed not_answered null busy CALL-E reported a busy line true" ]] || {
  echo "the run whose payload repeated no CALL-E failure read '$kept_row'" >&2
  exit 1
}
# The poll and the webhook each stored CALL-E's own completion time, and neither
# run may read as finished at ingest time instead.
stored_completed_at "$failed_run" "$failed_completed_at"
stored_completed_at "$webhook_failed_run" "$failed_completed_at"
echo "T2.7 a failed call kept CALL-E's failure: poll '$failed_row' keep '$kept_row' webhook '$webhook_failed_row'."

# Case twelve: a replay that carries another proposal reports the proposal the
# run stored, never the one the retry asked for.
slot_first="$(psql <<SQL
set role service_role;
select public.ingest_call_result(
  '$slot_run', '$user_id', '[]'::jsonb, '{"id":"call_t2_7_slot"}'::jsonb,
  '{"captured_items":[],"retired_items":[],"commitments":[{"item_id":"$retired_item","due":"2026-09-12T03:00:00Z","evidence_offset_seconds":80}],"slot_change_requested":"yes"}'::jsonb,
  true, null, 'completed', 'answered_extracted', null, now()
);
SQL
)"
[[ "$(jq -r .slot_change_requested <<<"$slot_first")" == "yes" ]] || {
  echo "the first ingest did not report its own proposal: $slot_first" >&2
  exit 1
}
slot_replay="$(psql <<SQL
set role service_role;
select public.ingest_call_result(
  '$slot_run', '$user_id', '[]'::jsonb, '{"id":"call_t2_7_slot"}'::jsonb,
  '{"captured_items":[],"retired_items":[],"commitments":[{"item_id":"$retired_item","due":"2027-01-01T00:00:00Z","evidence_offset_seconds":90}],"slot_change_requested":"no"}'::jsonb,
  true, null, 'completed', 'answered_extracted', null, now()
);
SQL
)"
[[ "$(jq -r .already_ingested <<<"$slot_replay")" == "true" ]] || {
  echo "the replay was not marked already ingested: $slot_replay" >&2
  exit 1
}
[[ "$(jq -r .slot_change_requested <<<"$slot_replay")" == "yes" ]] || {
  echo "the replay reported the proposal '$(jq -r .slot_change_requested <<<"$slot_replay")', not the stored one" >&2
  exit 1
}
slot_stored="$(psql <<SQL
select (r.structured ->> 'slot_change_requested') || ' ' || r.valid::text
  || ' ' || (select count(*) from public.call_events where call_run_id = '$slot_run' and kind = 'ingested')
from public.results r where r.call_run_id = '$slot_run';
SQL
)"
[[ "$slot_stored" == "yes true 1" ]] || {
  echo "the stored results row read '$slot_stored'" >&2
  exit 1
}
# A replay changes no row, so the first result's due and evidence offset
# survive it, and no second commitment row appears.
slot_values="$(named_values "$slot_run")"
[[ "$slot_values" == "due=2026-09-12T03:00:00Z retired_mentions=80 commitment_offset=80 commitments=1" ]] || {
  echo "the replay changed the stored values: '$slot_values'" >&2
  exit 1
}
echo "T2.7 a replay reported the stored proposal: summary '$(jq -r .slot_change_requested <<<"$slot_replay")' stored '$slot_stored'."

# Case thirteen: a canceled run is terminal, and its disposition is its own.
# Nothing else drives the canceled state or the canceled disposition, so both
# are unmeasured without this run. The completion time is read back by value.
canceled_summary="$(psql <<SQL
set role service_role;
select public.ingest_call_result(
  '$canceled_run', '$user_id',
  '[]'::jsonb, '{"id":"call_t2_7_canceled","status":"canceled"}'::jsonb,
  null, false, null, 'canceled', 'canceled', null, '2026-09-12T02:30:00Z'
);
SQL
)"
[[ "$(jq -r .already_ingested <<<"$canceled_summary")" == "false" ]] || {
  echo "the canceled run was already ingested: $canceled_summary" >&2
  exit 1
}
[[ "$(jq -r .disposition <<<"$canceled_summary")" == "canceled" ]] || {
  echo "the canceled ingest reported '$(jq -r .disposition <<<"$canceled_summary")'" >&2
  exit 1
}
stored_completed_at "$canceled_run" '2026-09-12T02:30:00Z'
canceled_row="$(psql <<SQL
select state || ' ' || coalesce(disposition, 'null')
  || ' ' || (select count(*) from public.transcripts where call_run_id = '$canceled_run')
  || ' ' || (select count(*) from public.results where call_run_id = '$canceled_run')
  || ' ' || (select count(*) from public.call_events where call_run_id = '$canceled_run' and kind = 'ingested')
  || ' ' || billable::text
from public.call_runs where id = '$canceled_run';
SQL
)"
[[ "$canceled_row" == "canceled canceled 1 1 1 false" ]] || {
  echo "the canceled run read '$canceled_row'" >&2
  exit 1
}
echo "T2.7 a canceled call stored its own state, disposition and transcript."

# Case fourteen: `no_result` is the terminal state a call whose result failed
# validation lands in, and `answered_no_result` is its disposition. The state
# the poll and the webhook write is the state ingestion must accept.
validation_summary="$(psql <<SQL
set role service_role;
select public.ingest_call_result(
  '$validation_run', '$user_id',
  '[]'::jsonb, '{"id":"call_t2_10_no_result","status":"result_validation_failed"}'::jsonb,
  null, false, 'structured_result.captured_items must be an array',
  'no_result', 'answered_no_result', null, '2026-09-12T02:40:00Z'
);
SQL
)"
[[ "$(jq -r .already_ingested <<<"$validation_summary")" == "false" ]] || {
  echo "the validation failed run was already ingested: $validation_summary" >&2
  exit 1
}
validation_row="$(psql <<SQL
select state || ' ' || coalesce(disposition, 'null') || ' ' || billable::text
  || ' ' || (select count(*) from public.transcripts where call_run_id = '$validation_run')
from public.call_runs where id = '$validation_run';
SQL
)"
[[ "$validation_row" == "no_result answered_no_result true 1" ]] || {
  echo "the validation failed run read '$validation_row'" >&2
  exit 1
}
stored_completed_at "$validation_run" '2026-09-12T02:40:00Z'
echo "T2.7 a failed result validation stored no_result with its own disposition."

# Case fifteen: a rehearsal places no call, so its synthetic call id must never
# read as billed, whatever disposition its fixture lands on.
rehearsal_summary="$(psql <<SQL
set role service_role;
select public.ingest_call_result(
  '$rehearsal_run', '$user_id',
  '[]'::jsonb, '{"id":"call_t2_10_rehearsal","status":"completed"}'::jsonb,
  '{"captured_items":[],"retired_items":[],"commitments":[]}'::jsonb,
  true, null, 'completed', 'answered_extracted', 'calm', now()
);
SQL
)"
[[ "$(jq -r .already_ingested <<<"$rehearsal_summary")" == "false" ]] || {
  echo "the rehearsal was already ingested: $rehearsal_summary" >&2
  exit 1
}
rehearsal_row="$(psql <<SQL
select state || ' ' || coalesce(disposition, 'null') || ' ' || billable::text from public.call_runs where id = '$rehearsal_run';
SQL
)"
[[ "$rehearsal_row" == "completed answered_extracted false" ]] || {
  echo "the rehearsal read '$rehearsal_row', and no call was placed" >&2
  exit 1
}
echo "T2.7 a rehearsal with a synthetic call id was not billed."

# Case sixteen: a rehearsal that lands the validation-failure shape keeps the
# disposition that shape carries and the billing a rehearsal carries. No call
# was placed, so the pair is not a billed one, whatever the terminus.
no_result_rehearsal_summary="$(psql <<SQL
set role service_role;
select public.ingest_call_result(
  '$no_result_rehearsal_run', '$user_id',
  '[]'::jsonb, '{"id":"call_t2_10_no_result_rehearsal","status":"result_validation_failed"}'::jsonb,
  null, false, 'structured_result.captured_items must be an array',
  'no_result', 'answered_no_result', null, now()
);
SQL
)"
[[ "$(jq -r .already_ingested <<<"$no_result_rehearsal_summary")" == "false" ]] || {
  echo "the no_result rehearsal was already ingested: $no_result_rehearsal_summary" >&2
  exit 1
}
no_result_rehearsal_row="$(psql <<SQL
select state || ' ' || coalesce(disposition, 'null') || ' ' || billable::text from public.call_runs where id = '$no_result_rehearsal_run';
SQL
)"
[[ "$no_result_rehearsal_row" == "no_result answered_no_result false" ]] || {
  echo "the no_result rehearsal read '$no_result_rehearsal_row'" >&2
  exit 1
}
echo "T2.7 a rehearsal of the validation-failure shape was not billed."

# Case seventeen: the finaliser's give-up is the last writer for a run it can
# never finish, so it writes that run's disposition and its billing together.
# The spec's table says a failed run is `not_answered`, and nothing bills a run
# CALL-E never answered.
abandon_won="$(psql <<SQL
set role service_role;
select public.abandon_call_run(
  '$abandon_run',
  'the call re-fetch failed after 3 attempts'
);
SQL
)"
[[ "$abandon_won" == "t" ]] || {
  echo "the give-up did not win the run: '$abandon_won'" >&2
  exit 1
}
abandon_row="$(psql <<SQL
select state || ' ' || coalesce(disposition, 'null') || ' ' || billable::text
  || ' ' || (completed_at is not null)::text || ' ' || coalesce(finalise_error, 'null')
from public.call_runs where id = '$abandon_run';
SQL
)"
[[ "$abandon_row" == "failed not_answered false true the call re-fetch failed after 3 attempts" ]] || {
  echo "the abandoned run read '$abandon_row'" >&2
  exit 1
}
# The guarded update is not repeatable, so a second give-up changes no pair.
abandon_second="$(psql <<SQL
set role service_role;
select public.abandon_call_run('$abandon_run', 'a later tick');
SQL
)"
[[ "$abandon_second" == "f" ]] || {
  echo "a second give-up won an already ended run: '$abandon_second'" >&2
  exit 1
}
# A run with no provider call id takes the same pair, so the disposition does
# not depend on how far the dispatch got.
abandon_noid_won="$(psql <<SQL
set role service_role;
select public.abandon_call_run('$abandon_noid_run', 'the run has no CALL-E call id to re-fetch');
SQL
)"
[[ "$abandon_noid_won" == "t" ]] || {
  echo "the give-up on a run with no call id did not win: '$abandon_noid_won'" >&2
  exit 1
}
abandon_noid_row="$(psql <<SQL
select state || ' ' || coalesce(disposition, 'null') || ' ' || billable::text from public.call_runs where id = '$abandon_noid_run';
SQL
)"
[[ "$abandon_noid_row" == "failed not_answered false" ]] || {
  echo "the abandoned run with no call id read '$abandon_noid_row'" >&2
  exit 1
}
echo "T2.7 a given-up run stored not_answered with its billing."

# The seed's timeline is the one the demo shows, so every kind it writes must be
# one the eight-kind vocabulary names. An unknown kind is a row no reader can
# label.
seeded_timeline="$(psql <<SQL
select (select count(*) from public.call_events where call_run_id = '40000000-0000-4000-8000-000000000001')
  || ' ' || coalesce((
    select string_agg(distinct kind, ',' order by kind) from public.call_events
     where call_run_id = '40000000-0000-4000-8000-000000000001'
       and kind not in ('materialised','claimed','dispatched','polled','webhook_received','refetched','ingested','finalised')
  ), 'none');
SQL
)"
[[ "$seeded_timeline" == "2 none" ]] || {
  echo "the seeded run's timeline read '$seeded_timeline'" >&2
  exit 1
}
echo "T2.7 every seeded timeline kind is one the vocabulary names."

# Case eighteen: the pair is read over every terminal run at rest, not on one
# row. A terminal run must carry a disposition from the spec's four, and
# `billable` must agree with it and with whether CALL-E placed a real call.
# Three ways the two could disagree, and a null disposition, all count here.
pair_gaps="$(psql <<SQL
select count(*) from public.call_runs
 where state in ('completed','no_result','failed','canceled')
   and completed_at is not null
   and (
     disposition is null
     or (billable and disposition not in ('answered_extracted','answered_no_result'))
     or (billable and (calle_call_id is null or calle_call_id like 'fixture:%'))
     or (not billable and disposition in ('answered_extracted','answered_no_result')
         and calle_call_id is not null and calle_call_id not like 'fixture:%')
   );
SQL
)"
[[ "$pair_gaps" == "0" ]] || {
  echo "$pair_gaps terminal run(s) hold a disposition and a billing that disagree" >&2
  exit 1
}
echo "T2.7 every terminal run's disposition and billing agree."

echo "T2.7 ingestion acceptance passed."
