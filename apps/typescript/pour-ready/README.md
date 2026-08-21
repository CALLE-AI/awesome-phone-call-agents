# PourReady

> Before the trucks roll, make sure every party is working from the same plan.

PourReady is a human-controlled pre-pour coordination gate for concrete
operations. It asks CALL-E to call the site supervisor, ready-mix dispatcher,
pump operator, and testing coordinator, then reconciles their explicit answers
into `ALIGNED`, `CONFLICT`, or `INCOMPLETE`.

The included golden demo is a fictional Singapore pour. Three roles confirm
06:30; the pump operator reports 08:00. PourReady explains the contradiction,
opens the supporting evidence, and leaves `Proceed` or `Hold` to the human.

## Safety boundaries

- CALL-E identifies itself as an automated coordination assistant and verifies
  the intended contact.
- It reports existing facts only. It cannot change or cancel an order, approve
  safety or engineering, make a financial commitment, or decide go/no-go.
- A wrong contact, voicemail, failed call, missing result, unknown answer, or
  confidence below `high` is `INCOMPLETE`; the app never guesses.
- Live calls are disabled by default and require both a server flag and an
  explicit UI authorization for four owned or authorized E.164 numbers.
- CALL-E calls are asynchronous. After submission, this client has no in-flight
  cancellation control. It polls the Calls API and makes no automatic retries.
- PourReady does not replace supervisors, engineers, inspectors, SWMS
  processes, testing requirements, or safety approvals.

## Run the no-call demo

Requirements: Node.js 22 or newer.

```bash
cd apps/typescript/pour-ready
npm install --legacy-peer-deps
npm run dev
```

Open `http://localhost:3000`, keep **Dry-run** selected, preview the four
role-specific plans, and run the golden demo. No credential is read and no call
is placed.

The legacy peer flag works around an npm 10 dependency-tree bug observed while
installing this pinned dependency set; it does not change runtime behavior.

## Enable authorized live calls locally

1. Copy `.env.example` to `.env.local`.
2. Set `CALLE_API_KEY` to your server-side CALL-E API key.
3. Set `ENABLE_LIVE_CALLS=true`.
4. Restart the development server.
5. Enter exactly four owned or authorized AU (`+61`) or SG (`+65`) numbers in
   E.164 format, inspect every preview, and tick the authorization checkbox.

Never prefix either variable with `NEXT_PUBLIC_`. They are read only in server
route handlers and are never returned to the browser. Keep
`ENABLE_LIVE_CALLS=false` in public deployments.

## Runtime design

`POST /api/runs` validates the plan, AU/SG locale, exactly four unique roles,
region-matching E.164 numbers, and explicit live confirmation. It creates four
independent calls using `@call-e/calle@0.2.2` and stable idempotency keys:

```text
pour-ready:<run-id>:<role>
```

Partial dispatch failures are returned beside successful, recoverable call IDs.
`GET /api/calls/:callId?runId=...` checks caller-owned run metadata, then returns
only the lifecycle state, strict structured result, confidence, redacted
evidence, redacted transcript turns, and masked destination. Raw tasks,
unmasked recipients, provider messages, and credentials are not exposed.

The browser stores only the sanitized pour plan, public call IDs, masked call
snapshots, and the timestamped human decision in `sessionStorage`. It never
persists phone numbers.

No webhooks, database, scheduler, external AI provider, authentication,
multi-project history, messages, integrations, recurring calls, automated
retries, or client cancellation are included.

## Result contract

Every field is required and additional properties are rejected:

```ts
type CoordinationResult = {
  contact_outcome:
    | "reached"
    | "voicemail"
    | "wrong_contact"
    | "no_answer"
    | "unknown";
  commitment: "confirmed" | "conditional" | "declined" | "unknown";
  schedule_alignment: "matched" | "conflict" | "unknown";
  scope_alignment: "matched" | "conflict" | "not_applicable" | "unknown";
  reported_time: string;
  blocker: string;
  evidence_summary: string;
};
```

## Verification

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

The tests cover aligned and conflicting results, conditional commitments, null
results, voicemail, failed calls, low confidence, conflict-plus-pending state,
input rejection, deterministic retry keys, live-disabled behavior, partial
dispatch failure, masking, transcript redaction, and credential-free fixtures.

For the repository-wide check, run this from the repository root:

```bash
python scripts/validate_repository.py
```

## Deployment

Deploy `apps/typescript/pour-ready` as the project root of a standalone Next.js
application. The public judging build should omit `CALLE_API_KEY` and keep
`ENABLE_LIVE_CALLS=false`; use a controlled local setup for an authorized
live-call recording.

See [demo-script.md](docs/demo-script.md),
[market-validation.md](docs/market-validation.md), and
[feedback-template.md](docs/feedback-template.md).

CALL-E reference: [Calls API](https://docs.heycall-e.com/calls).
