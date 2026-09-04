# E-mploye for CALL-E

E-mploye is one configurable virtual employee for everyday business calls. It uses CALL-E to turn conversations into structured, reviewable actions while keeping a human responsible for every commitment.

The prototype ships with three task templates using the same virtual employee and the same safety-first execution engine:

- **Appointment desk** for service businesses: confirm or reschedule a customer appointment.
- **Lead follow-up** for sales teams: agree a qualified follow-up time with a prospect.
- **Shift coordination** for operations teams: confirm or renegotiate a team member's availability.

The public demo offers three guided scenarios. All templates share the same preview → approval → call → evidence → human decision flow.

## Safety-first behavior

- Fake mode is the default and places no real calls.
- A manager must create and authorize each call explicitly.
- Phone numbers are validated as E.164 and masked in the UI and event log.
- The CALL-E API key is server-only.
- Stable idempotency keys prevent duplicate provider calls during retries.
- Unknown, declined, failed, and incomplete results remain visible for human review.
- No appointment, follow-up, or shift change is applied automatically.
- There are no hidden recurring calls.

## Run locally

Requirements: Node.js 22+.

```bash
npm install
copy .env.example .env
npm run dev
```

Open <http://localhost:5173>. The API runs on port 8787 and the Vite dashboard on port 5173.

The default fake scenario can simulate confirmed, reschedule-requested, declined, unknown, and failed calls across all three task templates. Use **Reset demo** to return to the initial state, or choose any of the three prepared scenarios from the dashboard.

## Public demo

The fake-only Vercel deployment is available at <https://e-mploye-for-calle.vercel.app>.

It never places real calls and keeps demo state in the serverless instance's temporary storage, so a cold start can restore the seeded demo data. Live CALL-E credentials are not configured in the public deployment.

See [docs/DEMO_RUNBOOK.md](docs/DEMO_RUNBOOK.md) for the complete judging flow and video checklist.
See [docs/VIDEO_SCRIPT.md](docs/VIDEO_SCRIPT.md) for a timed recording script with the exact UI actions and narration.
See [docs/LIVE_CALL_E_SETUP.md](docs/LIVE_CALL_E_SETUP.md) for the server-only live configuration, Docker/PowerShell setup, readiness contract, and troubleshooting.

## Live CALL-E mode

Live mode is opt-in and becomes active only when the server has the required flag, key, authorized E.164 phone, destination region, and locale. The dashboard exposes readiness without ever returning the secret value to the browser. Live mode starts with no seeded contacts: the operator must load one explicit contact and one scheduled context before previewing a call.

```text
CALLE_API_KEY=your_server_side_key
CALLE_LIVE_ENABLED=true
CALLE_BASE_URL=https://api.heycall-e.com
CALLE_TEST_PHONE=+15551234567
CALLE_TEST_REGION=US
CALLE_TEST_LOCALE=en-US
CALLE_DEFAULT_LANGUAGE=en-US
CALLE_DEFAULT_REGION=MX
```

Never put `CALLE_API_KEY` or `CALLE_TEST_PHONE` in frontend variables or commit them. Before a live run, set one controlled E.164 test number through these server-only variables, verify the destination region and locale, and keep the manager approval step enabled. The public Vercel deployment overrides these values and stays fake-only. If any required piece is missing, the server safely falls back to the fake provider instead of claiming to be live.

The test number must belong to a CALL-E-supported recipient region and the region/locale must match. Argentina (`AR`) is not currently listed. The published integration guide says that international destinations use CALL-E's international phone lines and are primarily intended for testing; buying a phone number in the dashboard is not documented as a prerequisite for the one-shot Calls API. See the [CALL-E integrations guide](https://github.com/CALLE-AI/call-e-integrations#-supported-regions-and-languages) before attempting a live call.

The live provider uses the official TypeScript server SDK `@call-e/calle` to create an asynchronous CALL-E task and read status, structured evidence, transcripts, and developer events. The SDK maps the documented `POST /v1/calls`, `GET /v1/calls/{call_id}`, and events contracts while preserving the stable idempotency key. Provider cancellation is not claimed because the current SDK/API contract does not expose a cancellation operation. The provider tests use mocked HTTP `201`/`200` responses to verify the SDK contract without placing a call.

## Tests and build

```bash
npm test
npm run test:calle
npm run typecheck
npm run lint
npm run build
npm run test:public
```

`npm run test:calle` is a no-call smoke test for the official `@call-e/calle` adapter. It verifies the documented create (`201`), call status (`200`), and developer-events (`200`) contracts, authentication, idempotency, structured results, and transcript mapping with a local HTTP fixture. It never contacts a phone or spends CALL-E credits. See [docs/CALLE_SMOKE_TEST.md](docs/CALLE_SMOKE_TEST.md) for the recorded evidence and its limitations.

## Product model

E-mploye is intentionally one role, not a collection of separate agents:

```text
E-mploye · one virtual employee
    ├── Appointment desk
    ├── Lead follow-up
    └── Shift coordination
```

Each template supplies the business context, recipient language, task instruction, result interpretation, and final action. Calls, approvals, persistence, idempotency, evidence, retries, and cancellation remain shared capabilities.

## Architecture

```text
React dashboard
    ↓ choose task / preview / approve / refresh / apply
Node API
    ↓
CallWorkflow + JsonStateStore
    ├── FakeCallProvider (default)
    └── CalleApiProvider → @call-e/calle (explicit live mode)
```

The application stores recipients, scheduled context records, task type, call jobs, provider status, structured result, evidence, transcript, approvals, and event history in a local JSON snapshot for the prototype.

## Official contribution

The intended community contribution is a runnable TypeScript app under `apps/typescript/e-mploye-for-calle/` in [Awesome Phone Call Agents](https://github.com/CALLE-AI/awesome-phone-call-agents). Repository-facing material will remain in English and the official validation script will be run before opening a pull request.

## Provenance and limitations

E-mploye is a new application created for the CALL-E hackathon. It reuses selected author-owned ideas from an earlier prototype for persistence, safety, and interface foundations, but it is not a submission of that previous application. The single virtual employee concept, task catalog, CALL-E integration, phone workflow, status and result handling, safety boundaries, tests, documentation, and deployment were built for E-mploye.

This prototype intentionally keeps the business surface bounded: it demonstrates three repeatable workflows without pretending to be a full CRM, calendar, payroll, or workforce management system. Calendar/CRM adapters, recurring campaigns, multi-recipient escalation, reminders, and production integrations are future work.
