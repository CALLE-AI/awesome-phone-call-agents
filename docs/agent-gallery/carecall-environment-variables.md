# CareCall Environment Variable Reference

This document is the deployment and credential-lifecycle reference for the
CareCall SG pilot. It records variable names and operating procedures only.
Never add real values to this repository, issues, pull requests, screenshots,
logs, or chat.

Configure Preview or staging before Production. Prefer separate CALL-E,
Upstash, operator, and application credentials for each environment so a test
deployment cannot access production calls or records.

## Required variables

### CALL-E provider

| Variable | Classification | Purpose and usage | How to obtain it | Renewal and rotation |
| --- | --- | --- | --- | --- |
| `CALLE_ACCESS_TOKEN` | Secret | Bearer credential used by the server-side CALL-E MCP client to plan a call, start the authorized call, and read its status. It must never reach the browser bundle. | Run the official CALL-E CLI authorization flow, confirm readiness with `calle auth status`, and transfer the cached `token` field to Vercel without printing it. For a long-running production deployment, prefer a provider-issued service credential if CALL-E offers one. | **Expiry-driven and event-driven.** Check the reported expiry monthly and replace it at least 30 days before expiry. Replace immediately after a `401`, revocation, suspected exposure, or departure of a person whose identity owns the token. The current app does not refresh OAuth credentials automatically, so replacement and redeployment are manual. |
| `CALLE_SERVER_URL` | Configuration | HTTPS MCP endpoint passed to the CALL-E client. | Read `server_url` from `calle auth status` or use the route supplied by CALL-E. The current route is `https://seleven-mcp-sg.airudder.com/mcp/openagent_oauth`. | **No rotation.** Change only when CALL-E migrates the route or the deployment changes provider environment. Re-run provider readiness after a change. |

The application requires the `plan_call`, `run_call`, and `get_call_run`
tools. Provider authorization is not ready until all three are available.

### Operator authentication

| Variable | Classification | Purpose and usage | How to obtain it | Renewal and rotation |
| --- | --- | --- | --- | --- |
| `CARECALL_OPERATORS_JSON` | Sensitive configuration | Defines each operator's stable ID, display name, role, access-code hash, and allowed senior IDs. Protected routes use it for identity and scope checks. | Build the JSON from the approved operator roster. Hash each access code locally with SHA-256; store only the 64-character hexadecimal hash. | **Event-driven.** Update immediately for joining, leaving, role changes, senior-scope changes, or an access-code reset. Review the roster and scopes quarterly. Do not force arbitrary access-code changes when codes are long and randomly generated unless organisational policy requires it; rotate immediately after suspected disclosure. |
| `CARECALL_SESSION_SECRET` | Secret | HMAC secret used to issue and verify 30-minute operator sessions. | Generate at least 32 random characters. Recommended: `openssl rand -base64 48`. | **Every 90 days or per security policy**, and immediately after suspected exposure. Rotation invalidates existing sessions; because sessions last only 30 minutes, rotate between operator sessions and redeploy. There is currently no dual-secret overlap. |

Example structure, with placeholders only:

```json
[{"id":"operator-id","name":"Operator Name","role":"coordinator","access_code_sha256":"<64-character-sha256>","senior_ids":["senior-id"]}]
```

Generate an operator access-code hash on macOS without placing the cleartext
code in shell history:

```sh
read -s "CARECALL_CODE?Operator access code: "
echo
printf '%s' "$CARECALL_CODE" | shasum -a 256
unset CARECALL_CODE
```

Use a long password-manager-generated access code. A short numeric PIN remains
guessable offline if the hashed operator configuration is exposed.

### Durable Redis storage

| Variable | Classification | Purpose and usage | How to obtain it | Renewal and rotation |
| --- | --- | --- | --- | --- |
| `UPSTASH_REDIS_REST_URL` | Sensitive configuration | HTTPS endpoint for durable queue, schedule, idempotency, lease, review, and audit records. | In the Upstash Console, open the Redis database and copy `UPSTASH_REDIS_REST_URL` from its REST API section. | **No routine rotation.** Update when the database endpoint or environment changes. Treat it as internal even though it is not sufficient for authentication by itself. |
| `UPSTASH_REDIS_REST_TOKEN` | Secret | Standard Redis REST token. CareCall needs write access; a read-only token is insufficient. | In the database's REST API section, copy the Standard `UPSTASH_REDIS_REST_TOKEN`. | **Every 180 days or per security policy**, and immediately after suspected exposure or privileged team departure. Upstash resets the database password to revoke the default REST tokens, so the old token may stop working immediately. Use a maintenance window: pause new authorizations, reset, update Vercel, redeploy, run preflight, and resume. |

Upstash documents the Standard and read-only REST tokens and explains that
resetting the database password revokes both:
[Upstash Redis REST authentication](https://upstash.com/docs/redis/features/restapi).

### Data protection and operating limits

| Variable | Classification | Purpose and usage | How to obtain it | Renewal and rotation |
| --- | --- | --- | --- | --- |
| `CARECALL_DATA_ENCRYPTION_KEY` | Secret | Derives the AES-GCM key used to encrypt phone numbers stored in schedules and queued jobs. | Generate at least 32 random characters. Recommended: `openssl rand -base64 48`. | **Do not rotate routinely with the current storage format.** Ciphertext has no key-version marker, so replacing this value alone makes existing phone records unreadable. Rotate immediately only through a planned migration or after compromise. For the pilot: pause schedules, stop new authorizations, drain or cancel queued jobs, replace the key, redeploy, and recreate authorized schedules. Add a versioned keyring and re-encryption migration before adopting scheduled rotation. |
| `CARECALL_MAX_CALLS_PER_DAY` | Configuration | Durable daily safety and spending limit checked immediately before dialing. | Choose an approved integer. Start the controlled pilot at `5`; increase only after operational sign-off. | **No rotation.** Review monthly and before every pilot-volume increase. Lower it immediately when pausing or reducing risk. A value change requires redeployment. |
| `CRON_SECRET` | Secret | Bearer secret protecting the reconciliation scheduler and the read-only readiness endpoint. Vercel Cron sends it to the scheduled route as authorization. | Generate a high-entropy header-safe value. Recommended: `openssl rand -hex 32`. | **Every 90 days or per security policy**, and immediately after suspected exposure. Update Vercel and redeploy; verify both readiness and the next reconciliation request. Old deployments retain old environment values. |
| `CARECALL_PUBLIC_BASE_URL` | Configuration | Exact public HTTPS origin used to construct the QStash worker callback URL. Signature verification depends on the worker URL matching exactly. | Use the stable Preview/staging or Production deployment URL, preferably a custom domain. Do not use a short-lived deployment URL. | **No rotation.** Update whenever the deployment hostname, environment, or custom domain changes. Republish or recreate affected delayed messages if their destination is no longer valid. |

### QStash delivery and verification

| Variable | Classification | Purpose and usage | How to obtain it | Renewal and rotation |
| --- | --- | --- | --- | --- |
| `QSTASH_TOKEN` | Secret | Authorizes the server to publish immediate and delayed queue messages to QStash. | Copy the QStash authorization token from the Upstash Console. | **Every 180 days or per security policy**, and immediately after suspected exposure or privileged team departure. Resetting the QStash token invalidates the old credential; update Vercel, redeploy, and test publishing before resuming authorizations. |
| `QSTASH_CURRENT_SIGNING_KEY` | Secret | Verifies signatures created with QStash's current signing key. | Copy the current signing key from the QStash Console or retrieve it through the signing-keys API using `QSTASH_TOKEN`. | **Rotate as a pair every 180 days or after suspected exposure.** Follow the two-key procedure below. Never rotate twice before the new pair is deployed. |
| `QSTASH_NEXT_SIGNING_KEY` | Secret | Provides overlap during signing-key rollover so messages signed with the next key remain valid. | Copy the next signing key alongside the current key. | **Rotate with the current key.** It is not an independent credential and must always be updated from the same QStash key response. |

QStash documents how to obtain the token and verify signatures in its
[security guide](https://upstash.com/docs/qstash/features/security). During a
[signing-key rotation](https://upstash.com/docs/workflow/api-reference/signing-keys/rotate-signing-keys),
the old next key becomes the new current key and QStash creates a new next key.

Use this order to avoid downtime:

1. Confirm the deployed app has QStash's current and next keys.
2. Rotate the pair once in QStash.
3. Replace both Vercel variables with the returned pair.
4. Redeploy every affected Preview and Production environment.
5. Run the protected preflight and verify a fictional queue delivery.
6. Do not perform a second rotation until all active deployments use the new
   pair.

## Optional legacy variable

| Variable | Classification | Purpose and usage | How to obtain it | Renewal and rotation |
| --- | --- | --- | --- | --- |
| `OPERATOR_ACCESS_CODE` | Secret | Legacy access-code gate for the appointment-recovery workflow. CareCall operator sessions do not use it. | Generate a long random value in a password manager only if the legacy workflow remains enabled. | **Event-driven.** Rotate after suspected exposure, operator-access changes, or according to the legacy workflow's security policy. Remove it when that workflow is disabled. |

## Rotation procedure

Vercel applies environment-variable changes only to new deployments. For a
provider that supports overlapping credentials, use this sequence:

1. Create the replacement credential without revoking the old one.
2. Update the correct Vercel environments: Preview, Production, and any custom
   environment that uses the credential.
3. Redeploy every affected deployment.
4. Run `npm run preflight` and complete a non-dialing or fictional smoke test.
5. Revoke the old credential only after the new deployments pass.
6. Record the variable name, environment, rotation date, reason, owner, and
   next review date. Never record the value.

If the provider invalidates the old value immediately, pause new call
authorizations and use a maintenance window. Vercel's
[secret-rotation guidance](https://vercel.com/docs/environment-variables/rotating-secrets)
also recommends deploying and verifying the replacement before invalidating
the old value whenever the provider supports overlap. Vercel also documents
that [`CRON_SECRET` is sent automatically as a Bearer authorization header](https://vercel.com/docs/cron-jobs/manage-cron-jobs).

After any change, run the protected preflight from a trusted terminal:

```sh
npm run preflight
```

Do not proceed with a live call unless the response reports both `ready: true`
and `healthy: true`.

## Ownership and review cadence

Use these operating defaults unless a stricter organisational policy applies:

- Monthly: check CALL-E expiry, readiness health, daily call limit, and pending
  operational alerts.
- Quarterly: review operator membership and scope; rotate the session and cron
  secrets.
- Every 180 days: rotate Redis and QStash credentials in a maintenance window,
  including the QStash signing-key pair.
- Event-driven: rotate any affected credential immediately after suspected
  exposure, unauthorised access, owner departure, provider revocation, or a
  security incident.
- Before every live pilot: confirm the exact Vercel environment, run preflight,
  and ensure no expired credential or stale deployment remains.

The code-level consumers are implemented in
[`calls.ts`](../../apps/typescript/agent-gallery/api/_lib/calls.ts),
[`operator-auth.ts`](../../apps/typescript/agent-gallery/api/_lib/operator-auth.ts),
[`call-queue.ts`](../../apps/typescript/agent-gallery/api/_lib/call-queue.ts),
and [`schedules.ts`](../../apps/typescript/agent-gallery/api/_lib/schedules.ts).
