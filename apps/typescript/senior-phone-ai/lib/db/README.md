# Supabase data boundary

Supabase PostgreSQL stores senior profiles, family memberships, sharing preferences, trusted contacts, correlated calls and tools, optional transcripts, authorizations, SMS history, reminders and scheduled work. The initial migration is in `supabase/migrations/`; number-free synthetic development data and pgTAP access-policy checks are in `supabase/seed.sql` and `supabase/tests/database/`.

## Authentication and authorization

Browser and server clients use the project URL and publishable key. Server authorization calls `auth.getClaims()` and uses the verified `sub` claim; an unverified session, supplied user ID, phone number or caller ID never establishes identity. Row-level security then limits reads to active `senior_memberships`. Call content additionally requires `can_view_call_content`.

All writes go through authenticated server actions or route handlers that check membership permissions and use `createSupabaseAdminClient`. The `SUPABASE_SECRET_KEY` bypasses RLS, so it is server-only and must never appear in client components, logs, prompts, test fixtures or committed environment files. Durable action and SMS adapters use the admin client after the application authorization check.

A safe enrollment flow starts with an authenticated owner or authorized family member creating a short-lived, single-use invite on the server. Only its hash is stored. The intended recipient receives the opaque token out of band, signs in through Supabase, and accepts while that verified session matches the invited identity. Acceptance creates the membership and records the senior-approved sharing time. Caller ID can help route a call after enrollment, but cannot accept an invite or reveal private data.

## Privacy and retention

Collect only the fields needed for the workflow. The Margaret seed contains an approximate location, timezone and interests, with no phone number. Trusted-contact numbers are optional. Transcript storage defaults off and the database rejects transcript rows unless current explicit consent exists. Summary storage and sharing also default off. Membership revocation stops reads immediately.

Each senior selects a retention period from 1 to 365 days. A trusted server job may call `private.delete_expired_senior_data()` to remove expired transcripts, tool activity and SMS content. Deleting a senior cascades through their stored workflow data. Product UI must explain what will be shared before enabling transcript or summary storage and must offer deletion and membership revocation controls.

## Local workflow and rollback

Local validation uses PGlite, an embedded WebAssembly build of PostgreSQL that runs under Node without Docker or an installed database. From this app directory, run:

```bash
npm run db:check
```

The check creates a fresh in-memory PostgreSQL database, applies the Supabase migration and seed, and exercises consent triggers, grants and cross-account row-level policies. It retains no data after the process exits. Supabase-specific pgTAP checks remain under `supabase/tests/database/` for linked-project CI.

SPA-015 will apply the migrations to a configured hosted Supabase project as part of deployment verification. For a deployed project, correct a schema through a new forward migration. Review backups and dependent data before any remote rollback or deletion; an embedded test database is not a production rollback plan.

Schema relationships follow `seniors -> senior_memberships/preferences/trusted_contacts/call_sessions/action_authorizations/reminders`. Calls provide optional foreign-key correlation for transcripts, tool activity and SMS. Authorizations bind side effects to a senior and verified family principal; SMS delivery events and reminder idempotency keys are durable. Reminder rows retain the authenticated principal, exact destination, channel, timezone and UTC instant used by the authorization. Only active members with `can_manage_reminders` may create, list or cancel them through the server adapter.
