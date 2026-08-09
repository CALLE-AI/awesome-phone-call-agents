# AsyncFounders

**Talk once. The company remembers.**

AsyncFounders is a public, multi-tenant coordination product for distributed founders and teams. A user creates one or more isolated company brains, invites teammates, adds source material, and uses consented CALL-E callbacks to deposit updates or receive the unseen knowledge delta.

Live demo: https://asyncfounders.vercel.app/

## What is implemented

- Supabase email/password authentication.
- Isolated company workspaces with founder, admin and member roles.
- PostgreSQL row-level security and private source storage.
- Secure, expiring, email-bound invitation links.
- Source ingestion for files, pasted notes and links.
- Versioned facts, ideas, assumptions, decisions, questions, tasks and conflicts.
- Private E.164 callback profiles with explicit consent.
- Exact callback preview bound to the full destination, locale, task, context and company version.
- Server-only CALL-E integration with strict structured-result validation.
- Failed, malformed, ambiguous and low-confidence calls fail closed.

## Safety and side effects

- The committed example configuration is demo-only: `CALLE_LIVE_CALLS_ENABLED=false` and `CALLE_DEMO_MODE=true`. Demo callbacks complete without dialing a phone.
- A real outbound call is possible only when an active member calls themselves, has explicit callback consent, reviews the exact masked preview, and confirms that unexpired preview.
- Callback profiles use E.164 numbers. Client-visible previews mask the phone number, and CALL-E credentials remain server-only.
- Recipient-local quiet hours are enforced at preview and again immediately before dispatch.
- Preview creation is serialized per requester and recipient, and the full generated call script is shown before confirmation.
- A preview is valid for ten minutes and its fingerprint is bound into the CALL-E idempotency key. An ambiguous create remains `dispatching`; reconfirm that same preview to reconcile the stable key instead of creating a replacement.
- Raw transcripts and provider evidence are used transiently for validation and are never retained in company-readable call sessions.
- AsyncFounders does not create recurring call schedules. To stop future calls, revoke callback consent or set `CALLE_LIVE_CALLS_ENABLED=false`. For a call already queued or active, use the CALL-E dashboard.
- The call agent may collect team updates and questions only. It is instructed not to make purchases, commitments, schedules, promises, or external actions, and this workflow must not be used for medical, legal, financial, emergency, authentication, or other high-risk decisions.

## Stack

- Next.js App Router and TypeScript
- Supabase Auth, Postgres and Storage
- CALL-E TypeScript SDK
- Vercel

## Local setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

For a new database, run `supabase/migrations/001_production_schema.sql` in the Supabase SQL editor. Existing deployments must run the numbered migrations in order, including `002_callback_safety.sql` and `003_atomic_call_previews.sql`. Then configure:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
CALLE_API_KEY
CALLE_LIVE_CALLS_ENABLED=false
CALLE_DEMO_MODE=true
```

`SUPABASE_SERVICE_ROLE_KEY` and `CALLE_API_KEY` are server-only secrets. Never expose them through a `NEXT_PUBLIC_` variable.

The values above are the no-call defaults. To opt into live verification, obtain explicit consent for the recipient number, set `CALLE_LIVE_CALLS_ENABLED=true` and `CALLE_DEMO_MODE=false`, then restart the app. The UI still requires a fresh preview and explicit confirmation for each call.

## Verification

```bash
npm run check
```

## Deploy on Vercel

1. Import this app directory as a Vercel project.
2. Add the six environment variables above to Production, Preview and Development.
3. Deploy.
4. In Supabase Authentication URL Configuration, set the Vercel production origin as the Site URL and add `<origin>/**` as an allowed redirect URL.
