create table public.post_call_finalizations (
  id uuid primary key,
  senior_id uuid not null references public.seniors(id) on delete cascade,
  call_id uuid not null unique,
  provider_call_id text not null check (provider_call_id ~ '^call_[A-Za-z0-9_-]+$'),
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{64}$'),
  summary text not null check (char_length(summary) between 1 and 1200),
  sms_message text not null check (char_length(sms_message) between 1 and 480),
  sms_status text not null default 'not_requested'
    check (sms_status in ('not_requested', 'queued', 'sent', 'failed', 'unknown')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (call_id, senior_id) references public.call_sessions(id, senior_id) on delete cascade
);

create trigger post_call_finalizations_set_updated_at
before update on public.post_call_finalizations
for each row execute function private.set_updated_at();

alter table public.post_call_finalizations enable row level security;
grant select on public.post_call_finalizations to authenticated;
grant all on public.post_call_finalizations to service_role;

create policy post_call_content_member_select on public.post_call_finalizations
for select to authenticated
using ((select private.can_view_call_content(senior_id)));

create function public.reserve_post_call_finalization(
  p_id uuid,
  p_senior_id uuid,
  p_call_id uuid,
  p_provider_call_id text,
  p_fingerprint text,
  p_summary text,
  p_sms_message text,
  p_created_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  stored public.post_call_finalizations;
begin
  if not exists (
    select 1 from public.senior_preferences preference
    where preference.senior_id = p_senior_id
      and preference.store_summaries
      and preference.summary_sharing_consent_at is not null
  ) then
    raise exception 'summary consent is not active' using errcode = '42501';
  end if;

  insert into public.post_call_finalizations (
    id, senior_id, call_id, provider_call_id, fingerprint,
    summary, sms_message, created_at
  ) values (
    p_id, p_senior_id, p_call_id, p_provider_call_id, p_fingerprint,
    p_summary, p_sms_message, p_created_at
  ) on conflict (call_id) do nothing;

  select * into stored from public.post_call_finalizations where call_id = p_call_id;
  if stored.fingerprint <> p_fingerprint then
    raise exception 'call finalization changed after reservation';
  end if;

  update public.call_sessions set summary = stored.summary
  where id = p_call_id and senior_id = p_senior_id;
  if not found then raise exception 'call session does not exist'; end if;

  return jsonb_build_object(
    'callId', stored.provider_call_id,
    'callSessionId', stored.call_id,
    'createdAt', stored.created_at,
    'fingerprint', stored.fingerprint,
    'id', stored.id,
    'seniorId', stored.senior_id,
    'smsMessage', stored.sms_message,
    'smsStatus', stored.sms_status,
    'summary', stored.summary
  );
end;
$$;

create function public.update_post_call_sms_status(p_id uuid, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  stored public.post_call_finalizations;
begin
  if p_status not in ('queued', 'sent', 'failed', 'unknown') then
    raise exception 'invalid post-call SMS status';
  end if;
  update public.post_call_finalizations set sms_status = p_status
  where id = p_id returning * into stored;
  if not found then raise exception 'post-call finalization does not exist'; end if;
  return jsonb_build_object(
    'callId', stored.provider_call_id,
    'callSessionId', stored.call_id,
    'createdAt', stored.created_at,
    'fingerprint', stored.fingerprint,
    'id', stored.id,
    'seniorId', stored.senior_id,
    'smsMessage', stored.sms_message,
    'smsStatus', stored.sms_status,
    'summary', stored.summary
  );
end;
$$;

create function public.claim_post_call_sms(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed boolean := false;
  stored public.post_call_finalizations;
begin
  update public.post_call_finalizations
  set sms_status = 'queued'
  where id = p_id and sms_status = 'not_requested'
  returning * into stored;
  claimed := found;

  if not claimed then
    select * into stored from public.post_call_finalizations where id = p_id;
  end if;
  if not found then raise exception 'post-call finalization does not exist'; end if;

  return jsonb_build_object(
    'claimed', claimed,
    'record', jsonb_build_object(
      'callId', stored.provider_call_id,
      'callSessionId', stored.call_id,
      'createdAt', stored.created_at,
      'fingerprint', stored.fingerprint,
      'id', stored.id,
      'seniorId', stored.senior_id,
      'smsMessage', stored.sms_message,
      'smsStatus', stored.sms_status,
      'summary', stored.summary
    )
  );
end;
$$;

create function private.delete_finalization_with_cleared_summary()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.summary is not null and new.summary is null then
    delete from public.post_call_finalizations where call_id = new.id;
  end if;
  return new;
end;
$$;

create trigger delete_finalization_with_cleared_summary
after update of summary on public.call_sessions
for each row execute function private.delete_finalization_with_cleared_summary();

revoke all on function public.reserve_post_call_finalization(uuid, uuid, uuid, text, text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.update_post_call_sms_status(uuid, text) from public, anon, authenticated;
revoke all on function public.claim_post_call_sms(uuid) from public, anon, authenticated;
grant execute on function public.reserve_post_call_finalization(uuid, uuid, uuid, text, text, text, text, timestamptz) to service_role;
grant execute on function public.update_post_call_sms_status(uuid, text) to service_role;
grant execute on function public.claim_post_call_sms(uuid) to service_role;
