-- Apply after 002_callback_safety.sql on existing AsyncFounders deployments.
drop policy if exists "call_read" on public.call_sessions;
create policy "call_read" on public.call_sessions for select using (requested_by=auth.uid() and public.is_company_member(company_id));

update public.call_sessions
set result=jsonb_strip_nulls(jsonb_build_object(
  'taskCompleted',result->'taskCompleted',
  'confidenceScore',coalesce(result->'confidenceScore',result#>'{confidence,score}'),
  'outcome',result->'outcome',
  'memoryItemsCreated',result->'memoryItemsCreated',
  'simulated',result->'simulated'
))
where result ? 'transcriptEvidence' or result ? 'providerEvidence' or result ? 'evidence';

create or replace function public.create_call_preview(
  target_session uuid,
  target_company uuid,
  target_member uuid,
  target_user uuid,
  target_mode text,
  target_provider text,
  target_fingerprint text,
  target_preview jsonb
)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare existing_session record;
begin
  perform pg_advisory_xact_lock(hashtextextended(target_company::text || ':' || target_member::text || ':' || target_user::text, 0));
  if not exists (
    select 1 from public.company_members
    where id=target_member and company_id=target_company and user_id=target_user and status='active'
  ) then raise exception 'Requester is not the active callback recipient'; end if;
  if (target_preview->>'previewId') is distinct from target_session::text
    or (target_preview->>'companyId') is distinct from target_company::text
    or (target_preview->>'memberId') is distinct from target_member::text
    or (target_preview->>'requestedBy') is distinct from target_user::text
    or (target_preview->>'fingerprint') is distinct from target_fingerprint
  then raise exception 'Preview payload mismatch'; end if;

  update public.call_sessions
  set status='expired'
  where company_id=target_company and member_id=target_member and requested_by=target_user
    and status='previewed' and (preview->>'expiresAt')::timestamptz < now();

  select id,status,provider_call_id into existing_session
  from public.call_sessions
  where company_id=target_company and member_id=target_member and requested_by=target_user
    and status not in ('completed','failed','cancelled','canceled','no_answer','busy','declined','expired','voicemail')
  order by requested_at desc limit 1;

  if existing_session.id is not null then
    return jsonb_build_object('created',false,'previewId',existing_session.id,'status',existing_session.status,'providerCallId',existing_session.provider_call_id);
  end if;

  insert into public.call_sessions(id,company_id,member_id,requested_by,mode,provider,status,payload_fingerprint,preview)
  values(target_session,target_company,target_member,target_user,target_mode,target_provider,'previewed',target_fingerprint,target_preview);
  return jsonb_build_object('created',true,'previewId',target_session,'status','previewed');
end $$;
revoke all on function public.create_call_preview(uuid,uuid,uuid,uuid,text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.create_call_preview(uuid,uuid,uuid,uuid,text,text,text,jsonb) to service_role;
