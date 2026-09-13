# Administrator Agent Prompt Design

## Goal

Provide a copyable prompt that lets a HubSpot administrator delegate the
repeatable deployment work for the private CALL-E static app to a local coding
agent while retaining control over credentials, permission grants, uploads,
record-layout changes, workflow activation, and real phone calls.

## Documentation Structure

- Add the copyable prompt in `docs/admin-agent-prompt.md`.
- Link it from the plugin README and the authoritative direct-call user manual.
- Keep manual installation instructions authoritative. The prompt must direct
  the agent to read those instructions instead of duplicating implementation
  details that can drift.

## Execution Model

The prompt defines a staged administrator workflow:

1. Inspect the repository, current branch, documentation, tool versions, Git
   state, target HubSpot account, and required inputs without changing local or
   remote state.
2. Collect non-secret deployment inputs one at a time. Credentials must be
   entered through a hidden local terminal prompt and must never be pasted into
   chat, command arguments, logs, summaries, or repository files.
   When the administrator does not already have a CALL-E API key, direct them
   to `https://dashboard.heycall-e.com/account/api-keys` to sign in and create
   or select a key. The prompt and manual must not ask the administrator to
   paste that key into chat; the next step is the local hidden terminal input.
3. Present the exact intended account, endpoint host, installer command, and
   expected mutations. Require explicit administrator approval before writing
   account-specific metadata, changing HubSpot secrets, or uploading.
4. Run the repository installer and interpret its documented completion state.
5. Help complete Standard install and App Card placement through browser
   automation when available, or provide the exact manual path otherwise.
   Require approval immediately before permission grants or saved remote UI
   changes.
6. Treat workflow setup as optional. Never enable a workflow without verified
   consent and do-not-call enrollment filters and explicit approval.
7. Stop before any real CALL-E request by default. A live smoke test requires a
   separate confirmation of the authorized E.164 destination, call task, and
   real-world side effect.
8. Produce a masked completion report and rollback instructions.

## Safety Boundaries

The agent must:

- verify Node.js and HubSpot CLI prerequisites before deployment;
- resolve and restate the exact target HubSpot account before mutation;
- use only `https://api.heycall-e.com` through the existing installer;
- never expose `CALL_E_API_KEY` or `HUBSPOT_CLIENT_SECRET`;
- require HubSpot v3 request-signature validation to remain server-side, with no reusable workflow credential field;
- use the HTTPS CALL-E Dashboard API-key page rather than its redirecting HTTP
  form;
- never commit or push account-specific endpoint metadata;
- never create unsupported CRM properties or writeback behavior;
- never create hidden recurring workflows or duplicate call jobs;
- require E.164 numbers and explicit phone-contact authorization;
- preserve the documented medical, legal, financial, and emergency boundary;
- distinguish preventing new calls from cancelling calls already accepted by
  CALL-E.

## Completion Contract

The agent reports:

- target account alias and masked account ID;
- local prerequisite checks;
- installer completion state;
- Standard install and App Card configuration status;
- optional workflow status;
- tests and validations run;
- remaining manual steps and rollback controls.

The report must not include secrets, raw phone numbers, or full sensitive
command output.

## Validation

After implementation, run `python3 scripts/validate_repository.py`, check all
new relative Markdown links, and run `git diff --check`. No live upload, API
request, secret mutation, UI mutation, or phone call is required to validate
this documentation change.
