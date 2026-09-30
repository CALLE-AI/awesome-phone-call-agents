-- T1.1 Telegram link tokens, items.audio_url, and private item-audio bucket.
-- Service role bypasses RLS. Owner policies cover insert, select, and delete.

create table if not exists public.telegram_link_tokens (
  token_hash text primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.telegram_link_tokens enable row level security;

drop policy if exists telegram_link_tokens_owner on public.telegram_link_tokens;
create policy telegram_link_tokens_owner on public.telegram_link_tokens
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

alter table public.items add column if not exists audio_url text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'item-audio',
  'item-audio',
  false,
  10485760,
  array['audio/ogg', 'audio/opus', 'application/octet-stream']::text[]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists item_audio_owner_select on storage.objects;
create policy item_audio_owner_select on storage.objects
  for select
  using (
    bucket_id = 'item-audio'
    and (storage.foldername(name))[1] = (auth.uid())::text
  );

drop policy if exists item_audio_owner_insert on storage.objects;
create policy item_audio_owner_insert on storage.objects
  for insert
  with check (
    bucket_id = 'item-audio'
    and (storage.foldername(name))[1] = (auth.uid())::text
  );

drop policy if exists item_audio_owner_update on storage.objects;
create policy item_audio_owner_update on storage.objects
  for update
  using (
    bucket_id = 'item-audio'
    and (storage.foldername(name))[1] = (auth.uid())::text
  )
  with check (
    bucket_id = 'item-audio'
    and (storage.foldername(name))[1] = (auth.uid())::text
  );

drop policy if exists item_audio_owner_delete on storage.objects;
create policy item_audio_owner_delete on storage.objects
  for delete
  using (
    bucket_id = 'item-audio'
    and (storage.foldername(name))[1] = (auth.uid())::text
  );
