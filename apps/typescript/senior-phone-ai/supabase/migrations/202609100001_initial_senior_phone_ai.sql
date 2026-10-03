create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated, service_role;

create type public.membership_role as enum ('owner', 'family', 'carer');
create type public.workflow_status as enum ('pending', 'queued', 'in_progress', 'completed', 'failed', 'canceled', 'unknown');
create type public.authorization_state as enum ('pending', 'confirmed', 'denied', 'consumed', 'expired');
create type public.delivery_channel as enum ('sms', 'call');

create table public.seniors (
  id uuid primary key default extensions.gen_random_uuid(),
  display_name text not null check (char_length(display_name) between 1 and 100),
  timezone text not null check (char_length(timezone) between 1 and 100),
  approximate_location text check (approximate_location is null or char_length(approximate_location) <= 160),
  interests text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.senior_memberships (
  senior_id uuid not null references public.seniors(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.membership_role not null,
  can_view_call_content boolean not null default false,
  can_manage_contacts boolean not null default false,
  can_manage_reminders boolean not null default false,
  sharing_approved_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (senior_id, user_id)
);

create table public.senior_preferences (
  senior_id uuid primary key references public.seniors(id) on delete cascade,
  store_transcripts boolean not null default false,
  store_summaries boolean not null default false,
  transcript_consent_at timestamptz,
  summary_sharing_consent_at timestamptz,
  retention_days integer not null default 30 check (retention_days between 1 and 365),
  quiet_hours_start time,
  quiet_hours_end time,
  updated_at timestamptz not null default now(),
  check (not store_transcripts or transcript_consent_at is not null),
  check (not store_summaries or summary_sharing_consent_at is not null)
);

create table public.trusted_contacts (
  id uuid primary key default extensions.gen_random_uuid(),
  senior_id uuid not null references public.seniors(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 100),
  relationship text check (relationship is null or char_length(relationship) <= 80),
  destination_e164 text check (destination_e164 is null or destination_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  approved_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.membership_invites (
  id uuid primary key default extensions.gen_random_uuid(),
  senior_id uuid not null references public.seniors(id) on delete cascade,
  email text not null check (char_length(email) between 3 and 254),
  role public.membership_role not null,
  token_hash text not null unique check (char_length(token_hash) >= 32),
  created_by uuid not null references auth.users(id),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.call_sessions (
  id uuid primary key default extensions.gen_random_uuid(),
  senior_id uuid not null references public.seniors(id) on delete cascade,
  correlation_id uuid not null unique,
  direction text not null check (direction in ('browser', 'inbound', 'outbound')),
  status public.workflow_status not null default 'pending',
  summary text check (summary is null or char_length(summary) <= 2000),
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, senior_id)
);

create table public.call_transcripts (
  call_id uuid primary key,
  senior_id uuid not null,
  transcript text not null check (char_length(transcript) <= 50000),
  consent_captured_at timestamptz not null,
  created_at timestamptz not null default now(),
  foreign key (call_id, senior_id) references public.call_sessions(id, senior_id) on delete cascade
);

create table public.tool_activities (
  id uuid primary key default extensions.gen_random_uuid(),
  senior_id uuid not null references public.seniors(id) on delete cascade,
  call_id uuid,
  correlation_id uuid not null,
  tool_name text not null check (char_length(tool_name) between 1 and 80),
  status public.workflow_status not null,
  safe_details jsonb not null default '{}'::jsonb check (jsonb_typeof(safe_details) = 'object'),
  created_at timestamptz not null default now(),
  foreign key (call_id, senior_id) references public.call_sessions(id, senior_id) on delete cascade
);

create table public.action_authorizations (
  id uuid primary key default extensions.gen_random_uuid(),
  senior_id uuid not null references public.seniors(id) on delete cascade,
  principal_user_id uuid not null references auth.users(id),
  action text not null check (action in ('send_sms', 'create_reminder', 'contact_trusted_person', 'place_outbound_call')),
  destination_e164 text not null check (destination_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  purpose text not null check (char_length(purpose) between 1 and 200),
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  state public.authorization_state not null default 'pending',
  expires_at timestamptz not null,
  confirmed_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > created_at),
  unique (id, senior_id)
);

create table public.sms_messages (
  id uuid primary key default extensions.gen_random_uuid(),
  senior_id uuid not null references public.seniors(id) on delete cascade,
  call_id uuid,
  authorization_id uuid not null,
  correlation_id uuid not null,
  idempotency_key text not null unique check (char_length(idempotency_key) between 8 and 128),
  destination_e164 text not null check (destination_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  destination_last4 text not null check (destination_last4 ~ '^[0-9]{4}$'),
  purpose text not null check (char_length(purpose) between 1 and 200),
  message text not null check (char_length(message) between 1 and 480),
  status text not null check (status in ('previewed', 'queued', 'sent', 'failed', 'unknown')),
  provider_message_id text unique,
  last_delivery_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (call_id, senior_id) references public.call_sessions(id, senior_id) on delete cascade,
  foreign key (authorization_id, senior_id) references public.action_authorizations(id, senior_id)
);

create table public.sms_delivery_events (
  event_id text primary key check (char_length(event_id) between 1 and 200),
  sms_id uuid not null references public.sms_messages(id) on delete cascade,
  provider_message_id text not null check (char_length(provider_message_id) between 1 and 200),
  status text not null check (status in ('sent', 'failed')),
  occurred_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table public.reminders (
  id uuid primary key default extensions.gen_random_uuid(),
  senior_id uuid not null references public.seniors(id) on delete cascade,
  authorization_id uuid not null,
  principal_user_id uuid not null references auth.users(id),
  idempotency_key text not null unique check (char_length(idempotency_key) between 8 and 128),
  destination_e164 text not null check (destination_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  message text not null check (char_length(message) between 1 and 500),
  timezone text not null check (char_length(timezone) between 1 and 100),
  scheduled_for timestamptz not null,
  channel public.delivery_channel not null,
  status public.workflow_status not null default 'pending',
  canceled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (authorization_id, senior_id) references public.action_authorizations(id, senior_id)
);

create table public.scheduled_deliveries (
  id uuid primary key default extensions.gen_random_uuid(),
  senior_id uuid not null references public.seniors(id) on delete cascade,
  reminder_id uuid references public.reminders(id) on delete cascade,
  idempotency_key text not null unique check (char_length(idempotency_key) between 8 and 128),
  due_at timestamptz not null,
  channel public.delivery_channel not null,
  status public.workflow_status not null default 'pending',
  provider_reference text,
  claimed_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.scheduled_check_ins (
  id uuid primary key default extensions.gen_random_uuid(),
  senior_id uuid not null references public.seniors(id) on delete cascade,
  enabled boolean not null default false,
  timezone text not null check (char_length(timezone) between 1 and 100),
  schedule_expression text not null check (char_length(schedule_expression) between 1 and 120),
  next_run_at timestamptz,
  canceled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index senior_memberships_user_id_idx on public.senior_memberships(user_id) where revoked_at is null;
create index trusted_contacts_senior_id_idx on public.trusted_contacts(senior_id);
create index call_sessions_senior_id_idx on public.call_sessions(senior_id, created_at desc);
create index tool_activities_senior_id_idx on public.tool_activities(senior_id, created_at desc);
create index sms_messages_senior_id_idx on public.sms_messages(senior_id, created_at desc);
create index sms_delivery_events_sms_id_idx on public.sms_delivery_events(sms_id, occurred_at desc);
create index reminders_senior_id_idx on public.reminders(senior_id, scheduled_for);
create index scheduled_deliveries_due_idx on public.scheduled_deliveries(status, due_at);

create function private.is_senior_member(target_senior_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.senior_memberships membership
    where membership.senior_id = target_senior_id
      and membership.user_id = (select auth.uid())
      and membership.revoked_at is null
  );
$$;

create function private.can_view_call_content(target_senior_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.senior_memberships membership
    where membership.senior_id = target_senior_id
      and membership.user_id = (select auth.uid())
      and membership.revoked_at is null
      and membership.can_view_call_content
  );
$$;

revoke all on function private.is_senior_member(uuid) from public;
revoke all on function private.can_view_call_content(uuid) from public;
grant execute on function private.is_senior_member(uuid) to authenticated;
grant execute on function private.can_view_call_content(uuid) to authenticated;

create function private.enforce_transcript_consent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.senior_preferences preference
    where preference.senior_id = new.senior_id
      and preference.store_transcripts
      and preference.transcript_consent_at is not null
      and new.consent_captured_at >= preference.transcript_consent_at
  ) then
    raise exception 'transcript consent is not active' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger enforce_transcript_consent
before insert or update on public.call_transcripts
for each row execute function private.enforce_transcript_consent();

create function private.enforce_summary_consent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.summary is not null
    and (tg_op = 'INSERT' or old.summary is distinct from new.summary)
    and not exists (
      select 1 from public.senior_preferences preference
      where preference.senior_id = new.senior_id
        and preference.store_summaries
        and preference.summary_sharing_consent_at is not null
    ) then
    raise exception 'summary consent is not active' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger enforce_summary_consent
before insert or update on public.call_sessions
for each row execute function private.enforce_summary_consent();

create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger seniors_set_updated_at before update on public.seniors
for each row execute function private.set_updated_at();
create trigger preferences_set_updated_at before update on public.senior_preferences
for each row execute function private.set_updated_at();
create trigger calls_set_updated_at before update on public.call_sessions
for each row execute function private.set_updated_at();
create trigger sms_set_updated_at before update on public.sms_messages
for each row execute function private.set_updated_at();
create trigger reminders_set_updated_at before update on public.reminders
for each row execute function private.set_updated_at();
create trigger check_ins_set_updated_at before update on public.scheduled_check_ins
for each row execute function private.set_updated_at();

create function private.delete_expired_senior_data(reference_time timestamptz default now())
returns table (
  deleted_transcripts bigint,
  deleted_tool_activities bigint,
  deleted_sms_messages bigint,
  cleared_call_summaries bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  transcript_count bigint;
  activity_count bigint;
  sms_count bigint;
  summary_count bigint;
begin
  delete from public.call_transcripts transcript
  using public.senior_preferences preference
  where transcript.senior_id = preference.senior_id
    and transcript.created_at < reference_time - make_interval(days => preference.retention_days);
  get diagnostics transcript_count = row_count;

  delete from public.tool_activities activity
  using public.senior_preferences preference
  where activity.senior_id = preference.senior_id
    and activity.created_at < reference_time - make_interval(days => preference.retention_days);
  get diagnostics activity_count = row_count;

  delete from public.sms_messages sms
  using public.senior_preferences preference
  where sms.senior_id = preference.senior_id
    and sms.created_at < reference_time - make_interval(days => preference.retention_days);
  get diagnostics sms_count = row_count;

  update public.call_sessions call
  set summary = null
  from public.senior_preferences preference
  where call.senior_id = preference.senior_id
    and call.summary is not null
    and call.created_at < reference_time - make_interval(days => preference.retention_days);
  get diagnostics summary_count = row_count;

  return query select transcript_count, activity_count, sms_count, summary_count;
end;
$$;

revoke all on function private.enforce_transcript_consent() from public, anon, authenticated;
revoke all on function private.enforce_summary_consent() from public, anon, authenticated;
revoke all on function private.set_updated_at() from public, anon, authenticated;
revoke all on function private.delete_expired_senior_data(timestamptz) from public, anon, authenticated;
grant execute on function private.delete_expired_senior_data(timestamptz) to service_role;

create function public.apply_sms_delivery_event(
  p_event_id text,
  p_provider_message_id text,
  p_status text,
  p_occurred_at timestamptz
)
returns setof public.sms_messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_sms_id uuid;
  inserted_count integer;
begin
  if p_status not in ('sent', 'failed')
    or char_length(p_event_id) not between 1 and 200
    or char_length(p_provider_message_id) not between 1 and 200 then
    raise exception 'invalid verified SMS delivery event' using errcode = '22023';
  end if;

  select message.id into target_sms_id
  from public.sms_messages message
  where message.provider_message_id = p_provider_message_id;
  if target_sms_id is null then
    return;
  end if;

  insert into public.sms_delivery_events (
    event_id, sms_id, provider_message_id, status, occurred_at
  ) values (
    p_event_id, target_sms_id, p_provider_message_id, p_status, p_occurred_at
  ) on conflict (event_id) do nothing;
  get diagnostics inserted_count = row_count;

  if inserted_count = 1 then
    update public.sms_messages message
    set status = p_status,
        last_delivery_at = p_occurred_at,
        updated_at = greatest(message.updated_at, p_occurred_at)
    where message.id = target_sms_id
      and (message.last_delivery_at is null or message.last_delivery_at <= p_occurred_at);
  end if;

  return query select message.* from public.sms_messages message where message.id = target_sms_id;
end;
$$;

revoke all on function public.apply_sms_delivery_event(text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.apply_sms_delivery_event(text, text, text, timestamptz) to service_role;

alter table public.seniors enable row level security;
alter table public.senior_memberships enable row level security;
alter table public.senior_preferences enable row level security;
alter table public.trusted_contacts enable row level security;
alter table public.membership_invites enable row level security;
alter table public.call_sessions enable row level security;
alter table public.call_transcripts enable row level security;
alter table public.tool_activities enable row level security;
alter table public.action_authorizations enable row level security;
alter table public.sms_messages enable row level security;
alter table public.sms_delivery_events enable row level security;
alter table public.reminders enable row level security;
alter table public.scheduled_deliveries enable row level security;
alter table public.scheduled_check_ins enable row level security;

revoke all on public.seniors, public.senior_memberships, public.senior_preferences,
  public.trusted_contacts, public.membership_invites, public.call_sessions,
  public.call_transcripts, public.tool_activities, public.action_authorizations,
  public.sms_messages, public.sms_delivery_events, public.reminders,
  public.scheduled_deliveries, public.scheduled_check_ins from anon, authenticated;
grant select on public.seniors, public.senior_memberships, public.senior_preferences,
  public.trusted_contacts, public.call_sessions, public.call_transcripts,
  public.tool_activities, public.sms_messages, public.sms_delivery_events, public.reminders,
  public.scheduled_deliveries, public.scheduled_check_ins to authenticated;

create policy seniors_member_select on public.seniors for select to authenticated
using ((select auth.uid()) is not null and private.is_senior_member(id));
create policy memberships_self_select on public.senior_memberships for select to authenticated
using ((select auth.uid()) is not null and user_id = (select auth.uid()) and revoked_at is null);
create policy preferences_member_select on public.senior_preferences for select to authenticated
using ((select auth.uid()) is not null and private.is_senior_member(senior_id));
create policy contacts_member_select on public.trusted_contacts for select to authenticated
using ((select auth.uid()) is not null and private.is_senior_member(senior_id));
create policy calls_content_member_select on public.call_sessions for select to authenticated
using ((select auth.uid()) is not null and private.can_view_call_content(senior_id));
create policy transcripts_content_member_select on public.call_transcripts for select to authenticated
using ((select auth.uid()) is not null and private.can_view_call_content(senior_id));
create policy activities_content_member_select on public.tool_activities for select to authenticated
using ((select auth.uid()) is not null and private.can_view_call_content(senior_id));
create policy sms_member_select on public.sms_messages for select to authenticated
using ((select auth.uid()) is not null and private.is_senior_member(senior_id));
create policy sms_events_member_select on public.sms_delivery_events for select to authenticated
using (
  (select auth.uid()) is not null
  and exists (
    select 1 from public.sms_messages message
    where message.id = sms_id and private.is_senior_member(message.senior_id)
  )
);
create policy reminders_member_select on public.reminders for select to authenticated
using ((select auth.uid()) is not null and private.is_senior_member(senior_id));
create policy deliveries_member_select on public.scheduled_deliveries for select to authenticated
using ((select auth.uid()) is not null and private.is_senior_member(senior_id));
create policy check_ins_member_select on public.scheduled_check_ins for select to authenticated
using ((select auth.uid()) is not null and private.is_senior_member(senior_id));
