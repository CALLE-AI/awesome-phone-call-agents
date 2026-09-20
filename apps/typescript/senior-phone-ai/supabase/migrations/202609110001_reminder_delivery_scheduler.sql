create function private.enqueue_reminder_delivery()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.scheduled_deliveries (
    senior_id, reminder_id, idempotency_key, due_at, channel
  ) values (
    new.senior_id, new.id, new.idempotency_key, new.scheduled_for, new.channel
  ) on conflict (idempotency_key) do nothing;
  return new;
end;
$$;

create trigger reminders_enqueue_delivery
after insert on public.reminders
for each row execute function private.enqueue_reminder_delivery();

insert into public.scheduled_deliveries (
  senior_id, reminder_id, idempotency_key, due_at, channel, status
)
select senior_id, id, idempotency_key, scheduled_for, channel, status
from public.reminders
where status = 'pending'
on conflict (idempotency_key) do nothing;

create function public.claim_due_reminder_delivery(
  p_now timestamptz,
  p_maximum_lateness_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected record;
begin
  if p_maximum_lateness_seconds < 0 or p_maximum_lateness_seconds > 86400 then
    raise exception 'invalid maximum lateness';
  end if;

  select d.id as delivery_id, d.due_at, r.*
  into selected
  from public.scheduled_deliveries d
  join public.reminders r on r.id = d.reminder_id
  where d.status = 'pending'
    and r.status = 'pending'
    and d.due_at <= p_now
  order by d.due_at, d.id
  for update of d, r skip locked
  limit 1;

  if not found then
    return jsonb_build_object('state', 'none');
  end if;

  if selected.due_at < p_now - make_interval(secs => p_maximum_lateness_seconds) then
    update public.scheduled_deliveries set status = 'failed', completed_at = p_now
    where id = selected.delivery_id;
    update public.reminders set status = 'failed', updated_at = p_now
    where id = selected.id;
    return jsonb_build_object('state', 'expired', 'reminderId', selected.id);
  end if;

  update public.scheduled_deliveries set status = 'in_progress', claimed_at = p_now
  where id = selected.delivery_id;
  update public.reminders set status = 'in_progress', updated_at = p_now
  where id = selected.id;

  return jsonb_build_object(
    'state', 'claimed',
    'reminder', jsonb_build_object(
      'authorizationId', selected.authorization_id,
      'channel', selected.channel,
      'createdAt', selected.created_at,
      'destinationE164', selected.destination_e164,
      'id', selected.id,
      'idempotencyKey', selected.idempotency_key,
      'message', selected.message,
      'principalId', selected.principal_user_id,
      'scheduledFor', selected.scheduled_for,
      'seniorId', selected.senior_id,
      'status', 'in_progress',
      'timezone', selected.timezone
    )
  );
end;
$$;

create function public.finish_reminder_delivery(
  p_reminder_id uuid,
  p_status public.workflow_status,
  p_provider_reference text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed integer;
begin
  if p_status not in ('queued', 'completed', 'failed', 'unknown') then
    raise exception 'invalid terminal delivery status';
  end if;
  update public.scheduled_deliveries
  set status = p_status,
      provider_reference = left(p_provider_reference, 200),
      completed_at = case when p_status in ('completed', 'failed', 'unknown') then now() else null end
  where reminder_id = p_reminder_id and status = 'in_progress';
  get diagnostics changed = row_count;
  if changed = 1 then
    update public.reminders set status = p_status, updated_at = now()
    where id = p_reminder_id and status = 'in_progress';
    return true;
  end if;
  return false;
end;
$$;

revoke all on function public.claim_due_reminder_delivery(timestamptz, integer) from public, anon, authenticated;
revoke all on function public.finish_reminder_delivery(uuid, public.workflow_status, text) from public, anon, authenticated;
grant execute on function public.claim_due_reminder_delivery(timestamptz, integer) to service_role;
grant execute on function public.finish_reminder_delivery(uuid, public.workflow_status, text) to service_role;
