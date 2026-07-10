# HubSpot CALL-E Direct-Call Setup

This is an administrator deployment and local-verification reference for the private static HubSpot Projects app. The [direct-call user manual](direct-call-user-manual.md) is authoritative for installation roles, distribution, workflow configuration, App Card setup, consent, cancellation, and ordinary-user operation.

## Prerequisites

- Node.js `20.0.0` or newer.
- HubSpot CLI `8.4.0` or newer, authenticated with a deployer's personal access key that can upload developer projects and read or write serverless secrets for the target standard account.
- Content Hub Enterprise for the public serverless endpoint used by the workflow action.
- A CALL-E API key and authorized E.164 test phone number.
- Administrator access to install or reinstall the static app and customize Contact or Deal record layouts.

The installed static app's scopes are separate from CLI deployment permissions. It separately requests `oauth`; its two `crm.objects.*` scopes in `hubspot-project/src/app/app-hsmeta.json` are read-only access to contacts and deals.

## Deploy Or Recover

Authenticate and verify the configured target alias before deployment:

```bash
hs account auth
hs account list
hs account info <configured-standard-account>
```

Use a hidden shell prompt so the API key does not enter shell history. `CALL_E_BASE_URL` defaults to and accepts only the exact origin `https://api.heycall-e.com`, with no alternate host, path, credentials, query, or fragment. The workflow endpoint must use HTTPS and the exact `/hs/serverless/calle/create-call` path.

```bash
cd plugins/hubspot-calle
read -s CALL_E_API_KEY
export CALL_E_API_KEY
node scripts/install-direct-call.mjs \
  --account <configured-standard-account> \
  --endpoint-host <hubspot-account-id>.hs-sites.com \
  --set-secrets-from-env
unset CALL_E_API_KEY
```

The installer validates the local Node.js version, detected HubSpot CLI version, and requested account before local metadata or remote mutation, configures the account-specific action URL, writes secrets when requested, builds, validates, uploads, and reports `installed`, `reinstall_required`, `manual_install_required`, or `upload_skipped`.

If it generates `CALLE_WORKFLOW_ENDPOINT_TOKEN`, it prints the value once before mutation. Store it with administrator secrets. For a recovery rerun, prompt for the saved value instead of allowing a new one to replace it:

```bash
read -s CALL_E_API_KEY
export CALL_E_API_KEY
read -s CALLE_WORKFLOW_ENDPOINT_TOKEN
export CALLE_WORKFLOW_ENDPOINT_TOKEN
node scripts/install-direct-call.mjs \
  --account <configured-standard-account> \
  --endpoint-host <hubspot-account-id>.hs-sites.com \
  --set-secrets-from-env
unset CALL_E_API_KEY CALLE_WORKFLOW_ENDPOINT_TOKEN
```

Without `--set-secrets-from-env`, the installer verifies that all required secrets exist and fails before mutation if any are absent. `--skip-secrets` intentionally skips that check and all secret writes; use it only after independently checking remote secret configuration.

After upload, use `Distribution -> Standard install` for the customer account. Reinstall when the installer reports `reinstall_required`; install when it reports `manual_install_required`. A developer test install is optional and is managed by the project owner under `Distribution -> Test installs`; it is not needed for App Cards in the standard account.

## Project Layout

```text
hubspot-project/
├── hsproject.json
└── src/app/
    ├── app-hsmeta.json
    ├── functions/
    └── workflow-actions/
```

The installer updates `src/app/workflow-actions/create-call-candidate-hsmeta.json` with the target account's public endpoint before upload. This is account-specific metadata. Rerun the installer for another customer account rather than sharing a deployed copy or a static app install.

## Required Secrets

The serverless functions use these HubSpot secrets:

- `CALLE_WORKFLOW_ENDPOINT_TOKEN`
- `CALL_E_API_KEY`
- `CALL_E_BASE_URL`

Do not put those values in CRM records, workflow documentation, client-side code, or repository files. Only an administrator configures the endpoint token in the workflow action; ordinary users do not receive or enter it.

## Local Tests And Manual Verification

The serverless tests do not call HubSpot or CALL-E:

```bash
cd plugins/hubspot-calle/hubspot-project/src/app/functions
npm test
```

Before broader enrollment:

1. Use a manually enrolled Contact workflow and one authorized E.164 test number.
2. Confirm a record with no phone or an invalid phone creates no CALL-E request.
3. Confirm the action creates no request unless `Phone contact allowed` is explicitly `Yes` and `Do not call` is explicitly `No`. These selections are static configuration, not per-record CRM checks, so enrollment filters must still exclude records without phone-contact consent and records marked do-not-call.
4. Confirm one eligible record returns `call_id`, `status`, `masked_phone`, and `error` without exposing secrets.
5. Replay the same workflow run and confirm idempotency prevents a duplicate task.
6. Confirm both App Cards require confirmation before creating a task and that the standard installed app is available from the App Card library.
7. Confirm every CALL-E task begins with the fixed high-stakes instruction before the user-provided task.

## Rollback And Accepted Calls

To prevent new calls, disable active workflows, remove the action from active workflows, and rotate or remove `CALL_E_API_KEY`. Rotate `CALLE_WORKFLOW_ENDPOINT_TOKEN` to block new public-endpoint requests, then update the administrator-configured workflow token before re-enabling a workflow. Remove App Cards from record layouts or uninstall the static app when the integration is no longer needed.

These actions do not cancel a call that CALL-E already accepted. Card confirmation `Cancel` prevents only the pending submission. Use CALL-E-supported dashboard or API controls for queued or running calls; this integration does not define a cancellation endpoint.
