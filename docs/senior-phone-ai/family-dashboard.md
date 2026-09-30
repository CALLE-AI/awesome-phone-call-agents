# Family and carer dashboard

The private family workspace uses a verified Supabase browser session and the repository's row-level security policies. It never uses the service-role key in the browser. Configure `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, apply the migrations, and sign in with an account that has an active `senior_memberships` row.

The workspace provides `/dashboard`, `/seniors`, `/seniors/[id]`, `/reminders`, and `/settings`. The existing `/calls` route remains the loopback-only live operator console; retained calls and summaries appear in the authenticated dashboard. Signed-out family pages show no private records.

Profiles, trusted contacts, retained call summaries, confirmed actions, reminder states, and SMS delivery states come from Supabase through the signed-in client, so row-level security limits every query. Phone values and phone-like text are masked before rendering, including E.164, formatted, nested, and local-number forms. React renders provider content as text. The dashboard does not calculate or show medical, psychological, loneliness, or wellness scores. A "last completed call" is based only on a completed call row with an `ended_at` timestamp.

Owners can update approved profile and retention/consent settings. Members with `can_manage_reminders` can cancel a pending reminder. These mutations require a same-origin request, a verified session, and database functions that re-check membership permissions against `auth.uid()`. Other accounts are denied even if they submit a valid senior or reminder ID.
