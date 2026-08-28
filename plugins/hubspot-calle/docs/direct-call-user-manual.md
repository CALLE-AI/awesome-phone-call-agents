# CALL-E for HubSpot Direct-Call User Manual

This is the authoritative guide for the private static HubSpot app that creates CALL-E call tasks from HubSpot workflows and CRM record App Cards. It is for a low-permission mode: HubSpot supplies record context and triggers; CALL-E stores call state and results. The integration does not create HubSpot CRM properties, tasks, notes, custom objects, or status writebacks.

## Deployment And Distribution Model

The app uses static HubSpot authentication and HubSpot-hosted serverless functions. It has no external backend, no Marketplace distribution, and no shared multi-account installation link. Each no-backend customer deployment is an independent static app copy configured for that customer's standard account. A shared link for multiple customer accounts requires OAuth and is out of scope.

One static App ID can be installed in one standard HubSpot account. The project owner may also create up to ten developer test installs, managed from that project-owner standard account at `Distribution -> Test installs`. A standard installation does not need a developer test install for the App Cards to appear.

The custom workflow action calls a public HubSpot serverless endpoint. Public HubSpot serverless endpoints require Content Hub Enterprise.

## Responsibilities And Prerequisites

Keep these permission boundaries separate.

| Area | Who needs it | Requirement |
| --- | --- | --- |
| HubSpot CLI deployment | Administrator or deployer | Node.js `20.0.0` or newer and a HubSpot CLI personal access key authenticated to the target account, with HubSpot CLI `8.4.0` or newer for developer projects and serverless secrets. The deployment permissions include project upload and secret read/write operations; they are not the app's installed CRM scopes. |
| Installed static app | HubSpot account | The app requests only the scope in `hubspot-project/src/app/app-hsmeta.json`: `crm.objects.contacts.read`. It does not request CRM write scopes. |
| HubSpot product | Customer account | Content Hub Enterprise for the public workflow endpoint. The account must also support the administrator's project-app installation and CRM record customization work. |
| HubSpot administration | Administrator | Permission to install or reinstall the app, manage serverless secrets, configure workflows, customize Contact record layouts to add App Cards, and read the project App Client Secret from the App `Auth` tab. |
| CALL-E | Administrator | Create or select a CALL-E API key at https://dashboard.heycall-e.com/account/api-keys. Use the official [CALL-E API Reference](https://test-docs.heycall-e.com/api-reference) for request and response contracts, and retain CALL-E dashboard access for call review and any provider-supported cancellation. |

Before the first deployment, confirm that the test phone number is authorized for outbound contact and stored in E.164 format, for example `+15555550123`.

## Administrator: Agent-Assisted Installation

Administrators who want Agent assistance should start with the [Administrator Agent Prompt](./admin-agent-prompt.md). It begins with a read-only preflight, keeps this manual authoritative for deployment behavior, and stops for explicit approval before secret entry, uploads, permission grants, record-layout saves, workflow activation, or real calls.

Browser automation is optional in that workflow. When browser control is unavailable or not approved, the administrator follows the same HubSpot steps manually.

## Administrator: First-Time Installation

Before running the installer, create or select the CALL-E API key at https://dashboard.heycall-e.com/account/api-keys. Consult the official [CALL-E API Reference](https://test-docs.heycall-e.com/api-reference) when validating the provider request or response contract. Enter the key only through hidden local terminal input. Never paste it into Agent chat.

Use a configured standard-account alias and verify it before any deployment. The installer resolves the alias through the HubSpot CLI and refuses an unknown or mismatched account before changing local workflow metadata, secrets, or the remote project.

```bash
hs account auth
hs account list
hs account info <configured-standard-account>
```

From the repository checkout, use hidden shell prompts for the CALL-E key and the HubSpot App Client Secret. Find the latter at `Development -> Projects -> hubspot-calle -> CALL-E for HubSpot -> Auth`. Do not place either value in Agent chat or command history.

```bash
cd plugins/hubspot-calle
read -r -s CALL_E_API_KEY
export CALL_E_API_KEY
read -r -s HUBSPOT_CLIENT_SECRET
export HUBSPOT_CLIENT_SECRET
node scripts/install-direct-call.mjs \
  --account <configured-standard-account> \
  --endpoint-host <hubspot-account-id>.hs-sites.com \
  --set-secrets-from-env
unset CALL_E_API_KEY HUBSPOT_CLIENT_SECRET
```

`CALL_E_BASE_URL` defaults to and accepts only the exact origin `https://api.heycall-e.com`, with no alternate host, path, credentials, query, or fragment. `--endpoint-host` expands to `https://<hubspot-account-id>.hs-sites.com/hs/serverless/calle/create-call`; use `--endpoint-url` only when supplying that complete HTTPS URL.

### What The Installer Does

After it validates the local Node.js and HubSpot CLI versions, the requested account, and the preflight secret state, the installer writes the target account's public workflow endpoint into the local workflow-action metadata, optionally adds or updates HubSpot secrets, builds, validates, uploads, and checks static app installation status.

When `--set-secrets-from-env` is used, the installer stores four server-side values: `CALL_E_API_KEY`, fixed `CALL_E_BASE_URL`, `HUBSPOT_CLIENT_SECRET`, and the exact `HUBSPOT_WORKFLOW_ACTION_URL` derived from the endpoint option. No credential is configured in the workflow action itself. The public function validates the HubSpot v3 signature and five-minute request timestamp before it reads the action input or calls CALL-E.

Without `--set-secrets-from-env`, the installer checks that all four HubSpot secrets already exist and fails before mutation when any are missing. `--skip-secrets` is the explicit bypass: it neither checks nor writes secrets and is appropriate only when an administrator has independently verified the deployed secrets.

### Completion States And Recovery

The installer reports one of these final states:

| State | Meaning | Required administrator action |
| --- | --- | --- |
| `installed` | The project uploaded and the static app is installed with current scopes. | Continue with workflow and App Card configuration. |
| `reinstall_required` | The project uploaded, but the installed app does not have current scopes. | In the project app `Distribution` tab, reinstall the standard app, then refresh the relevant CRM customization view. |
| `manual_install_required` | The project uploaded, but the static app is not installed. | In the project app `Distribution` tab, perform the standard installation. |
| `upload_skipped` | `--skip-upload` or `--dry-run` prevented an upload. | Remote setup is incomplete. Run the normal installer command without that option when ready. |

For an interrupted run, a HubSpot App Client Secret rotation, or an account-specific endpoint change, rerun the normal command after correcting the cause:

```bash
cd plugins/hubspot-calle
read -r -s CALL_E_API_KEY
export CALL_E_API_KEY
read -r -s HUBSPOT_CLIENT_SECRET
export HUBSPOT_CLIENT_SECRET
node scripts/install-direct-call.mjs \
  --account <configured-standard-account> \
  --endpoint-host <hubspot-account-id>.hs-sites.com \
  --set-secrets-from-env
unset CALL_E_API_KEY HUBSPOT_CLIENT_SECRET
```

The endpoint value in `hubspot-project/src/app/workflow-actions/create-call-candidate-hsmeta.json` is local, account-specific deployment metadata. Rerunning for a different customer account deliberately replaces it before that customer's upload; do not reuse an uploaded project or metadata file as a cross-account installation mechanism.

## Administrator: Install The Static App

After upload, open `Development -> Projects`, open `hubspot-calle`, select the `CALL-E for HubSpot` app component, then open `Distribution`.

For the customer standard account, use `Standard install` to install or reinstall the app. Use reinstall when the installer reports `reinstall_required` or after scope changes. A standard install is sufficient for the App Cards to be available in the CRM Card library.

Developer test installs are optional and are not a prerequisite for the standard install or its App Cards. The project owner manages them under `Distribution -> Test installs` and may add up to ten developer test accounts.

## Administrator: Configure App Cards

The project exposes two Contact App Cards:

| Card | Location | Purpose |
| --- | --- | --- |
| `CALL-E` | Middle column | Record-tab call action. |
| `CALL-E Quick Call` | Right sidebar | Faster record-page call action. |

To place either card, open a Contact record, select `Customize`, choose the target record view, add a card in the appropriate column, then open `Card library -> App`. Search for `CALL-E` or these UIDs:

- `calle_call_candidate_card` for the middle-column card.
- `calle_call_candidate_sidebar_card` for the sidebar card.

Save the record layout. If a card is absent, confirm that the latest project build was uploaded and that the standard app installation was completed or refreshed, then reopen the Card library. Do not use the `Create card` tab; it is for HubSpot-native custom cards.

## Administrator: Configure A Safe Workflow

For the first test, create a Contact-based workflow with `Manually triggered only` enrollment and select `CALL-E for HubSpot -> Create CALL-E Call`. Use one authorized test record with an E.164 phone value.

Map the record ID and phone input from the enrolled record. Set the static `Phone contact allowed` field to `Yes` and `Do not call` to `No` only for a workflow whose enrollment rules prove those facts. The workflow action has no credential input; its public serverless endpoint verifies HubSpot's signed request server-side.

The workflow action can enroll Contacts or Deals. For a Deal workflow, map an administrator-defined Deal phone property into `Phone number`; the Contact App Cards do not appear on Deals because HubSpot has no portable default Deal phone property.

The handler requires explicit `Yes` consent and explicit `No` do-not-call values. Missing, malformed, or opposite values create no CALL-E request. These fields are static action configuration and do not dynamically inspect a record's CRM consent or do-not-call fields. Enrollment filters must exclude every record that is not approved for phone contact or is marked do-not-call. A production enrollment rule should include, at minimum, a known E.164-capable phone field, the organization's consent condition, and an explicit exclusion for do-not-call records.

Turn on the workflow only after reviewing its enrollment conditions, then manually enroll one authorized test record. The expected action output includes a CALL-E `call_id`, an initial status such as `queued`, `[phone]` in `masked_phone`, and no raw secret values. Every CALL-E task begins with a fixed instruction that cannot be overridden by the configured task: it prohibits medical, legal, financial, or emergency advice and limits those topics to logistics or routing to an appropriate human or emergency service.

## Ordinary Users: Start An Approved Call

Ordinary sales and operations users do not deploy the app, manage secrets, or configure the workflow endpoint. They use one of these administrator-approved paths:

1. Manually enroll an eligible record in an already-configured workflow.
2. Open an eligible Contact with an E.164 phone number, review the call task in the `CALL-E` or `CALL-E Quick Call` card, and select `Start CALL-E Call` followed by the confirmation control.

The Card supports HubSpot Contact (`0-1`) records only. It requests both standard Contact fields through HubSpot's private-function `propertiesToSend` contract, uses only the selected `phone` or `mobilephone` value, and uses the server-provided account ID. It does not send or trust a parameter phone value, fetch a CRM record by a client-supplied ID, or expose the CALL-E API key. If the selected property has no valid E.164 phone, it reports a safe `missing_phone` or `invalid_phone` result without creating a CALL-E task. A network, response-read, response-parse, `429`, or retryable CALL-E provider failure keeps the same Card request ID and confirmation for an explicit retry; success, deterministic rejection, and cancellation clear the intent.

The integration trims the validated E.164 value before sending it and does not force a region or locale. CALL-E uses the number and provider defaults for routing and language inference.

## Consent, Cancellation, And Rollback

The confirmation `Cancel` control on an App Card only stops that pending Card submission. It cannot cancel a CALL-E call once CALL-E has accepted it. Disabling HubSpot workflows, rotating/removing `CALL_E_API_KEY`, or rotating the HubSpot App Client Secret blocks new calls only. For an already accepted queued or running call, administrators must use CALL-E-supported dashboard or API controls; this integration does not define a cancellation API endpoint.

To stop new calls and roll back the HubSpot integration:

1. Turn off workflows that use `Create CALL-E Call` and remove the action from active workflows.
2. Rotate or remove `CALL_E_API_KEY` to block new CALL-E task creation.
3. Rotate the HubSpot App Client Secret, update `HUBSPOT_CLIENT_SECRET` through the installer, and redeploy before re-enabling a workflow.
4. Remove the App Cards from record layouts or uninstall the static app if the integration must no longer be available.

Rotating secrets or disabling workflows does not cancel accepted CALL-E calls. Use CALL-E-supported controls for those calls.

## Troubleshooting

| Symptom | Administrator check |
| --- | --- |
| Installer rejects the account | Run `hs account list` and `hs account info <configured-standard-account>`; use a configured alias or matching account ID. |
| Installer reports missing secrets | Use `--set-secrets-from-env` with the hidden-prompt API key, or add all required secrets before a normal rerun. Use `--skip-secrets` only when their remote values are already verified. |
| Workflow action is unavailable | Confirm the project upload, standard app installation, and Content Hub Enterprise public-endpoint prerequisite. |
| App Card is absent | Confirm the current standard installation, then reopen `Customize -> Card library -> App` and search by card UID. A developer test install is not required for a standard account. |
| Action is unauthorized | Confirm the HubSpot App Client Secret and exact workflow action URL are stored through the installer, then redeploy. Verify the incoming request has a current v3 signature. |
| Duplicate call tasks | Review workflow re-enrollment and use the stable workflow-run idempotency behavior. |
| CALL-E status is missing from CRM reporting | This low-permission mode does not write status to CRM fields; review CALL-E through supported CALL-E tooling. |
