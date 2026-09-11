-- Apply after 001_production_schema.sql on existing AsyncFounders deployments.
alter table public.call_sessions add column if not exists dispatch_claimed_at timestamptz;
alter table public.call_sessions add column if not exists dispatch_attempts integer not null default 0;
alter table public.call_sessions add column if not exists dispatch_last_error text;

create or replace function public.claim_call_session(target_session uuid, target_user uuid, expected_fingerprint text)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare session_row public.call_sessions%rowtype;
begin
  select * into session_row from public.call_sessions where id=target_session for update;
  if session_row.id is null then raise exception 'Callback preview not found'; end if;
  if session_row.requested_by <> target_user then raise exception 'Callback requester mismatch'; end if;
  if session_row.payload_fingerprint <> expected_fingerprint then raise exception 'Callback fingerprint mismatch'; end if;
  if not exists (
    select 1 from public.company_members
    where company_id=session_row.company_id and user_id=target_user and status='active'
  ) then raise exception 'Requester is no longer an active company member'; end if;
  if session_row.status='previewed' then
    update public.call_sessions set status='dispatching',confirmed_at=now(),dispatch_claimed_at=now(),dispatch_attempts=dispatch_attempts+1,dispatch_last_error=null where id=target_session;
  elsif session_row.status='dispatching' and session_row.provider_call_id is null then
    update public.call_sessions set dispatch_claimed_at=now(),dispatch_attempts=dispatch_attempts+1,dispatch_last_error=null where id=target_session;
  else
    raise exception 'Callback is not claimable';
  end if;
  return jsonb_build_object('id',target_session,'status','dispatching');
end $$;
revoke all on function public.claim_call_session(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.claim_call_session(uuid,uuid,text) to service_role;

drop function if exists public.ingest_call_memory(uuid,jsonb);
create or replace function public.ingest_call_memory(target_session uuid, target_user uuid, memory_payload jsonb)
returns integer language plpgsql security definer set search_path = public
as $$
declare session_row public.call_sessions%rowtype; item jsonb; next_version bigint; inserted_count integer := 0;
begin
  select * into session_row from public.call_sessions where id=target_session for update;
  if session_row.id is null or session_row.memory_ingested_at is not null then return 0; end if;
  if session_row.requested_by <> target_user or session_row.provider_call_id is null then raise exception 'Callback is not authorized for memory ingestion'; end if;
  if not exists (
    select 1 from public.company_members
    where company_id=session_row.company_id and user_id=target_user and status='active'
  ) then raise exception 'Requester is no longer an active company member'; end if;
  for item in select * from jsonb_array_elements(memory_payload)
  loop
    update public.companies set current_version=current_version+1 where id=session_row.company_id returning current_version into next_version;
    insert into public.memory_items(company_id,version,kind,title,body,status,confidence,author_member_id,source_call_id,source_excerpt,audience)
    values(session_row.company_id,next_version,(item->>'type')::public.memory_kind,item->>'title',item->>'body',(item->>'status')::public.memory_status,coalesce((item->>'confidence')::numeric,0.5),session_row.member_id,session_row.id,item->>'source_excerpt',coalesce(item->'audience','["team"]'::jsonb));
    inserted_count := inserted_count + 1;
  end loop;
  update public.call_sessions set memory_ingested_at=now() where id=target_session;
  return inserted_count;
end $$;
revoke all on function public.ingest_call_memory(uuid,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.ingest_call_memory(uuid,uuid,jsonb) to service_role;
