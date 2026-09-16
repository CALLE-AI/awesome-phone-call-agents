# ReadyLine

ReadyLine is an event load-in readiness coordinator built for the CALL-E “Your Code Is Calling” challenge. It calls authorized event vendors, captures their plans as strict structured results, detects cross-vendor conflicts deterministically, and keeps every operational commitment behind human approval.

[Open the public ReadyLine demo](https://readyline-kappa.vercel.app/). The guided Demo mode is the recommended evaluation path and requires no account, credentials, phone number, or CALL-E credits.

## What the MVP demonstrates

- A safe simulated-demo path with reserved fictional numbers that uses no phone credits.
- A server-only live CALL-E path using `@call-e/calle`.
- Batch readiness calls with recipient-level structured results.
- Strict `HH:mm` parsing with no guessed times.
- Deterministic access, loading-dock, power, and deadline checks.
- A separate human-approved resolution call.
- Evidence-preserving `unknown` behavior when results are incomplete.

## Demo scenario

The venue opens at 09:30, has one loading dock, provides 32A, and must be ready by 11:00. Three simulated vendor calls reveal that Northstar AV arrives before access, overlaps catering on the dock, and requests 63A. A targeted follow-up asks whether AV can move its dock window and use a venue-approved 32A setup. The saved demo response resolves all three conflicts. Demo mode uses reserved, non-working `+1 202-555-01xx` numbers and never calls the live API.

## Local development

Requirements: Node.js 22.13 or later.

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

Demo mode is available without credentials. Live mode is intentionally fail-closed. Copy `.env.example` to `.env.local`, then configure:

- `CALLE_API_KEY`: a server API key from CALL-E.
- `CALLE_ALLOWED_NUMBERS`: the comma-separated E.164 test numbers this deployment may call.
- `READYLINE_OPERATOR_KEY`: a random deployment secret of at least 20 characters.
- `READYLINE_LIVE_ENABLED=true`: the final explicit live-calling switch.

The operator enters `READYLINE_OPERATOR_KEY` in the Live UI. It is kept only in React memory, is never placed in the client bundle or browser storage, and is distinct from the CALL-E API key. Never add a real number to the allowlist without that recipient's authorization.

The Live panel performs a safe deployment-readiness check before accepting a call start. It reports only whether live calling is available; it never exposes which credential or allowlist value is missing. A configuration containing only reserved fictional demo numbers remains unavailable for live calls.

## Verification

```bash
npm run test:unit
npm run build
npm test
npm run test:sites
```

## Safety boundaries

- Real calls require an explicit live-mode action and an authorization checkbox.
- The server rejects every number not present in `CALLE_ALLOWED_NUMBERS`.
- The server also rejects the reserved fictional demo range even if it is accidentally allowlisted.
- Live POST and status requests require a separate operator key; call starts are rate-limited per client address.
- Phone numbers are sent only to the server-side CALL-E route and are never persisted by the browser.
- A batch is rejected if two recipients normalize to the same phone number or reuse a vendor ID.
- The UI masks phone numbers after planning.
- The resolution call may ask whether a change is feasible; it may not spend, purchase, negotiate, or commit.
- A per-operation idempotency key is reused across network retries, but a later intentional run receives a new key.
- The call ID, event, stage, operation, and vendor IDs are stored in session storage so polling can resume after refresh; the operator key and phone numbers are not stored.
- Each live recipient is bound to its vendor with a server-keyed phone fingerprint. Polling verifies the exact call, event, stage, operation, completed task, returned phone, and vendor binding before accepting a result; response-array order is never used for attribution.
- Invalid or ambiguous structured results become `unknown` conflicts, and the overall plan is Ready only when every vendor is explicitly ready.
- ReadyLine creates one-shot calls only. It has no scheduler, background recurrence, or hidden follow-up job.
- ReadyLine is not intended for emergency response or medical, legal, or financial decisions.

## Side effects and cancellation

Demo mode has no external side effects. It replays saved fictional responses entirely in the browser and optionally downloads a local Markdown brief.

Live mode has one explicit side effect: after the operator selects Live, enters authorized E.164 recipients, supplies the deployment operator key, confirms consent, and clicks the final action, the server asks CALL-E to place a single outbound call batch. The separate resolution step can place one additional outbound call only after another explicit approval. Server allowlisting, per-operation idempotency, and start rate limits reduce accidental or duplicate calls.

ReadyLine cannot cancel an accepted one-shot call from its UI. Closing or refreshing the tab stops local polling but does not cancel a call already accepted by CALL-E; the call ID is kept in session storage so the operator can resume its status check. There is no recurring job to roll back. For live verification, use only a number you control, keep `READYLINE_LIVE_ENABLED=false` until immediately before the test, and turn it off again afterward.

## Opt-in live verification

Live verification is deliberately separate from the public demo:

1. Add only a consenting test recipient in E.164 format to `CALLE_ALLOWED_NUMBERS`.
2. Configure the server-only CALL-E and operator credentials.
3. Set `READYLINE_LIVE_ENABLED=true`.
4. In the UI, select Live, enter the same authorized number for the intended recipient, confirm authorization, and approve the call.
5. After the test, set `READYLINE_LIVE_ENABLED=false` and remove the number from the allowlist.

Do not use fictional `+1 202-555-01xx` numbers for live verification; the server rejects that reserved demo range.

## CALL-E integration

`GET /api/calls/readiness` returns the safe Demo/Live capability state. `POST /api/calls` creates either an initial readiness batch or one targeted resolution call. `GET /api/calls?callId=…&eventId=…&stage=…&operationId=…` polls the expected operation. Both call routes require `X-ReadyLine-Operator-Key`; the CALL-E API key never enters browser code.

The deployed backend uses the official `@call-e/calle` TypeScript SDK and a strict per-recipient result schema. CALL-E CLI/MCP OAuth authentication is useful for local agent workflows, but it does not configure the deployed SDK; production still requires `CALLE_API_KEY`. Demo mode mirrors the same application data shape, uses fictional non-working numbers, and never calls the live route.
