# ReadyCheck pilot operations

Run one Node instance with HTTPS and persistent storage: `/var/data` on Render or a volume at `/app/data` with Docker. Keep `LIVE_CALLS_ENABLED=false` for the sample pilot. The application has no public business discovery, email verification or password recovery service. An operator must be available before inviting users to depend on it.

## Railway Hobby deployment

The public fictional demo is [readycheck-demo.up.railway.app](https://readycheck-demo.up.railway.app). Railway accepted and built the tracked-only release **918659b** on September 13, 2026, after the workspace upgraded to Hobby. The API reports the active plan as `HOBBY` and deployment `76b9730d-1df0-48b1-b0e6-d226a1a68022` as successful.

The deployment uses the root Dockerfile, one instance, sleep when idle, `/api/health`, port 3000 and HTTPS `APP_ORIGIN`. Its 500 MB volume is mounted at `/app/data`; `DATABASE_PATH=/app/data/readycheck-20260913.sqlite` keeps ReadyCheck separate from pre-existing files. `RAILWAY_RUN_UID=0` lets the existing container entry point prepare only its configured database paths, then drop to the `node` user before starting the application. The previous repository source was disconnected; this release was uploaded with the CLI, so GitHub pushes do not currently auto-deploy.

Live calling is disabled, with no CALL-E key or permitted live recipients/accounts. The local development database and private call artifacts were excluded from the upload. Judge access uses fictional samples without account creation; signup remains optional.

Hobby costs a $5 monthly minimum including $5 of resource usage, with extra usage billed above that allowance. A **$5 compute-usage email alert and $10 hard limit** are configured. Railway rejected a $5 hard limit because its minimum positive hard limit is $10. Reaching the hard limit takes the service offline; monitor usage through judging. Sleep can also introduce a delay on the first request after inactivity. [Pricing](https://railway.com/pricing) and [usage controls](https://docs.railway.com/pricing/cost-control).

The hosted repair workflow, signup, fresh sign-in, export and mobile evidence checks passed. A service restart preserved the synthetic account, case and saved outcome. See the [verification record](VERIFICATION.md) for the tested scope.

For future releases, upload a tracked-only checkout with `railway up --project <project-id> --service <service-id> --environment production --detach`. Wait for deployment success, check `/api/health`, and run the fictional repair walkthrough. Preserve the volume and database filename. A healthy build alone does not establish data persistence; see the [verification record](VERIFICATION.md) for observed checks.

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
6. Keep the service accessible through the judging period and record the URL and tested commit in the verification record.

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
