# @call-e/n8n-nodes-calle

This package provides an n8n community node for CALL-E AI-agent phone-call workflows. It lets n8n workflows create CALL-E call tasks, fetch their status, wait for completion, and read developer events.

[n8n](https://n8n.io/) is a workflow automation platform. [CALL-E](https://www.heycall-e.com/) provides a Developer API for server-side AI-agent phone-call tasks.

## Installation

Install this package as an n8n community node:

```bash
npm install @call-e/n8n-nodes-calle
```

For local development, run:

```bash
npm install
npm run build
npm run dev
```

The development server starts n8n with the CALL-E node linked into the local custom nodes directory.

## Credentials

Create a `CALL-E API` credential in n8n with:

- `API Key`: Your CALL-E API key. The value is stored as a password field.
- `Base URL`: Defaults to `https://api.heycall-e.com`.
- `Request Timeout (MS)`: Timeout for each individual CALL-E API request.

Do not expose CALL-E API keys in browser code, workflow logs, screenshots, or issue reports.

## Operations

The first release focuses on the `Call` resource:

- `Create`: Creates a CALL-E call task.
- `Get`: Gets one CALL-E call task by ID.
- `Create and Wait`: Creates a call task, then polls until the task reaches `completed`, `failed`, or `canceled`.
- `List Events`: Lists developer events for one call task.

`Cancel` is not included in this release because the current CALL-E Developer API and server SDKs do not expose a cancel call task API.

## Call Parameters

`Create` and `Create and Wait` support:

- `Phone Number`: Required E.164 number, for example `+14155550100`.
- `Task`: Required phone agent task boundary and expected outcome.
- `Idempotency Key`: Required. The default expression is based on the n8n execution ID and item index; override it with a business key when you need duplicate prevention across workflow retries.
- `Locale`: Optional language and locale hint, for example `en-US`.
- `Region`: Optional routing or country/region hint, for example `US`.
- `Metadata`: Optional JSON object returned with the call task for business-system correlation.
- `Result Schema`: Optional JSON object schema for task-level structured output.
- `Recipient Result Schema`: Optional JSON object schema for recipient-level structured output.
- `Webhook URL`: Optional callback URL for terminal CALL-E events.

`Create and Wait` also supports:

- `Polling Interval (MS)`: How often n8n polls CALL-E for the current call status.
- `Timeout (MS)`: Maximum total wait time before the node fails.

## Outputs

The node returns the raw CALL-E API response for the selected operation:

- `Create` returns the created call task.
- `Get` returns the current call task.
- `Create and Wait` returns the final call task after a terminal status.
- `List Events` returns the CALL-E events response.

If n8n `Continue On Fail` is enabled, the node returns an item with an `error` field instead of stopping the workflow.

## Safety

Phone calls are real-world side effects. Use this node only when the workflow has explicit user intent to place the call.

Operational safeguards:

- Use E.164 phone numbers.
- Use stable idempotency keys to prevent duplicate call tasks.
- Keep API keys in n8n credentials only.
- Avoid logging full phone numbers or secrets in workflow outputs.
- For recurring reminders, let the n8n workflow or host scheduler manage recurrence. CALL-E should handle one call task per scheduled workflow run.
- Keep workflows inactive until credentials, recipient numbers, task wording, and test paths are reviewed.
- Stop a running n8n execution from the n8n execution view if a call workflow needs cancellation.
- Do not use this node for emergency, medical, legal, or financial advice workflows without an appropriate human-reviewed safety process.

`Create and Wait` has a node-level timeout. If the timeout expires, the n8n execution fails or returns an error item when `Continue On Fail` is enabled. A timeout does not guarantee that the provider-side call has been canceled; check CALL-E for the latest call status.

## Compatibility

This package is intended for current n8n community node development flows using `@n8n/node-cli`.

## Release From This Monorepo

This package is published from the repository root through `.github/workflows/publish-n8n-nodes-calle.yml`.

To publish `0.1.0`, make sure `plugins/n8n-nodes-calle/package.json` has `"version": "0.1.0"`, then push this tag:

```bash
git tag call-e-n8n-nodes-calle-v0.1.0
git push origin call-e-n8n-nodes-calle-v0.1.0
```

The workflow validates that the tag version matches `package.json`, runs lint, tests, build, and publishes with npm provenance.

For npm Trusted Publishing, configure npm with:

- Repository owner: `CALLE-AI`
- Repository name: `awesome-phone-call-agents`
- Workflow filename: `publish-n8n-nodes-calle.yml`
- Environment: leave blank unless the workflow is later changed to use one

If Trusted Publishing is not configured, add an npm automation token as the GitHub Actions secret `NPM_TOKEN`.

## Resources

- [CALL-E Developer Docs](https://docs.heycall-e.com/)
- [CALL-E API Reference](https://docs.heycall-e.com/#/api-reference)
- [CALL-E SDKs](https://docs.heycall-e.com/#/sdks)
- [n8n community nodes documentation](https://docs.n8n.io/integrations/community-nodes/)
