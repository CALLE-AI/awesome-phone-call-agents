-- AsyncFounders production schema. Run once in the Supabase SQL editor.
create extension if not exists pgcrypto;

create type public.company_role as enum ('founder', 'admin', 'member');
create type public.member_status as enum ('invited', 'active', 'suspended');
create type public.memory_kind as enum ('fact', 'idea', 'assumption', 'decision', 'question', 'task', 'conflict');
create type public.memory_status as enum ('open', 'proposed', 'accepted', 'answered', 'resolved', 'superseded', 'dismissed');
create type public.ack_state as enum ('unseen', 'heard', 'acknowledged', 'disputed', 'deferred');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text not null,
  created_at timestamptz not null default now()
);

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 80),
  description text not null default '',
  timezone text not null default 'UTC',
  current_version bigint not null default 0,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table public.company_members (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  email text not null,
  display_name text not null,
  role public.company_role not null default 'member',
  role_label text not null default 'Team member',
  status public.member_status not null default 'invited',
  region char(2) not null default 'IN',
  locale text not null default 'en-IN',
  timezone text not null default 'UTC',
  phone_e164 text,
  phone_last_four char(4),
  call_consent boolean not null default false,
  quiet_hours_start time,
  quiet_hours_end time,
  last_briefed_version bigint not null default 0,
  invited_by uuid references auth.users(id),
  joined_at timestamptz,
  created_at timestamptz not null default now(),
  unique(company_id, email),
  unique(company_id, user_id),
  constraint valid_phone check (phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{7,14}$')
);

create table public.company_invites (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  email text not null,
  display_name text not null,
  role public.company_role not null default 'member',
  role_label text not null default 'Team member',
  region char(2) not null,
  locale text not null,
  token uuid not null default gen_random_uuid() unique,
  expires_at timestamptz not null default now() + interval '14 days',
  accepted_at timestamptz,
  invited_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique(company_id, email)
);

create table public.sources (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  kind text not null check (kind in ('file','text','link')),
  label text not null,
  url text,
  storage_path text,
  mime_type text,
  byte_size bigint not null default 0,
  index_status text not null default 'queued' check (index_status in ('queued','indexed','failed')),
  chunk_count integer not null default 0,
  added_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table public.source_chunks (
  id bigint generated always as identity primary key,
  source_id uuid not null references public.sources(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  ordinal integer not null,
  content text not null,
  search_vector tsvector generated always as (to_tsvector('english', content)) stored,
  created_at timestamptz not null default now(),
  unique(source_id, ordinal)
);
create index source_chunks_search_idx on public.source_chunks using gin(search_vector);
create index source_chunks_company_idx on public.source_chunks(company_id);

create table public.call_sessions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  member_id uuid not null references public.company_members(id),
  requested_by uuid not null references auth.users(id),
  mode text not null check (mode in ('deposit','catchup','ask')),
  provider text not null check (provider in ('demo','calle')),
  status text not null,
  provider_call_id text,
  payload_fingerprint text not null,
  preview jsonb not null,
  result jsonb,
  requested_at timestamptz not null default now(),
  confirmed_at timestamptz,
  completed_at timestamptz,
  memory_ingested_at timestamptz,
  unique(company_id, payload_fingerprint)
);

create table public.memory_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  version bigint not null,
  kind public.memory_kind not null,
  title text not null,
  body text not null,
  status public.memory_status not null,
  confidence numeric(4,3) not null check (confidence between 0 and 1),
  author_member_id uuid references public.company_members(id),
  source_call_id uuid references public.call_sessions(id),
  source_excerpt text,
  audience jsonb not null default '["team"]'::jsonb,
  supersedes_id uuid references public.memory_items(id),
  created_at timestamptz not null default now(),
  unique(company_id, version)
);

create table public.acknowledgements (
  memory_item_id uuid not null references public.memory_items(id) on delete cascade,
  member_id uuid not null references public.company_members(id) on delete cascade,
  state public.ack_state not null default 'unseen',
  note text,
  acknowledged_at timestamptz,
  primary key(memory_item_id, member_id)
);

create table public.conflict_links (
  conflict_memory_id uuid not null references public.memory_items(id) on delete cascade,
  claim_memory_id uuid not null references public.memory_items(id) on delete cascade,
  position text not null,
  created_at timestamptz not null default now(),
  primary key(conflict_memory_id, claim_memory_id)
);

create or replace function public.is_company_member(target_company uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from public.company_members m where m.company_id = target_company and m.user_id = auth.uid() and m.status = 'active') $$;

create or replace function public.can_manage_company(target_company uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from public.company_members m where m.company_id = target_company and m.user_id = auth.uid() and m.status = 'active' and m.role in ('founder','admin')) $$;

create or replace function public.create_company(company_name text, company_description text, company_timezone text)
returns uuid language plpgsql security definer set search_path = public
as $$
declare new_id uuid; person public.profiles%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into person from public.profiles where id = auth.uid();
  insert into public.companies(name,description,timezone,created_by)
  values(trim(company_name),coalesce(trim(company_description),''),company_timezone,auth.uid()) returning id into new_id;
  insert into public.company_members(company_id,user_id,email,display_name,role,role_label,status,region,locale,timezone,call_consent,joined_at)
  values(new_id,auth.uid(),person.email,person.display_name,'founder','Founder','active','IN','en-IN',company_timezone,false,now());
  return new_id;
end $$;

create or replace function public.accept_invite(invite_token uuid)
returns uuid language plpgsql security definer set search_path = public
as $$
declare invitation public.company_invites%rowtype; person public.profiles%rowtype; member_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into invitation from public.company_invites where token = invite_token and accepted_at is null and expires_at > now();
  select * into person from public.profiles where id = auth.uid();
  if invitation.id is null or lower(invitation.email) <> lower(person.email) then raise exception 'Invite is invalid or belongs to another email'; end if;
  insert into public.company_members(company_id,user_id,email,display_name,role,role_label,status,region,locale,timezone,invited_by,joined_at)
  values(invitation.company_id,auth.uid(),person.email,coalesce(nullif(invitation.display_name,''),person.display_name),invitation.role,invitation.role_label,'active',invitation.region,invitation.locale,'UTC',invitation.invited_by,now())
  on conflict(company_id,email) do update set user_id=excluded.user_id,status='active',joined_at=now() returning id into member_id;
  update public.company_invites set accepted_at=now() where id=invitation.id;
  return member_id;
end $$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$ begin
  insert into public.profiles(id,email,display_name)
  values(new.id,new.email,coalesce(new.raw_user_meta_data->>'display_name',split_part(new.email,'@',1)))
  on conflict(id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.companies enable row level security;
alter table public.company_members enable row level security;
alter table public.company_invites enable row level security;
alter table public.sources enable row level security;
alter table public.source_chunks enable row level security;
alter table public.call_sessions enable row level security;
alter table public.memory_items enable row level security;
alter table public.acknowledgements enable row level security;
alter table public.conflict_links enable row level security;

-- Teammates may see masked callback state but can never select another member's full number.
revoke all on public.company_members from anon, authenticated;
grant select(id,company_id,user_id,email,display_name,role,role_label,status,region,locale,timezone,phone_last_four,call_consent,quiet_hours_start,quiet_hours_end,last_briefed_version,invited_by,joined_at,created_at) on public.company_members to authenticated;
grant update(phone_e164,phone_last_four,call_consent,timezone,quiet_hours_start,quiet_hours_end) on public.company_members to authenticated;

create policy "profile_self" on public.profiles for all using (id=auth.uid()) with check (id=auth.uid());
create policy "company_read" on public.companies for select using (public.is_company_member(id));
create policy "company_manage" on public.companies for update using (public.can_manage_company(id));
create policy "member_read" on public.company_members for select using (public.is_company_member(company_id));
create policy "member_self_update" on public.company_members for update using (user_id=auth.uid()) with check (user_id=auth.uid());
create policy "invite_read" on public.company_invites for select using (public.can_manage_company(company_id) or lower(email)=lower(auth.jwt()->>'email'));
create policy "invite_create" on public.company_invites for insert with check (public.can_manage_company(company_id) and invited_by=auth.uid());
create policy "invite_manage" on public.company_invites for update using (public.can_manage_company(company_id));
create policy "source_read" on public.sources for select using (public.is_company_member(company_id));
create policy "source_create" on public.sources for insert with check (public.is_company_member(company_id) and added_by=auth.uid());
create policy "chunk_read" on public.source_chunks for select using (public.is_company_member(company_id));
create policy "chunk_create" on public.source_chunks for insert with check (public.is_company_member(company_id));
create policy "call_read" on public.call_sessions for select using (public.is_company_member(company_id));
create policy "memory_read" on public.memory_items for select using (public.is_company_member(company_id));
create policy "ack_read" on public.acknowledgements for select using (public.is_company_member((select company_id from public.memory_items where id=memory_item_id)));
create policy "ack_write" on public.acknowledgements for all using (member_id in (select id from public.company_members where user_id=auth.uid())) with check (member_id in (select id from public.company_members where user_id=auth.uid()));
create policy "conflict_read" on public.conflict_links for select using (public.is_company_member((select company_id from public.memory_items where id=conflict_memory_id)));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('company-sources','company-sources',false,10485760,array['text/plain','text/markdown','text/csv','application/json','application/pdf'])
on conflict(id) do update set public=false,file_size_limit=10485760;
create policy "source_blob_read" on storage.objects for select using (bucket_id='company-sources' and public.is_company_member((storage.foldername(name))[1]::uuid));
create policy "source_blob_insert" on storage.objects for insert with check (bucket_id='company-sources' and public.is_company_member((storage.foldername(name))[1]::uuid));

create or replace function public.ingest_call_memory(target_session uuid, memory_payload jsonb)
returns integer language plpgsql security definer set search_path = public
as $$
declare session_row public.call_sessions%rowtype; item jsonb; next_version bigint; inserted_count integer := 0;
begin
  select * into session_row from public.call_sessions where id=target_session for update;
  if session_row.id is null or session_row.memory_ingested_at is not null then return 0; end if;
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
revoke all on function public.ingest_call_memory(uuid,jsonb) from public, anon, authenticated;
grant execute on function public.ingest_call_memory(uuid,jsonb) to service_role;
