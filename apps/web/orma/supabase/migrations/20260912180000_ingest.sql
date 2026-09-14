-- T2.7: Turning a terminal call into rows must be one transaction. PostgREST
-- cannot hold a transaction across several REST calls, so ingestion lives in
-- this function. It locks the run, then writes the transcript, the result, the
-- items, their mentions, the retirements, the commitments and the `ingested`
-- timeline row in one unit. A second ingest for the same run waits on the
-- lock, then returns the already_ingested marker and changes nothing.
create function public.ingest_call_result(
  p_call_run_id uuid,
  p_user_id uuid,
  p_transcript_turns jsonb,
  p_raw jsonb,
  p_structured jsonb,
  p_result_valid boolean,
  p_result_error text,
  p_state text,
  p_disposition text,
  p_mood text,
  p_completed_at timestamptz,
  p_skipped jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.call_runs%rowtype;
  v_entry jsonb;
  v_item_id uuid;
  v_offset integer;
  v_due timestamptz;
  v_calle_call_id text;
  v_slot_change text;
  v_failure jsonb;
  v_items integer := 0;
  v_mentions integer := 0;
  v_retirements integer := 0;
  v_commitments integer := 0;
begin
  if p_call_run_id is null then
    raise exception 'ingest requires a call run id';
  end if;
  if p_user_id is null then
    raise exception 'ingest requires a user id';
  end if;
  -- `no_result` is the terminal state `spec.md` section 3 names for a call
  -- whose result failed validation. `answered_no_result` is its disposition.
  if p_state not in ('completed', 'no_result', 'failed', 'canceled') then
    raise exception 'ingest requires a terminal state, got %', p_state;
  end if;
  if p_disposition not in ('answered_extracted', 'answered_no_result', 'not_answered', 'canceled') then
    raise exception 'ingest requires a known disposition, got %', p_disposition;
  end if;

  select * into v_run from public.call_runs where id = p_call_run_id for update;
  if not found then
    raise exception 'call run % does not exist', p_call_run_id;
  end if;
  if v_run.user_id <> p_user_id then
    raise exception 'call run % does not belong to user %', p_call_run_id, p_user_id;
  end if;

  -- The run already holds its result. A retry's request never reaches this
  -- summary, so a replay carrying another proposal reports what the run stored.
  if exists (select 1 from public.results where call_run_id = p_call_run_id) then
    select r.structured ->> 'slot_change_requested'
      into v_slot_change
      from public.results r
     where r.call_run_id = p_call_run_id;
    return jsonb_build_object(
      'already_ingested', true,
      'disposition', v_run.disposition,
      'counts', jsonb_build_object(
        'items', 0,
        'mentions', 0,
        'retirements', 0,
        'commitments', 0
      ),
      'slot_change_requested', v_slot_change
    );
  end if;

  insert into public.transcripts (call_run_id, turns, raw, fetched_at)
  values (p_call_run_id, coalesce(p_transcript_turns, '[]'::jsonb), p_raw, now())
  on conflict (call_run_id) do update
    set turns = excluded.turns,
        raw = excluded.raw,
        fetched_at = now();

  insert into public.results (call_run_id, structured, valid, error, fetched_at)
  values (p_call_run_id, p_structured, p_result_valid, p_result_error, now())
  on conflict (call_run_id) do update
    set structured = excluded.structured,
        valid = excluded.valid,
        error = excluded.error,
        fetched_at = now();

  for v_entry in select value from jsonb_array_elements(coalesce(p_structured -> 'captured_items', '[]'::jsonb)) loop
    if v_entry ->> 'text' is null or btrim(v_entry ->> 'text') = '' then
      raise exception 'captured item requires text';
    end if;
    if not (v_entry ? 'evidence_offset_seconds') then
      raise exception 'captured item requires an evidence offset';
    end if;
    v_offset := (v_entry ->> 'evidence_offset_seconds')::integer;
    insert into public.items (user_id, text, source)
    values (p_user_id, v_entry ->> 'text', 'call')
    returning id into v_item_id;
    insert into public.item_mentions (item_id, call_run_id, offset_seconds)
    values (v_item_id, p_call_run_id, v_offset);
    v_items := v_items + 1;
    v_mentions := v_mentions + 1;
  end loop;

  for v_entry in select value from jsonb_array_elements(coalesce(p_structured -> 'retired_items', '[]'::jsonb)) loop
    v_item_id := (v_entry ->> 'item_id')::uuid;
    if v_item_id is null then
      raise exception 'retired item requires an item id';
    end if;
    if not (v_entry ? 'evidence_offset_seconds') then
      raise exception 'retired item % requires an evidence offset', v_item_id;
    end if;
    v_offset := (v_entry ->> 'evidence_offset_seconds')::integer;
    update public.items
       set status = 'retired',
           retired_at = coalesce(retired_at, now()),
           retired_reason = coalesce(retired_reason, 'retired on the call')
     where id = v_item_id
       and user_id = p_user_id;
    if not found then
      raise exception 'retired item % does not belong to user %', v_item_id, p_user_id;
    end if;
    insert into public.item_mentions (item_id, call_run_id, offset_seconds)
    values (v_item_id, p_call_run_id, v_offset);
    v_retirements := v_retirements + 1;
    v_mentions := v_mentions + 1;
  end loop;

  for v_entry in select value from jsonb_array_elements(coalesce(p_structured -> 'commitments', '[]'::jsonb)) loop
    v_item_id := (v_entry ->> 'item_id')::uuid;
    if v_item_id is null then
      raise exception 'commitment requires an item id';
    end if;
    if not (v_entry ? 'evidence_offset_seconds') then
      raise exception 'commitment on item % requires an evidence offset', v_item_id;
    end if;
    v_offset := (v_entry ->> 'evidence_offset_seconds')::integer;
    if not exists (select 1 from public.items where id = v_item_id and user_id = p_user_id) then
      raise exception 'commitment item % does not belong to user %', v_item_id, p_user_id;
    end if;
    if v_entry ? 'due' and v_entry ->> 'due' is not null then
      v_due := (v_entry ->> 'due')::timestamptz;
    else
      v_due := null;
    end if;
    insert into public.commitments (item_id, user_id, call_run_id, due, evidence_offset_seconds)
    values (v_item_id, p_user_id, p_call_run_id, v_due, v_offset);
    insert into public.item_mentions (item_id, call_run_id, offset_seconds)
    values (v_item_id, p_call_run_id, v_offset);
    v_commitments := v_commitments + 1;
    v_mentions := v_mentions + 1;
  end loop;

  -- `calle_failure` holds CALL-E's own failure verbatim, so the payload's own
  -- failure is the value whenever it names one. When it names none, only the
  -- poll's give-up marker is contradicted, so only that marker clears.
  v_calle_call_id := nullif(btrim(coalesce(p_raw ->> 'id', '')), '');
  v_failure := case
    when nullif(btrim(coalesce(p_raw ->> 'failure_code', '')), '') is not null then
      jsonb_build_object(
        'failure_code', p_raw ->> 'failure_code',
        'failure_message', coalesce(p_raw ->> 'failure_message', '')
      )
    when v_run.calle_failure ->> 'failure_code' = 'poll_timeout' then null
    else v_run.calle_failure
  end;
  -- `billable` follows the disposition, and only a call CALL-E actually placed
  -- can bill. A rehearsal writes a synthetic `fixture:` call id, and a run with
  -- no call id never reached the provider, so neither one can read as billed.
  update public.call_runs
     set state = p_state,
         disposition = p_disposition,
         billable = p_disposition in ('answered_extracted', 'answered_no_result')
           and v_run.calle_call_id is not null
           and v_run.calle_call_id not like 'fixture:%',
         mood = p_mood,
         calle_failure = v_failure,
         completed_at = coalesce(p_completed_at, now())
   where id = p_call_run_id;

  -- The timeline row lands inside this transaction. A committed ingest can
  -- never lose its row, and a second ingest can never write a second one.
  insert into public.call_events (call_run_id, kind, detail)
  values (
    p_call_run_id,
    'ingested',
    jsonb_build_object(
      'call_run_id', p_call_run_id,
      'calle_call_id', v_calle_call_id,
      'state', p_state,
      'disposition', p_disposition,
      'item_count', v_items,
      'mention_count', v_mentions,
      'retirement_count', v_retirements,
      'commitment_count', v_commitments,
      'skipped', coalesce(p_skipped, '[]'::jsonb)
    )
  );

  return jsonb_build_object(
    'already_ingested', false,
    'disposition', p_disposition,
    'counts', jsonb_build_object(
      'items', v_items,
      'mentions', v_mentions,
      'retirements', v_retirements,
      'commitments', v_commitments
    ),
    'slot_change_requested', p_structured ->> 'slot_change_requested'
  );
end;
$$;

-- The caller is the service role only. Ingestion writes for any user, so an
-- authenticated or anonymous session must never reach it.
revoke all on function public.ingest_call_result(
  uuid, uuid, jsonb, jsonb, jsonb, boolean, text, text, text, text, timestamptz, jsonb
) from public;
revoke all on function public.ingest_call_result(
  uuid, uuid, jsonb, jsonb, jsonb, boolean, text, text, text, text, timestamptz, jsonb
) from anon;
revoke all on function public.ingest_call_result(
  uuid, uuid, jsonb, jsonb, jsonb, boolean, text, text, text, text, timestamptz, jsonb
) from authenticated;
grant execute on function public.ingest_call_result(
  uuid, uuid, jsonb, jsonb, jsonb, boolean, text, text, text, text, timestamptz, jsonb
) to service_role;
