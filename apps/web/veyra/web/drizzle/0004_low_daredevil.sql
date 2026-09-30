ALTER TABLE "profiles" ADD COLUMN "avatar_path" text;--> statement-breakpoint

-- Profile images remain private. The browser never receives a public or long-lived signed
-- URL; authenticated application routes upload/download on the current user's behalf.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'profile-images',
  'profile-images',
  false,
  2097152,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;--> statement-breakpoint

drop policy if exists "profile_images_select_own" on storage.objects;--> statement-breakpoint
create policy "profile_images_select_own" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'profile-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );--> statement-breakpoint

drop policy if exists "profile_images_insert_own" on storage.objects;--> statement-breakpoint
create policy "profile_images_insert_own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'profile-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );--> statement-breakpoint

drop policy if exists "profile_images_delete_own" on storage.objects;--> statement-breakpoint
create policy "profile_images_delete_own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'profile-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
