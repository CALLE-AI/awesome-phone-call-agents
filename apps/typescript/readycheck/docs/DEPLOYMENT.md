# Deployment and operations

Run one Node instance with HTTPS and persistent storage: `/var/data` on Render or a volume at `/app/data` with Docker. Keep `LIVE_CALLS_ENABLED=false` for the sample pilot. The application has no public business discovery, email verification or password recovery service. An operator must be available before inviting users to depend on it.

## Railway deployment

The public [ReadyCheck demo](https://readycheck-demo.up.railway.app) runs on Railway with fictional samples and live calling disabled. It uses one Node 24 container and a persistent volume at `/app/data`. The service sleeps when idle, so the first visit may take a moment to load.

To deploy your own instance:

1. Deploy the root Dockerfile with one service instance and a persistent volume mounted at `/app/data`.
2. Set `NODE_ENV=production`, `PORT=3000`, `BIND_HOST=0.0.0.0`, and `APP_ORIGIN` to the service's HTTPS URL.
3. Set `DATABASE_PATH` to a SQLite file under the mounted volume. Keep this path stable across releases.
4. Keep `LIVE_CALLS_ENABLED=false`, `TEST_RECIPIENTS_JSON=[]`, and `LIVE_USER_IDS` empty for a fictional demo. Leave `CALLE_API_KEY` unset.
5. If the volume requires root initialization, set `RAILWAY_RUN_UID=0`. The container entry point prepares its configured database paths, then drops to the `node` user before starting the application.
6. Configure `/api/health` as the health check. After deployment, run a fictional repair case, create a test account, save an outcome, and restart the service. Sign in again and verify the saved records survived.

The hosted demo currently uses CLI uploads; GitHub pushes do not auto-deploy. For a CLI release, upload a tracked-only checkout with `railway up --project <project-id> --service <service-id> --environment production --detach`. Preserve the existing volume and database path. Never upload a development database, local credentials or private call artifacts.

Configure usage alerts and a spending limit in the hosting dashboard. Reaching a hard limit takes the service offline. Monitor usage while providing public access.

The hosted repair workflow, signup, fresh sign-in, export and mobile evidence checks passed. A service restart preserved a synthetic account, case and saved outcome. Hosted backup/restore and load testing remain outstanding.

## Render alternative

The root [render.yaml](../render.yaml) defines a Node 24 web service, one instance, a 1 GB persistent disk at `/var/data`, and `/api/health` checks. It builds with `npm ci --include=dev && npm run build`, then starts the existing Express application. The start command uses Render's generated HTTPS URL as `APP_ORIGIN` unless an explicit custom origin is configured. This keeps session cookies and origin validation aligned.

[Deploy this Blueprint](https://dashboard.render.com/blueprint/new?repo=https%3A%2F%2Fgithub.com%2Fankitlade12%2Freadycheck) from an authenticated Render account. Review the resources and cost before deploying. The proposed compute plan is `0.5c-512mb` ($7/month), plus a 1 GB disk ($0.25/month): **$7.25/month base resource cost**, excluding any usage overages or taxes, as checked September 13, 2026. A Hobby workspace has no workspace subscription charge. Confirm the dashboard total before provisioning. [Render pricing](https://render.com/pricing).

A free Render web service cannot attach a persistent disk; its local filesystem is ephemeral. That would lose SQLite accounts and cases after restarts. This Blueprint intentionally uses a paid disk-backed service. [Persistent disk behavior](https://render.com/docs/disks).

The deployment defaults to fictional samples: no CALL-E key, no recipients, no authorized live accounts, and `LIVE_CALLS_ENABLED=false`. Do not import the development database or private call artifacts. The public judge walkthrough needs no account or credentials; each guest gets an isolated workspace. Signup is optional.

After provisioning:

1. Open the generated service URL and check `/api/health`.
2. Run the README's fictional repair walkthrough and confirm the comparison and evidence load.
3. Create a synthetic test account, save a case, sign out and sign back in.
4. Restart this service, sign in again, and verify the saved case and revisions survived.
5. Inspect the mounted disk and confirm `DATABASE_PATH=/var/data/readycheck.sqlite`.
6. Keep the service accessible through the judging period and record the URL and tested commit in your release notes.

Only data under the disk mount persists. A disk-backed service uses one instance and has brief restart downtime during deploys. CI-gated automatic deployment is configured; deployments wait for repository checks. [Blueprint reference](https://render.com/docs/blueprint-spec).

## Docker alternative

The Dockerfile remains available for any persistent container host. Mount a volume at `/app/data`, set `APP_ORIGIN` to the actual HTTPS origin, and keep live calling disabled for the sample pilot. Use one replica. The entry point supports preparing a root-owned volume before dropping privileges; ordinary Docker named volumes use the image's default `node` user. Never deploy SQLite on ephemeral storage while promising saved-case persistence.

Server REST credentials belong in the host's secret controls only. CALL-E CLI OAuth credentials are separate and must not be copied into the deployment. Enabling live mode still requires recipient/account allowlists, limits and per-plan approval.

## Backup

Use Node 24 for the operation below (the backup API requires at least Node 22.16). Run as the application user inside the container:

```sh
node scripts/backup.mjs /app/data/backups
```

On Render, use `/var/data/backups` instead.

The script uses [SQLite's online backup API through Node](https://nodejs.org/api/sqlite.html#sqlitebackupsourceDb-path-options), opens the source read-only, creates a unique private directory and validates the resulting snapshot with `PRAGMA integrity_check`. It includes committed WAL transactions and never overwrites an earlier snapshot. Only the output path is printed. A failed command is not a successful backup.

Export the verified snapshot to restricted storage outside this volume. Keeping the only backup alongside the source does not protect against volume loss. Backups contain account credentials, sessions, cases and transcripts; restrict access and apply the same retention/deletion policy. Schedule and monitor backups before inviting users. Automatic backups are not configured by the application.

## Restore drill and recovery

1. Keep the original service and volume intact. Provision an isolated replacement volume and service with live calling disabled and no CALL-E key.
2. Copy the verified snapshot to the configured `DATABASE_PATH` on the empty replacement volume. Do not mix it with older `-wal` or `-shm` files.
3. Start the container, verify health, sign in with a test account, and inspect saved cases and revisions. Compare expected records from the backup time; newer writes cannot be restored from an older snapshot.
4. Before switching traffic, stop writes to the original service. Reconcile every inquiry created since the snapshot with provider records. Stop restored queued work and invalidate its approvals; never enable calls merely because the restore succeeded. Keep uncertain calls paused and recover known IDs read-only.
5. Switch traffic only after the operator verifies the replacement. Preserve the old volume for rollback and maintain `LIVE_CALLS_ENABLED=false` until reconciliation is complete.

Account support currently means helping a user recover access through an established session or export their case data. There is no automated email reset. Do not reset an account based only on someone claiming its email address.

## Rollback or disable

Set `LIVE_CALLS_ENABLED=false` and restart to prevent new dispatches. This does not cancel an active provider call. Use the application's stop-future-calls action for queued plans and retain inquiry records for reconciliation. Roll back the application image only if it supports the existing database schema; never replace the live volume with an older snapshot as a routine code rollback.

## Live-call setup

Regular tests and rehearsals never place calls. A live inquiry needs a configured server key, an authorized account, a consenting recipient and approval of its reviewed plan in the app.

Copy `.env.example` to `.env` if no local configuration exists. Set:

| Variable                                      | Purpose                                                                             |
| --------------------------------------------- | ----------------------------------------------------------------------------------- |
| `CALLE_API_KEY`                               | Server-side CALL-E API key; separate from CLI OAuth credentials                     |
| `APP_ORIGIN`                                  | Exact browser origin, including protocol and port                                   |
| `TEST_RECIPIENTS_JSON`                        | Consenting participants: `id`, `name`, E.164 `phone`, `consentRef`, IANA `timezone` |
| `LIVE_USER_IDS`                               | Exact registered account IDs, available in Connection                               |
| `MAX_CALLS_PER_DAY`, `MAX_CALLS_PER_USER_DAY` | Global and account dispatch limits                                                  |
| `CALL_WINDOW_START`, `CALL_WINDOW_END`        | Recipient-local same-day hours: start 0–23, end 1–24                                |
| `LIVE_CALLS_ENABLED`                          | Explicit server enablement; defaults to false                                       |

Run `npm run live:check` (or add `-- --json`). It checks local configuration, database access and authorized accounts without network requests or printing private values. Exit code 1 means setup is incomplete. It does not verify credits or call creation. Restart after changing environment settings.

**Connection → Check existing-call access** performs a provider GET for an owned saved inquiry, or optional `CALLE_VERIFICATION_CALL_ID`. Use the API call-task ID, not the dashboard's telephone-attempt ID. This check works with calling disabled, is limited to once per minute and does not create a call.

Before enabling broader use, validate the caller with consenting participants across negotiation, screening, hold, refusal and uncertain-answer scenarios. Review the transcript against the original requirements. A completed call does not establish a successful task. The current policy 1.3.0 has local regression coverage but still needs live validation. Disable calling after the approved session.

## Lost responses and recovery

A create timeout does not prove that no call happened. Keep the inquiry and reservation paused; do not redial or generate a replacement key.

- With an API task ID, use the app's reconciliation action. It reads the existing task and attaches it only when `readycheck_inquiry_id` matches.
- Without an ID, the app offers **Recover original request once** while the approved plan is current, live access is enabled and recipient routing, consent and calling hours still match. It replays the **exact persisted body and original idempotency key**, using the [documented recovery contract](https://docs.heycall-e.com/calls#recover-after-a-restart-or-lost-response). If the first request never arrived, this can start the approved call now. It retains the existing budget reservation. A persisted marker blocks another replay, including after a restart.
- If request recovery fails, use the saved call reference for read-only reconciliation or contact the provider. Expired, changed, stopped or disabled requests permit ID reconciliation only. Never rebuild the payload or invent a replacement key.
- Once the ID is known, refresh/restart should resume reads of that ID. Use mocked fault tests for deliberate response-loss experiments.
- “Stop future calls” stops queued work; it does not cancel an active provider call.
