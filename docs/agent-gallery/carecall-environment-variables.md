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
| `QSTASH_URL` | Configuration | Selects the regional QStash API origin used to publish queue messages. The token, signing keys, and URL must belong to the same region. | Use `https://qstash-us-east-1.upstash.io` for the US region. The EU region uses `https://qstash-eu-central-1.upstash.io`; omitting the variable uses the SDK's EU-compatible default `https://qstash.upstash.io`. | **No rotation.** Change only during an intentional regional migration, following Upstash's migration procedure for active resources. |
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

## Removed variable

`OPERATOR_ACCESS_CODE` gated the earlier appointment-recovery workflow, which has
been removed. Nothing reads it. **Delete it from every environment** — a secret
no code consults is a secret nobody rotates. Operator identity now comes only
from `CARECALL_OPERATORS_JSON` and `CARECALL_SESSION_SECRET`.

## Recreate and reinsert the variables in Vercel

Vercel can list configured variable names, but a value marked sensitive is
non-readable after it is stored. Do not expect `vercel env ls` or the dashboard
to recover those values. Retrieve provider-issued credentials from the provider,
retrieve the CALL-E token from the local CLI cache without printing it, or
generate a replacement value as described below.

Run these commands from the Vercel project directory:

```sh
cd apps/typescript/agent-gallery
```

Install and link the official Vercel CLI if necessary:

```sh
npm install --global vercel
vercel login
vercel link
```

The command forms below follow Vercel's current
[`vercel env` reference](https://vercel.com/docs/cli/env). The local directory
may be linked to the correct project and team. To make the target explicit and
keep the commands working from an unlinked checkout, set the project name once:

```sh
CARECALL_VERCEL_PROJECT='awesome-phone-call-agents'
```

Confirm the target before changing anything:

```sh
vercel env ls preview --project "$CARECALL_VERCEL_PROJECT"
vercel env ls production --project "$CARECALL_VERCEL_PROJECT"
```

The examples below target Preview first. Change `preview` to `production` only
when the Preview deployment is healthy. `vercel env update` replaces an
existing variable and reads its new value from the prompt or standard input.
If the variable does not exist yet, use `vercel env add` with the same name and
environment instead. Add `--sensitive` for every secret or sensitive
configuration value.

Do not use `echo "secret" | ...`: the cleartext may be written to shell history.
The commands below either prompt securely or pipe a generated/provider value
directly without printing it.

### 1. CALL-E token and server URL

First verify that the official CALL-E CLI cache is usable. This does not print
the access token:

```sh
env \
  CALLE_SOURCE=skills_sh \
  CALLE_INTEGRATION=skills_sh_skill \
  CALLE_INTEGRATION_VERSION=0.1.0 \
  calle auth status
```

If `usable` is `false`, refresh the cache through the official authorization
flow before continuing:

```sh
env \
  CALLE_SOURCE=skills_sh \
  CALLE_INTEGRATION=skills_sh_skill \
  CALLE_INTEGRATION_VERSION=0.1.0 \
  calle auth login --start-only --no-browser-open
# Complete the displayed browser authorization, then:
env \
  CALLE_SOURCE=skills_sh \
  CALLE_INTEGRATION=skills_sh_skill \
  CALLE_INTEGRATION_VERSION=0.1.0 \
  calle auth login --no-browser-open
```

Transfer the cached token directly into Vercel without displaying it. These
commands require `jq`:

```sh
CARECALL_CALLE_STATUS="$(env \
  CALLE_SOURCE=skills_sh \
  CALLE_INTEGRATION=skills_sh_skill \
  CALLE_INTEGRATION_VERSION=0.1.0 \
  calle auth status)"
CARECALL_CALLE_CACHE="$(printf '%s' "$CARECALL_CALLE_STATUS" | jq -r '.cache_path')"

jq -e -j -r \
  '.token.access_token | select(type == "string" and length > 0)' \
  "$CARECALL_CALLE_CACHE" \
  | vercel env add CALLE_ACCESS_TOKEN preview \
      --force --sensitive --yes \
      --project "$CARECALL_VERCEL_PROJECT"

printf '%s' "$CARECALL_CALLE_STATUS" \
  | jq -e -j -r \
      '.server_url | select(type == "string" and startswith("https://"))' \
  | vercel env add CALLE_SERVER_URL preview \
      --force --no-sensitive --yes \
      --project "$CARECALL_VERCEL_PROJECT"

unset CARECALL_CALLE_STATUS CARECALL_CALLE_CACHE
```

Repeat the two `vercel env add` commands with `production` only if the same
CALL-E identity and endpoint are approved for Production. Prefer separate
provider credentials when available.

### 2. Operator ID and sign-in code

The operator sign-in code is the original cleartext code; Vercel stores only
its SHA-256 hash inside `CARECALL_OPERATORS_JSON`. The hash cannot be converted
back into the sign-in code. If the cleartext was not saved, create a new long
code in a password manager and replace the hash.

For the current single-operator pilot, enter the new code when prompted. This
builds the JSON and transfers it to Vercel without printing the code or hash:

```sh
read -s "CARECALL_OPERATOR_CODE?New operator sign-in code: "
echo
CARECALL_OPERATOR_HASH="$(printf '%s' "$CARECALL_OPERATOR_CODE" | shasum -a 256 | awk '{print $1}')"

jq -nc --arg hash "$CARECALL_OPERATOR_HASH" \
  '[{"id":"mei-chen","name":"Mei Chen","role":"coordinator","access_code_sha256":$hash,"senior_ids":["mdm-lim"]}]' \
  | vercel env update CARECALL_OPERATORS_JSON preview \
      --sensitive --yes \
      --project "$CARECALL_VERCEL_PROJECT"

unset CARECALL_OPERATOR_CODE CARECALL_OPERATOR_HASH
```

Use `mei-chen` as the Operator ID and the cleartext value saved in the password
manager as the Operator sign-in code. Do not use the public test credential
from the repository. If the real roster has additional operators or senior
scopes, construct the complete JSON instead of replacing it with this
single-operator example. A short code may be used only with fictional POC data;
replace it with a password-manager-generated code of at least 16 characters
before any consenting participant or real care information is involved.

Generate a new session-signing secret and transfer it directly:

```sh
openssl rand -base64 48 \
  | tr -d '\n' \
  | vercel env update CARECALL_SESSION_SECRET preview \
      --sensitive --yes \
      --project "$CARECALL_VERCEL_PROJECT"
```

Changing `CARECALL_SESSION_SECRET` immediately invalidates existing operator
sessions. Operators can sign in again with their unchanged cleartext access
codes.

### 3. Upstash Redis values

Open the Upstash Console, select the pilot Redis database, and copy the REST
URL and **Standard** REST token from the REST API section. The read-only token
will not work. Paste each value only when the Vercel CLI prompts:

```sh
vercel env update UPSTASH_REDIS_REST_URL preview \
  --sensitive --yes \
  --project "$CARECALL_VERCEL_PROJECT"
vercel env update UPSTASH_REDIS_REST_TOKEN preview \
  --sensitive --yes \
  --project "$CARECALL_VERCEL_PROJECT"
```

If the existing Standard token is no longer available, reset the database
password in Upstash, then update every affected deployment immediately. That
reset invalidates the old REST tokens.

### 4. Phone-data encryption key

If encrypted schedules or queued jobs already exist, restore the exact existing
`CARECALL_DATA_ENCRYPTION_KEY` from the approved password manager or secret
store:

```sh
vercel env update CARECALL_DATA_ENCRYPTION_KEY preview \
  --sensitive --yes \
  --project "$CARECALL_VERCEL_PROJECT"
```

Do **not** generate a replacement merely because the old value is unavailable:
existing phone ciphertext cannot be decrypted with a new key. For a fresh
environment with no schedules or queued jobs, generate the initial key
directly:

```sh
openssl rand -base64 48 \
  | tr -d '\n' \
  | vercel env update CARECALL_DATA_ENCRYPTION_KEY preview \
      --sensitive --yes \
      --project "$CARECALL_VERCEL_PROJECT"
```

If the old key is irrecoverable, pause schedules, cancel or drain queued jobs,
deploy a new key, and recreate every recurring authorization.

### 5. Pilot limits, cron secret, and callback origin

Set the controlled-pilot daily call limit:

```sh
printf '%s' '5' \
  | vercel env update CARECALL_MAX_CALLS_PER_DAY preview \
      --yes \
      --project "$CARECALL_VERCEL_PROJECT"
```

Generate a new reconciliation/readiness secret:

```sh
openssl rand -hex 32 \
  | tr -d '\n' \
  | vercel env update CRON_SECRET preview \
      --sensitive --yes \
      --project "$CARECALL_VERCEL_PROJECT"
```

Set the exact stable HTTPS origin for the target deployment. Use the branch
alias shown by Vercel for a draft-PR Preview, not the production domain or the
one-off deployment URL. Replace the placeholder; do not include a trailing
slash or a path:

```sh
CARECALL_PUBLIC_BASE_URL='https://your-branch-stable-preview-alias.vercel.app'

printf '%s' "$CARECALL_PUBLIC_BASE_URL" \
  | vercel env add CARECALL_PUBLIC_BASE_URL preview \
      --force --no-sensitive --yes \
      --project "$CARECALL_VERCEL_PROJECT"
```

Use a branch-stable Preview URL or custom domain, not a commit-specific Vercel
deployment URL. QStash signature verification depends on this origin remaining
identical to the worker callback destination.

### 6. QStash token and signing keys

Copy `QSTASH_TOKEN` from the QStash section of the Upstash Console. Enter it at
a hidden shell prompt, use it to retrieve the current signing-key pair, and
transfer the URL and all three credential values without displaying the
credentials. The example below uses the US region:

```sh
carecall_restore_qstash() {
  local carecall_qstash_url='https://qstash-us-east-1.upstash.io'
  local carecall_qstash_token
  local carecall_qstash_keys

  read -s "carecall_qstash_token?QStash token: "
  echo

  carecall_qstash_keys="$(curl --fail --silent --show-error \
    --request GET \
    --url "$carecall_qstash_url/v2/keys" \
    --header "Authorization: Bearer $carecall_qstash_token")" || {
      echo 'QStash rejected the token or could not be reached.' >&2
      return 1
    }

  printf '%s' "$carecall_qstash_keys" \
    | jq -e '(.current | type == "string" and length > 0)
      and (.next | type == "string" and length > 0)' >/dev/null || {
        echo 'QStash returned an invalid signing-key response.' >&2
        return 1
      }

  printf '%s' "$carecall_qstash_url" \
    | vercel env add QSTASH_URL preview \
        --force --no-sensitive --yes \
        --project "$CARECALL_VERCEL_PROJECT"

  printf '%s' "$carecall_qstash_token" \
    | vercel env add QSTASH_TOKEN preview \
        --force --sensitive --yes \
        --project "$CARECALL_VERCEL_PROJECT"

  printf '%s' "$carecall_qstash_keys" \
    | jq -jr '.current' \
    | vercel env add QSTASH_CURRENT_SIGNING_KEY preview \
        --force --sensitive --yes \
        --project "$CARECALL_VERCEL_PROJECT"

  printf '%s' "$carecall_qstash_keys" \
    | jq -jr '.next' \
    | vercel env add QSTASH_NEXT_SIGNING_KEY preview \
        --force --sensitive --yes \
        --project "$CARECALL_VERCEL_PROJECT"
}

carecall_restore_qstash
unset -f carecall_restore_qstash
```

This retrieves the existing key pair; it does not rotate it. Do not call the
rotation endpoint merely to recover the current keys. The response fields and
endpoint are documented in Upstash's
[Get Signing Keys reference](https://upstash.com/docs/qstash/api-reference/signing-keys/get-signing-keys).
Use the region that issued the token; Upstash documents the independent US and
EU origins in its
[multi-region guide](https://upstash.com/docs/qstash/howto/multi-region).

### 7. Verify and redeploy

Check that every required name exists in the intended environment:

```sh
vercel env ls preview --project "$CARECALL_VERCEL_PROJECT"
```

Environment changes apply only to new deployments. Redeploy the branch-stable
Preview alias after every credential update:

```sh
vercel redeploy "$CARECALL_PUBLIC_BASE_URL" --target preview
```

Vercel Sensitive values are write-only: `vercel env run`, `vercel env pull`,
and the dashboard cannot recover `CRON_SECRET` after it is stored. Export the
known secret from the approved password manager at a hidden prompt and run the
protected, read-only preflight against the same stable alias:

```sh
CARECALL_PUBLIC_BASE_URL='https://your-branch-stable-preview-alias.vercel.app'
read -s "CRON_SECRET?CRON_SECRET: "
echo
export CRON_SECRET CARECALL_PUBLIC_BASE_URL

npm run preflight

unset CRON_SECRET CARECALL_PUBLIC_BASE_URL
```

If the current `CRON_SECRET` was not saved, rotate it and keep the replacement
only in the current shell until the redeployed Preview passes preflight:

```sh
CARECALL_PUBLIC_BASE_URL='https://your-branch-stable-preview-alias.vercel.app'
CARECALL_NEW_CRON_SECRET="$(openssl rand -hex 32)"

printf '%s' "$CARECALL_NEW_CRON_SECRET" \
  | vercel env update CRON_SECRET preview \
      --sensitive --yes \
      --project "$CARECALL_VERCEL_PROJECT"

export CRON_SECRET="$CARECALL_NEW_CRON_SECRET"
export CARECALL_PUBLIC_BASE_URL

vercel redeploy "$CARECALL_PUBLIC_BASE_URL" --target preview
npm run preflight

unset CRON_SECRET CARECALL_PUBLIC_BASE_URL CARECALL_NEW_CRON_SECRET
```

Save the replacement in the approved password manager before unsetting it if
future manual preflight checks must reuse the same credential.

Proceed to Production only after Preview reports `ready: true` and
`healthy: true`. Repeat the same explicit-origin and hidden-secret procedure
with the Production environment; never reuse a Preview-only callback origin.

The CLI cannot confirm that a secret is semantically correct merely because
its name exists. The preflight and a fictional non-dialing queue test are the
required checks. Avoid `vercel env pull` for routine recovery because it writes
retrievable environment values to a plaintext local file. Sensitive values are
omitted rather than recovered.

After completing the work, remove the project helper from the shell:

```sh
unset CARECALL_VERCEL_PROJECT
```

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
