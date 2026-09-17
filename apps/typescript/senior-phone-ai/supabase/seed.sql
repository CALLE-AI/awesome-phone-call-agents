-- Synthetic, number-free development data. These users have no usable password.
insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
values
  ('10000000-0000-4000-8000-000000000001', 'margaret.carer@example.invalid', '{}', '{}'),
  ('10000000-0000-4000-8000-000000000002', 'unrelated.user@example.invalid', '{}', '{}')
on conflict (id) do nothing;

insert into public.seniors (id, display_name, timezone, approximate_location, interests)
values (
  '20000000-0000-4000-8000-000000000001',
  'Margaret',
  'Australia/Sydney',
  'Sydney',
  array['gardening', 'libraries', 'local community events']
)
on conflict (id) do nothing;

insert into public.senior_memberships (
  senior_id,
  user_id,
  role,
  can_view_call_content,
  can_manage_contacts,
  can_manage_reminders,
  sharing_approved_at
)
values (
  '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'family',
  true,
  true,
  true,
  '2026-09-10T00:00:00Z'
)
on conflict (senior_id, user_id) do nothing;

insert into public.senior_preferences (senior_id, retention_days)
values ('20000000-0000-4000-8000-000000000001', 30)
on conflict (senior_id) do nothing;

insert into public.trusted_contacts (senior_id, display_name, relationship)
values (
  '20000000-0000-4000-8000-000000000001',
  'Synthetic family contact',
  'family'
);
