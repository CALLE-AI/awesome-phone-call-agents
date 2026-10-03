create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  phone_e164 text check (phone_e164 ~ '^\+[1-9]\d{7,14}$'),
  phone_confirmed_at timestamptz,
  timezone text not null default 'Asia/Kolkata',
  telegram_chat_id bigint unique,
  email_receipts boolean not null default false,
  telegram_receipts boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  text_version text not null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  source text not null
);

create table public.slots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  local_time time not null,
  weekdays smallint[] not null default '{1,2,3,4,5,6,7}',
  part_of_day text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  text text not null,
  status text not null default 'open',
  since_date date,
  source text not null,
  seeded boolean not null default false,
  created_at timestamptz not null default now(),
  retired_at timestamptz,
  retired_reason text
);

create table public.call_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  slot_id uuid references public.slots(id) on delete set null,
  local_date date not null,
  part_of_day text not null,
  scheduled_for timestamptz not null,
  state text not null default 'scheduled',
  disposition text,
  mood text,
  poll_after timestamptz,
  idempotency_key text not null unique,
  calle_call_id text,
  calle_confidence jsonb,
  calle_failure jsonb,
  briefing jsonb,
  dry_run boolean not null default false,
  billable boolean not null default false,
  claimed_at timestamptz,
  dispatched_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create index call_runs_state_scheduled_for_idx
  on public.call_runs (state, scheduled_for);

create index call_runs_user_id_local_date_idx
  on public.call_runs (user_id, local_date);

create table public.item_mentions (
  id bigserial primary key,
  item_id uuid not null references public.items(id) on delete cascade,
  call_run_id uuid references public.call_runs(id) on delete set null,
  offset_seconds integer,
  created_at timestamptz not null default now()
);

create index item_mentions_item_id_created_at_idx
  on public.item_mentions (item_id, created_at);

create table public.commitments (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  call_run_id uuid references public.call_runs(id) on delete set null,
  due timestamptz,
  evidence_offset_seconds integer not null,
  created_at timestamptz not null default now()
);

create table public.call_events (
  id bigserial primary key,
  call_run_id uuid not null references public.call_runs(id) on delete cascade,
  at timestamptz not null default now(),
  kind text not null,
  detail jsonb
);

create table public.transcripts (
  call_run_id uuid primary key references public.call_runs(id) on delete cascade,
  turns jsonb not null,
  raw jsonb,
  fetched_at timestamptz not null default now()
);

create table public.results (
  call_run_id uuid primary key references public.call_runs(id) on delete cascade,
  structured jsonb,
  valid boolean not null,
  error text,
  fetched_at timestamptz not null default now()
);

create table public.pattern_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  facts jsonb not null,
  prose text not null,
  created_at timestamptz not null default now()
);

create table public.deliveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  channel text not null,
  kind text not null,
  call_run_id uuid references public.call_runs(id) on delete set null,
  payload jsonb not null,
  sent_at timestamptz,
  error text
);

create table public.webhook_events (
  event_id text primary key,
  received_at timestamptz not null default now(),
  type text
);

create function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row
execute function public.set_updated_at();
