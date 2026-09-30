create table public.phone_confirmations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  phone_e164 text not null check (phone_e164 ~ '^\+[1-9]\d{7,14}$'),
  code_hash text not null,
  attempts integer not null default 0 check (attempts >= 0 and attempts <= 5),
  state text not null default 'requested' check (state in ('requested', 'dialled', 'refused', 'failed', 'confirmed', 'expired')),
  idempotency_key text not null unique,
  calle_call_id text unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  confirmed_at timestamptz,
  dry_run_request jsonb
);

create index phone_confirmations_user_created_at_idx on public.phone_confirmations (user_id, created_at desc);
create index phone_confirmations_phone_created_at_idx on public.phone_confirmations (phone_e164, created_at desc);

alter table public.phone_confirmations enable row level security;
create policy phone_confirmations_owner_read on public.phone_confirmations
  for select using (auth.uid() = user_id);

revoke select on public.phone_confirmations from authenticated;
grant select (id, state, created_at, expires_at, confirmed_at) on public.phone_confirmations to authenticated;

-- The edge check gives a useful refusal before work begins. These locks make
-- the same limits true when two requests race each other.
create function public.enforce_phone_confirmation_limits()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended(new.phone_e164, 0));
  if exists (select 1 from public.phone_confirmations where user_id = new.user_id and created_at > now() - interval '10 minutes') then
    raise exception 'phone confirmation account cooldown';
  end if;
  if (select count(*) from public.phone_confirmations where user_id = new.user_id and created_at >= date_trunc('day', now())) >= 3 then
    raise exception 'phone confirmation account daily limit';
  end if;
  if (select count(*) from public.phone_confirmations where phone_e164 = new.phone_e164 and created_at >= date_trunc('day', now())) >= 5 then
    raise exception 'phone confirmation number daily limit';
  end if;
  return new;
end;
$$;
create trigger enforce_phone_confirmation_limits
before insert on public.phone_confirmations
for each row execute function public.enforce_phone_confirmation_limits();

-- A code proves possession only of the number held when it was issued. This
-- remains true when a user changes from A to B and later back to A.
create function public.expire_phone_confirmations_on_phone_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.phone_e164 is distinct from old.phone_e164 then
    update public.phone_confirmations
      set state = 'expired'
      where user_id = new.id
        and state in ('requested', 'dialled', 'failed');
  end if;
  return new;
end;
$$;

create trigger expire_phone_confirmations_on_phone_change
after update of phone_e164 on public.profiles
for each row execute function public.expire_phone_confirmations_on_phone_change();

create function public.verify_phone_code(code text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_confirmation public.phone_confirmations%rowtype;
  v_phone text;
begin
  if auth.uid() is null or code !~ '^\d{6}$' then return false; end if;
  select phone_e164 into v_phone from public.profiles where id = auth.uid();
  select * into v_confirmation from public.phone_confirmations
    where user_id = auth.uid() and phone_e164 = v_phone and state in ('requested', 'dialled')
      and expires_at > now()
    order by created_at desc limit 1 for update;
  if not found then return false; end if;
  if encode(extensions.digest(split_part(v_confirmation.code_hash, ':', 1) || ':' || code, 'sha256'), 'hex')
       <> split_part(v_confirmation.code_hash, ':', 2) then
    update public.phone_confirmations set attempts = attempts + 1,
      state = case when attempts + 1 >= 5 then 'expired' else state end
      where id = v_confirmation.id;
    return false;
  end if;
  perform set_config('orma.phone_confirmation_write', 'true', true);
  update public.profiles set phone_confirmed_at = now() where id = auth.uid() and phone_e164 = v_phone;
  update public.phone_confirmations set state = 'confirmed', confirmed_at = now() where id = v_confirmation.id;
  return true;
end;
$$;

revoke all on function public.verify_phone_code(text) from public;
revoke all on function public.verify_phone_code(text) from anon;
grant execute on function public.verify_phone_code(text) to authenticated;
