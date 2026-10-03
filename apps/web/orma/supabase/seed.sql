-- Local development account: local@example.com / local-dev-password
-- This seed is never applied to the linked project.

insert into auth.users (
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  confirmation_token,
  recovery_token,
  email_change_token_new,
  email_change,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
values (
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'local@example.com',
  extensions.crypt('local-dev-password', extensions.gen_salt('bf')),
  now(),
  '',
  '',
  '',
  '',
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"display_name":"Local Developer"}'::jsonb,
  now(),
  now()
);

insert into auth.identities (
  id,
  provider_id,
  user_id,
  identity_data,
  provider,
  last_sign_in_at,
  created_at,
  updated_at
)
values (
  '10000000-0000-4000-8000-000000000001',
  'local@example.com',
  '00000000-0000-4000-8000-000000000001',
  '{"sub":"00000000-0000-4000-8000-000000000001","email":"local@example.com"}'::jsonb,
  'email',
  now(),
  now(),
  now()
);

insert into public.profiles (
  id,
  display_name,
  phone_e164,
  phone_confirmed_at,
  timezone
)
values (
  '00000000-0000-4000-8000-000000000001',
  'Local Developer',
  '+15555550100',
  now(),
  'Asia/Kolkata'
);

insert into public.consents (user_id, kind, text_version, source)
values (
  '00000000-0000-4000-8000-000000000001',
  'outbound_calls',
  'local-seed-v1',
  'web'
);

insert into public.slots (id, user_id, local_time, weekdays, part_of_day)
values (
  '20000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001',
  '08:00',
  '{1,2,3,4,5}',
  'morning'
);

insert into public.items (id, user_id, text, since_date, source, seeded, created_at)
values
  ('30000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'Book a dentist appointment', current_date - 34, 'web', true, now() - interval '34 days'),
  ('30000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', 'Renew the passport', current_date - 21, 'telegram', true, now() - interval '21 days'),
  ('30000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001', 'Call Amma', current_date - 8, 'call', true, now() - interval '8 days'),
  ('30000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000001', 'Finish the local seed', current_date - 2, 'mcp', true, now() - interval '2 days');

insert into public.call_runs (
  id,
  user_id,
  slot_id,
  local_date,
  part_of_day,
  scheduled_for,
  state,
  disposition,
  mood,
  idempotency_key,
  completed_at,
  briefing,
  dry_run,
  billable
)
values (
  '40000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  current_date - 1,
  'morning',
  now() - interval '1 day',
  'completed',
  'answered_extracted',
  'energised',
  'orma:local-seed:completed:v1',
  now() - interval '1 day',
  '{"user_name":"Local Developer","lead_line":"You mentioned the dentist three times.","open_items":"Book a dentist appointment; Renew the passport; Call Amma; Finish the local seed","slot_local_time":"08:00"}'::jsonb,
  true,
  false
);

-- The eight `call_events` kinds are fixed, and `finalised` is the one a
-- completed run ends on. Its detail carries the state the run reached, the
-- disposition the spec gives that state, and the counts ingestion wrote.
insert into public.call_events (call_run_id, at, kind, detail)
values
  ('40000000-0000-4000-8000-000000000001', now() - interval '1 day', 'dispatched', '{"dry_run":true}'::jsonb),
  (
    '40000000-0000-4000-8000-000000000001',
    now() - interval '23 hours',
    'finalised',
    '{"state":"completed","disposition":"answered_extracted","item_count":0,"mention_count":3,"retirement_count":0,"commitment_count":1,"failure_reason":""}'::jsonb
  );

insert into public.transcripts (call_run_id, turns, raw, fetched_at)
values (
  '40000000-0000-4000-8000-000000000001',
  '[{"speaker":"agent","offset_seconds":0,"text":"Hi Local Developer. How is the dentist appointment going?"},{"speaker":"user","offset_seconds":8,"text":"I will book it tomorrow."}]'::jsonb,
  '{"source":"local-seed"}'::jsonb,
  now() - interval '23 hours'
);

insert into public.results (call_run_id, structured, valid, fetched_at)
values (
  '40000000-0000-4000-8000-000000000001',
  '{"captured_items":[],"retired_items":[],"commitments":[{"item_id":"30000000-0000-4000-8000-000000000001","due":"tomorrow","evidence_offset_seconds":8}],"mood":"energised","slot_change_requested":"no"}'::jsonb,
  true,
  now() - interval '23 hours'
);

insert into public.item_mentions (item_id, call_run_id, offset_seconds, created_at)
values
  ('30000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 0, now() - interval '23 hours'),
  ('30000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000001', 2, now() - interval '23 hours'),
  ('30000000-0000-4000-8000-000000000003', '40000000-0000-4000-8000-000000000001', 4, now() - interval '23 hours');

insert into public.commitments (item_id, user_id, call_run_id, due, evidence_offset_seconds, created_at)
values (
  '30000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001',
  now() + interval '1 day',
  8,
  now() - interval '23 hours'
);
