# HubSpot CALL-E Integration

This directory contains a private, static HubSpot Projects app for creating CALL-E call tasks from HubSpot workflows or CRM record App Cards. The low-permission implementation reads CRM records but does not create HubSpot properties, custom objects, tasks, notes, or CALL-E status writebacks.

## Deployment Model

This is not a HubSpot Marketplace package and has no external backend or shared installation link. One source checkout deploys an independent static app copy for each customer standard account. A shared installation link for multiple accounts would require OAuth and is out of scope.

The workflow action uses a public HubSpot serverless endpoint. That endpoint requires Content Hub Enterprise. Each deployment writes account-specific endpoint metadata into the local project before upload, so rerun the installer for the target account rather than copying metadata between customers.

## Installation And Use

Administrators deploy the project, manage HubSpot secrets, install or reinstall the static app, add App Cards to record layouts, and configure workflows. Sales and operations users use a configured App Card or manually enroll an already-approved record; they do not handle `CALLE_WORKFLOW_ENDPOINT_TOKEN` or the CALL-E API key.

The [CALL-E for HubSpot Direct-Call User Manual](docs/direct-call-user-manual.md) is the authoritative installation, administrator, and user guide. See [setup.md](docs/setup.md) for a concise deployment and local-verification reference.

## Entry Points

- Custom workflow action: `CALL-E for HubSpot -> Create CALL-E Call`.
- `CALL-E` middle-column App Card for Contact and Deal records.
- `CALL-E Quick Call` right-sidebar App Card for Contact and Deal records.
- `scripts/install-direct-call.mjs` installer for endpoint configuration, secret handling, validation, upload, and install-state reporting.

The App Cards map HubSpot `crm.objectTypeId` values `0-1` and `0-3` to Contact and Deal, let the user select only `phone` or `mobilephone`, and require an explicit confirmation click. They pass only the selected field through HubSpot's private-function `propertiesToSend` contract; the function uses `accountId` without fetching a client-supplied CRM object or trusting a parameter phone value. Each confirmation intent gets a new request ID; an ambiguous transport retry keeps that ID so CALL-E receives the same idempotency key. The Cards do not expose the CALL-E API key to the browser.

## Workflow Inputs And Outputs

The action receives the source object type and ID, an E.164 phone value and property name, a call task, static consent and do-not-call selections, and an administrator-configured endpoint token. It returns `call_id`, `status`, `masked_phone`, and `error`.

The workflow handler creates a call only when `Phone contact allowed` is explicitly `Yes` and `Do not call` is explicitly `No`; missing, malformed, or opposite values fail closed. These static action selections do not inspect each enrolled record, so administrators must also enforce consent and do-not-call conditions in workflow enrollment filters.

## Safety And Cancellation

- Require explicit user or workflow intent before creating a call task.
- Use authorized E.164 phone numbers and mask numbers in user-facing output.
- Use the stable idempotency key to avoid duplicate calls for a workflow run.
- Do not create hidden recurring schedules.
- Every CALL-E task starts with a fixed, non-overridable instruction that prohibits medical, legal, financial, and emergency advice and limits those topics to logistics or routing to an appropriate human or emergency service.
- Canceling the App Card confirmation prevents that submission only. After CALL-E accepts a call, use CALL-E-supported dashboard or API controls for queued or running calls; disabling workflows or rotating secrets prevents new calls only.

## Files

- `hubspot-project/` - HubSpot Projects static app and serverless functions.
- `scripts/install-direct-call.mjs` - account-aware installer helper.
- `docs/direct-call-user-manual.md` - authoritative administrator and ordinary-user guide.
- `docs/setup.md` - deployment, recovery, rollback, and local-verification reference.
