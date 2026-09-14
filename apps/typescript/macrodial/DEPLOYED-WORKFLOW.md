# Deployed MacroDial workflow

The product is at **https://macrodial.ra-fi.com**. Public visitors can review the non-sensitive demo experience. Privileged actions and sensitive customer views require the operator-provided demo PIN; no PIN is distributed with this contribution. A reviewer does not need access to privileged data to run the local reference.

## Describe, review, apply

Setup Wizard Step 1 opens **Tell MacroDial about your business**. For example:

> Fictional Veterinary Clinic provides wellness examinations, vaccinations and dental consultations. Track pet name, species and vaccination due date. Ask customers whether they want staff follow-up. Do not diagnose, prescribe, book a visit or promise prices. Escalate clinical questions to staff.

Select **Generate Configuration**. Auto Config uses OpenAI to propose the business profile, services, essential custom fields, workflows/playbooks, outcomes/states and safety boundaries. Its review is human-readable; technical details remain available under Advanced.

Generation does not apply configuration. Review **Will Create / Will Reuse / Will Update / Will Replace / Will Rebind**, then explicitly approve Apply. Activate the intended playbook and reload to check persistence. Do not overwrite shared accepted configuration to rehearse; use an operator-managed isolated test configuration. Custom fields are bounded, not arbitrary schema generation; trigger suggestions are not automatically installed or activated.

## Upload, understand, preview, import

Smart Data Loader accepts XLSX worksheets and normal Excel string encodings. Select the worksheet/header when needed. Obvious aliases map deterministically; unresolved fields use OpenAI semantic mapping with confidence and representative values. Required ambiguities require targeted operator review; the full mapping matrix is Advanced, not the normal task.

The hosted shuffled-workbook acceptance is **author-reported, not independently verified by this repository**: 10 fictional rows, 14/14 fields automatically mapped (8 deterministic and 6 live semantic), without manual mapping or critical ambiguity. This is one acceptance workbook, not a universal mapping guarantee.

Preview validates phone normalization, real dates/times, explicit IANA timezone, and within-file/existing-record duplicates. Customer data can enter Client List and valid appointments can enter Appointment List **without a playbook**. Import defaults to data only; it does not schedule outreach. Optional outreach requires compatible playbook/call-code binding and an explicit schedule.

On the repeated acceptance preview, 10 existing-client updates and 10 duplicate appointments were detected, with **10 warnings and 0 errors**. The row warning was “This appointment and outreach schedule already exist.” No new appointments were planned and outreach was not scheduled. That preview was not re-imported merely to collect evidence.

Import journals preserve row outcomes and retry protection. Partial failures remain visible; ambiguous external write responses require reconciliation instead of a blind second create. Preview counts are plans, not evidence that writes succeeded.

## CALL-E at runtime

The full deployed service, not this local reference, performs this flow:

1. Resolve the authorized customer from the existing master record. Require an active playbook with matching workflow code and version, complete dialogue policy, explicit authority and outcome mappings.
2. Compile the business-aware task and strict `result_schema`. The returned outcome is constrained to the playbook's allowed outcomes. The model does not choose arbitrary state writes.
3. The server submits one asynchronous `POST /v1/calls` to the configured CALL-E API with server-side Bearer authentication, explicit authorized recipients, task, schema and correlation metadata. A stable `Idempotency-Key` identifies the intended operation.
4. Retrieve the call through MacroDial's authenticated `/api/outreach/calls/{call_id}` route. It refreshes provider status and can persist results; despite using GET, it is not a side-effect-free database read.
5. Require a usable structured result, validate its allowed outcome and configured target state, then persist the bound outreach record's result/state and audit event. Provider completion alone is not a business success. Missing/invalid results must not be presented as validated outcomes.

CALL-E's current [call API documentation](https://docs.heycall-e.com/api-reference/calls) describes asynchronous creation, idempotency, status/result retrieval and events. MacroDial owns scheduling and state transitions; it does not rely on provider recurrence. Provider requests may incur charges and contact real people. An uncertain submission must be reconciled using the original intent before retrying; do not create a new intent to bypass duplicate protection.

The local contribution runs the same binding/compiler/resolver functions with a synthetic result and isolated file store. It does not implement the deployed transport, master-record adapter, import journal or audit database.

## Setup and server configuration

The local reference needs **no environment variables**. The table below documents the full deployment's server configuration; it is not a recipe for enabling live calls in this reference.

| Variable | Deployed purpose |
| --- | --- |
| `CALLE_API_KEY` | Secret server-side CALL-E credential; required for live provider requests |
| `CALLE_BASE_URL` | CALL-E API origin, normally `https://api.heycall-e.com`; never redirect credentials to an untrusted origin |
| `OPENAI_API_KEY` | Secret server-side credential for generation and semantic mapping |
| `OPENAI_MODEL` | Deployed generation/mapping model selection |
| `MACRODIAL_PIN_HASH` | Server-side PIN hash; missing/invalid authentication fails closed |
| `MACRODIAL_LIVE_CALLS_AUTHORIZED` | Server live-call gate; retain `0` except during a separately authorized controlled acceptance |
| `MACRODIAL_ONLY` | Standalone MacroDial runtime mode in the hosted installation |
| `LIGHTBRIDGE_PORT` | Hosted Node origin port; deployment-specific, not the reference app's port |

Secrets belong in private server configuration or a secret manager, not frontend code, committed files, screenshots or logs. The deployed app uses short-lived authenticated sessions and failed-attempt protection. OpenAI generation/mapping is a paid action even when no call is made. Operator-entered descriptions and representative workbook values can be sent to that provider; use fictional/non-sensitive data for demonstrations.

The full deployment also requires its installed customer/appointment adapter, writable persistent outreach state and import-journal storage. Those operational dependencies and data are intentionally excluded. Full production state and journals must survive restart; the reference's `.local` file is not a substitute. The hosted frontend/API use the same HTTPS origin; do not expose the loopback app as a bypass around authentication.

## Safety, disable and cancellation

Keep Outreach Engine **OFF** by default. The server live-call gate must also remain disabled outside explicitly authorized testing. Neither public access nor possession of a PIN authorizes a particular recipient or campaign. Review the destination privately, obtain permission, bind the correct active playbook and authorize each controlled test. Do not reuse a previously consumed one-call authorization.

To stop future automatic dispatch, turn the engine OFF and verify its state; retain the server gate at `0` and restart the deployed service if changing that gate. Do not enable the scheduler to demonstrate UI behavior. No hidden recurring schedule is needed for the demo.

Engine OFF does not cancel calls already accepted by CALL-E. Closing the page does not stop them. This integration does not claim a provider cancellation operation. If a call has been submitted, inspect its provider state and use supported provider assistance/controls where available; do not claim it was canceled without confirmation. No automatic redial is authorized by a timeout. Preserve legitimate history and reconcile uncertain calls before any further action.

Use separate clearly labeled TEST/UAT outreach for controlled tests. Do not rewrite customer master data or legitimate history to make a demo cleaner. Mask customer identity, destination, identifiers and private result text in presentation evidence. Do not publish recordings or transcripts.

## Acceptance and limits

Author-reported deployed acceptance includes veterinary generation with human review, isolated Apply → Activate → Reload, shuffled XLSX automatic mapping, and one separately authorized CALL-E test with a returned structured outcome and persisted test outreach-state transition. Calling was returned to OFF. Private customer/call evidence is not distributed here, and the fictional workbook preview should not be mistaken for a batch of live calls.

Repository tests independently reproduce only the included no-call reference boundary. They do not certify the hosted app, provider availability, universal workbook mapping, unattended deployment, clinical use or production scaling. No live verification is necessary to review this contribution. Any future live verification needs fresh explicit authorization and must end with engine OFF.
