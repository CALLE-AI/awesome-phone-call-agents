-- CallPilot schema (PostgreSQL / Supabase). Secrets are NEVER stored here.
create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  created_at timestamptz default now()
);
create table if not exists templates (
  id text primary key,
  name text not null,
  goal text not null,
  questions jsonb default '[]',
  constraints jsonb default '[]',
  desired_outcome text default ''
);
create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  mission_number int not null,
  title text not null,
  target_name text not null,
  phone_e164 text not null,
  category text not null,
  goal text not null,
  questions jsonb default '[]',
  constraints jsonb default '[]',
  desired_outcome text default '',
  safety_mode text default 'approval_required',
  demo_mode boolean default false,
  status text default 'planned',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create table if not exists calls (
  id uuid primary key default gen_random_uuid(),
  task_id uuid references tasks(id) on delete cascade,
  calle_call_id text,
  calle_run_id text,
  provider text default 'calle-live',
  status text default 'dialing',
  elapsed_seconds int default 0,
  error text,
  created_at timestamptz default now()
);
create table if not exists call_events (
  id uuid primary key default gen_random_uuid(),
  task_id uuid references tasks(id) on delete cascade,
  kind text not null,
  message text not null,
  meta jsonb default '{}',
  created_at timestamptz default now()
);
create index if not exists idx_events_task on call_events(task_id, created_at);
create table if not exists agent_runs (
  id uuid primary key default gen_random_uuid(),
  task_id uuid references tasks(id) on delete cascade,
  instructions text not null,
  result_schema jsonb default '{}',
  created_at timestamptz default now()
);
create table if not exists call_results (
  id uuid primary key default gen_random_uuid(),
  task_id uuid references tasks(id) on delete cascade,
  structured jsonb not null,
  confidence numeric,
  created_at timestamptz default now()
);
