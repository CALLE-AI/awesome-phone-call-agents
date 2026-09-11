-- Blood Bank Dispatch — initial schema (mirrors CALLE_BUILD.md §4)
-- Idempotent: safe to re-run on every deploy (Railpack start command runs it).

create table if not exists banks (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  phone         text not null unique,   -- E.164, validated on write
  area          text,
  notes         text,                   -- e.g. "ask for the lab, not reception"
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

create table if not exists call_runs (
  id            uuid primary key default gen_random_uuid(),
  blood_group   text not null check (blood_group in ('A', 'B', 'AB', 'O')),
  rhesus        text not null check (rhesus in ('positive', 'negative')),
  units_needed  integer not null,
  requester     text,                   -- facility or person filing the request
  patient_ref   text,                   -- opaque internal ref only, never a name
  status        text not null default 'running',
  created_at    timestamptz not null default now(),
  completed_at  timestamptz
);

create table if not exists call_results (
  id                  uuid primary key default gen_random_uuid(),
  run_id              uuid not null references call_runs(id) on delete cascade,
  bank_id             uuid references banks(id),   -- null for ad hoc numbers
  source              text not null,               -- 'registry' | 'adhoc'
  bank_name           text not null,
  phone               text not null,
  status              text not null default 'queued',
  -- queued | dialing | completed | no_answer | callback_requested | failed
  error               text,              -- failure reason when status = 'failed'
  calle_call_id       text,
  idempotency_key     text unique,       -- persisted before the call is placed
  units_available     integer,
  group_confirmed     text,
  screening_status    text,
  release_policy      text,              -- 'will_release' | 'collect_only' | 'refused'
  transport_minutes   integer,
  cost_per_unit       numeric,
  contact_person      text,
  callback_requested  boolean default false,
  alternatives        jsonb,             -- other groups or branches offered
  confidence          numeric,
  raw_transcript      text,
  structured_raw      jsonb,             -- whatever CALL-E returned, unmodified
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- The polled endpoint filters on run_id; FKs are not auto-indexed in Postgres.
create index if not exists call_results_run_id_idx on call_results(run_id);

create or replace function touch_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists call_results_touch_updated_at on call_results;
create trigger call_results_touch_updated_at
  before update on call_results
  for each row execute function touch_updated_at();
