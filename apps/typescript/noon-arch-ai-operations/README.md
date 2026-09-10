# Noon Arch AI Operations

A configurable Arabic-first operations assistant that prepares, confirms, and places real phone calls through CALL-E. The current workflows cover approval/payment follow-up, meeting scheduling, employee-document expiry reminders, and supplier quotation collection with confidential price negotiation.

The hosted application is private by default. Importing data, refreshing a connector, or writing a result back never places a call. A CALL-E credit can only be spent after one recipient is selected and a new one-time confirmation is approved.

## Credential-free no-call demo

Open `/demo` after starting the project. This bilingual judge/demo route is fully deterministic and needs no API key, token, database, or external account. It demonstrates:

1. choosing one of the four workflow types;
2. reviewing a fictional source record and masked recipient;
3. approving the exact disclosure, recipient, and objective;
4. replaying a representative structured CALL-E result; and
5. previewing the write-back that would be sent in live mode.

The route never calls `fetch`, contacts a phone number, writes to ClickUp, or reads production storage. Every screen labels it as a no-call replay. It exists so reviewers can evaluate the product flow while CALL-E access or a supported destination region is unavailable.

For local development, keep `CALLE_LIVE_CALLS_ENABLED=false`. Live calls are opt-in only and require an owner-provided CALL-E key plus an explicit in-product confirmation for each new call.

## What is configurable

- Organization and assistant names, CALL-E region, locale, and timezone.
- Contacts and all workflow subjects/items.
- ClickUp Workspace, Space, Folder/List source, and field mappings for each service.
- Automatic draft refresh when a configured service is selected; completed tasks are always excluded.
- Every non-empty standard and Custom Field is retained as task context, while a small mapping chooses the primary name/date/phone fields.
- Optional ClickUp result write-back. Normal services add a confirmed task comment; meeting scheduling can automatically update the agreed start/end time and status, then add the call summary.
- Manual operation without any external application.

The first-time setup guide separates required calling setup from optional data connectors. It shows saved configuration, CALL-E and ClickUp health, service mappings, and the manual-confirmation safety gate. Connector checks are read-only and never place a call.

## CALL-E balance and local usage

CALL-E's current public OpenAPI contract does not publish an account balance, credit, usage, or billing endpoint. The application therefore does not calculate or display a guessed remaining balance. It links to the authoritative CALL-E billing dashboard and separately counts every call accepted by CALL-E from this application across the full local call log. The two values are never presented as equivalent.

If CALL-E adds an official balance endpoint, the stable `providerBalance` response contract in `GET /api/calls` can be backed by that server-side endpoint without changing the sidebar UI.

No ClickUp Workspace/List IDs or company-specific field IDs are embedded in the application. Noon Arch values are editable defaults for this private deployment.

## ClickUp connection

This private single-company version uses a ClickUp Personal API Token. Create/copy one at **ClickUp avatar → Settings → Apps → API Token**, then enter it directly in **Settings and integrations** inside the deployed application. Do not paste the token into chat or commit it to Git.

The server validates the token against ClickUp, encrypts it with AES-GCM, and saves only the encrypted credential in D1. For a public multi-company release, use ClickUp's OAuth authorization-code flow; the stored `auth_mode` and provider boundary are designed for that upgrade.

After connecting:

1. Choose a service.
2. Choose Workspace → Space, then a List, an entire Folder, or the entire Space.
3. Map the source fields to the normalized workflow fields.
4. Preview and select tasks.
5. Import them into the request. This does not call anyone.
6. Keep automatic loading enabled if the service should refresh its draft whenever it is selected.
7. Optionally enable result write-back for that service. The result is added as a comment to every linked task.

For meeting scheduling, also map the status that means “needs scheduling,” the attendee/people field, the status after agreement, and the destination start/end fields. The connector compares each candidate against other active meetings for every attendee, visibly marks expired or overlapping times unavailable, and rechecks availability immediately before submitting a call. If CALL-E returns an agreed slot, the exact linked task can be updated automatically; no follow-up call is scheduled.

Client and employee services match imported records to the explicitly selected recipient by normalized phone number first and name second. Supplier quotation items are shared request materials, so they can load independently of the selected supplier. A mismatch never falls back to calling someone with another person's tasks.

## Connector architecture

Business systems are isolated from the phone-call boundary:

`provider discovery → saved binding → active-task refresh → recipient match → attendee availability check → draft import → manual call confirmation → optional result write-back`

`manual` and `clickup` are registered providers. Odoo, Google Calendar, Airtable, or another API can be added as another adapter using the shared types in `lib/integrations/contracts.ts`; CALL-E request construction and the confirmation gate remain unchanged. See `docs/integrations/architecture.md` and `docs/integrations/clickup-research.md`.

## Local setup

Requires Node.js `>=22.13.0`.

```powershell
npm install
Copy-Item .env.example .env.local
npm run dev
```

Set these server-only values in `.env.local`:

- `CALLE_API_KEY`
- `CALLE_BILLING_DASHBOARD_URL` if the account uses a different official billing URL
- `CALLE_LIVE_CALLS_ENABLED=false` while developing
- `INTEGRATION_ENCRYPTION_KEY` with at least 24 random characters
- `SINGLE_TENANT_MODE=true` for a private one-company deployment

Never put a ClickUp personal token in `.env.local`; each company connects from the application UI.

## Verification

```powershell
npx tsc --noEmit
npm run lint
npm run audit:public
npm test
```

The regression tests verify manual CALL-E confirmation, duplicate protection, honest provider-balance handling, guided read-only connector checks, connector isolation, absence of known operational IDs, attendee conflict filtering, exact-slot result mapping, credential encryption, and ClickUp write-back.

`npm run audit:public` fails if the public source contains a non-empty known secret assignment, a credential-shaped token, an unmasked Saudi mobile number, or a ClickUp workspace URL with an operational numeric ID. It reports only the file and rule name, never the matched value.

## Side effects, cancellation, and safe defaults

- The application starts with live calls disabled.
- The `/demo` route has no external side effects.
- The live call endpoint requires an E.164 number, an explicit boolean confirmation, and a unique one-time confirmation ID.
- A reserved confirmation prevents retries and double-clicks from creating another call.
- The application does not schedule automatic retries or follow-up calls.
- Expiry automation is a saved preference only; no scheduler is shipped or silently created.
- Disconnecting a connector stops future reads and write-backs. Existing call records remain an audit trail.
- ClickUp write-back is separately configurable and is never performed by the no-call demo.
- Credentials are entered only in server-rendered/private setup surfaces, encrypted before storage, and never returned by an API response.

## Optional live verification

Only an authorized tester should enable live mode. Use a consented number, confirm the account supports the destination region, set `CALLE_LIVE_CALLS_ENABLED=true` on the server, and approve exactly one call in the review screen. Immediately return the flag to `false` after the controlled test. The project remains fully inspectable without running this step.

## Data storage

Contacts, workflow templates, call records/results, app settings, connector bindings, and encrypted credentials are stored in the site's Cloudflare D1 database. Provider secrets are server-only and are never returned by the settings APIs.

Official references: [CALL-E API](https://docs.heycall-e.com/api-reference/calls), [CALL-E integrations](https://github.com/CALLE-AI/call-e-integrations), [ClickUp authentication](https://developer.clickup.com/docs/authentication), and [ClickUp API limits](https://developer.clickup.com/docs/rate-limits).
