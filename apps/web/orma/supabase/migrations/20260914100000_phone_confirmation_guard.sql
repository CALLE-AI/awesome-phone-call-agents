-- A browser user may store a number, but only the confirmation flow may
-- attest to possession of it. The local setting is transaction-scoped and is
-- enabled only by the security-definer verifier introduced in T10.2.
create function public.guard_profile_phone_confirmation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.role() = 'service_role'
    or current_setting('orma.phone_confirmation_write', true) = 'true' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.phone_confirmed_at := null;
  elsif new.phone_e164 is not distinct from old.phone_e164 then
    new.phone_confirmed_at := old.phone_confirmed_at;
  else
    new.phone_confirmed_at := null;
  end if;

  return new;
end;
$$;

create trigger guard_profile_phone_confirmation
before insert or update on public.profiles
for each row
execute function public.guard_profile_phone_confirmation();
