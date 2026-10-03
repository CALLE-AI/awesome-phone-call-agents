# Senior Phone AI deployment

This application deploys as one Next.js/Node.js service. It does not require Docker. Use Node.js 22.9 or newer, install with `npm ci`, build with `npm run build`, and run with `npm start` behind HTTPS.

## Configuration

Keep `OPENAI_API_KEY`, `CALLE_API_KEY`, `SCHEDULER_SECRET`, and `SUPABASE_SECRET_KEY` in the hosting platform's server-only secret store. Add `SMS_ACCOUNT_ID` and `SMS_AUTH_TOKEN` only after SPA-004 enables the selected SMS provider. `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` are public project configuration; authorization still depends on verified sessions and row-level security.

Never put a service-role key, provider key, scheduler secret, phone number, transcript, or real recipient data in source control, build logs, screenshots, or `NEXT_PUBLIC_*` variables. Use `SENIOR_PHONE_AI_MODE=preview` for deployment checks. Change it to `live` only after reviewing side effects. The `/realtime` and CALL-E operator routes enforce loopback origins and are not public production interfaces.

## Hosted Supabase

Apply SQL files from `apps/typescript/senior-phone-ai/supabase/migrations/` in filename order through the hosted Supabase SQL editor or an approved remote migration workflow. A local Docker stack is not required. Do not apply `supabase/seed.sql` to production; it contains synthetic development identities.

Verify in a non-production project first: create an authenticated test user and number-free synthetic senior; confirm its active member can see `/dashboard`; confirm an unrelated account sees no records and cannot invoke management functions; exercise summary-consent retention; and create a future synthetic reminder to prove that one scheduler worker claims it. Use preview/fake delivery until a separately approved provider test.

## Scheduler

The host scheduler owns recurrence. Each provider request handles one due action. For local one-time CALL-E schedules, send `POST /api/calls/schedule/run` with `Authorization: Bearer <SCHEDULER_SECRET>` at a short host-controlled interval. The handler rejects an incorrect secret, expires work over 15 minutes late, and does not retry uncertain dispatch.

Supabase contains the durable reminder rows and atomic claim/finish functions. The chosen host must instantiate `ReminderDeliveryScheduler` with its Supabase store and enabled CALL-E/SMS adapters before production reminder delivery is enabled. SMS stays disabled until SPA-004. Do not treat provider-side recurrence as the scheduler.

## Cancellation, rollback, retention, and troubleshooting

Users with reminder permission can cancel only pending reminders. Closing a page or stopping the server does not cancel a provider-accepted call. Reconcile `unknown` or `queued` records before a manual retry.

To disable side effects, set preview mode, remove scheduler invocations, and revoke provider keys. Roll application code back to the previous release while leaving additive database tables in place; dropping tables can destroy retained data. Run the configured retention job so expired transcripts, tool details, messages, summaries, and post-call finalizations clear together.

- A signed-out family page shows no records: verify Supabase public configuration, browser session, active membership, and RLS policies.
- `403` from family management: verify same-origin submission and owner/reminder permissions.
- `409` or `unknown` dispatch: reconcile the provider; do not resubmit automatically.
- Missing transcripts: CALL-E may publish transcript turns only after a call ends.
- No-answer and voicemail: retain `incomplete` unless documented provider evidence supplies a stable category.
