create function public.manage_senior_profile(p_senior_id uuid, p_display_name text, p_timezone text, p_approximate_location text)
returns public.seniors language plpgsql security definer set search_path = '' as $$
declare stored public.seniors;
begin
  if not exists (select 1 from public.senior_memberships membership where membership.senior_id = p_senior_id and membership.user_id = (select auth.uid()) and membership.role = 'owner' and membership.revoked_at is null)
  then raise exception 'profile access denied' using errcode = '42501'; end if;
  update public.seniors set display_name = p_display_name, timezone = p_timezone, approximate_location = nullif(p_approximate_location, '') where id = p_senior_id returning * into stored;
  if not found then raise exception 'senior does not exist'; end if;
  return stored;
end; $$;

create function public.manage_senior_preferences(p_senior_id uuid, p_store_transcripts boolean, p_store_summaries boolean, p_retention_days integer)
returns public.senior_preferences language plpgsql security definer set search_path = '' as $$
declare stored public.senior_preferences;
begin
  if not exists (select 1 from public.senior_memberships membership where membership.senior_id = p_senior_id and membership.user_id = (select auth.uid()) and membership.role = 'owner' and membership.revoked_at is null)
  then raise exception 'preference access denied' using errcode = '42501'; end if;
  update public.senior_preferences preference set
    store_transcripts = p_store_transcripts,
    transcript_consent_at = case when p_store_transcripts then coalesce(preference.transcript_consent_at, now()) else null end,
    store_summaries = p_store_summaries,
    summary_sharing_consent_at = case when p_store_summaries then coalesce(preference.summary_sharing_consent_at, now()) else null end,
    retention_days = p_retention_days
  where preference.senior_id = p_senior_id returning * into stored;
  if not found then raise exception 'preferences do not exist'; end if;
  return stored;
end; $$;

create function public.cancel_family_reminder(p_senior_id uuid, p_reminder_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare existing_status public.workflow_status;
begin
  if not exists (select 1 from public.senior_memberships membership where membership.senior_id = p_senior_id and membership.user_id = (select auth.uid()) and membership.can_manage_reminders and membership.revoked_at is null)
  then raise exception 'reminder access denied' using errcode = '42501'; end if;
  update public.reminders set status = 'canceled', canceled_at = now() where id = p_reminder_id and senior_id = p_senior_id and status = 'pending';
  if found then return 'canceled'; end if;
  select status into existing_status from public.reminders where id = p_reminder_id and senior_id = p_senior_id;
  if not found or existing_status = 'canceled' then return 'not_found'; end if;
  return 'already_started';
end; $$;

revoke all on function public.manage_senior_profile(uuid, text, text, text) from public, anon;
revoke all on function public.manage_senior_preferences(uuid, boolean, boolean, integer) from public, anon;
revoke all on function public.cancel_family_reminder(uuid, uuid) from public, anon;
grant execute on function public.manage_senior_profile(uuid, text, text, text) to authenticated;
grant execute on function public.manage_senior_preferences(uuid, boolean, boolean, integer) to authenticated;
grant execute on function public.cancel_family_reminder(uuid, uuid) to authenticated;
