-- A profile owner may edit presentation fields, but authorization data is admin-only.
-- RLS limits rows; column grants prevent a signed-in user from promoting their own role
-- through the Supabase Data API or the application's authenticated database role.
revoke insert, update on public.profiles from authenticated;--> statement-breakpoint
grant update (full_name, company_name, avatar_path) on public.profiles to authenticated;
