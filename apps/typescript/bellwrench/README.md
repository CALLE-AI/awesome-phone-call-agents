# Bellwrench

Call the roster. Compare the evidence. Dispatch with confidence.

Bellwrench is a consent-first maintenance vendor dispatch desk powered by CALL-E. A property operator prepares a non-emergency work order, selects businesses they are authorized to contact, previews the disclosure and action limits, and explicitly confirms real outbound calls. Bellwrench turns the returned CALL-E results into a comparable evidence view; a human—not the calling agent—decides what happens next.

## What works now

- Non-emergency work-order intake with a conservative life-safety refusal gate.
- Up to five authorized vendor recipients with E.164 validation.
- Exact pre-call disclosure, purpose, and information-only authority preview.
- Explicit confirmation before any real outbound call.
- Server-only `@call-e/calle` 0.6 integration with a content-bound idempotency key per dispatch and vendor.
- One create attempt per destination, no automatic replay after ambiguous acceptance, and known call-ID preservation when polling fails.
- Strict runtime validation for availability, ETA, price/quote status, currency, constraints, confidence, and evidence.
- Four conservative outcomes: verified, incomplete, failed, and unknown.
- Browser-local recovery of an unfinished dispatch without automatic execution or restored confirmation.
- Ranked verified evidence with no automatic booking, spend, or vendor assignment.
- A browser-local operator decision record that permits only verified vendors or an explicit no-dispatch outcome and always records `not_booked`.
- A credential-safe `GET /api/health` readiness endpoint.
- Automated no-call tests covering safety, validation, task construction, SDK contracts, identity, reconciliation, API behavior, recovery, approval invalidation, activity state, result verification, decisions, and ranking.

## Run locally

Requirements: Node.js 20+ and a CALL-E Developer API key for live calls.

```bash
npm install
cp .env.example .env.local
npm run dev
```

Set `CALLE_API_KEY` in `.env.local`. Keep `CALLE_BASE_URL=https://api.heycall-e.com` unless the official CALL-E documentation instructs you to use another environment.

Open `http://127.0.0.1:3000`.

Both `npm run dev` and `npm start` explicitly bind to `127.0.0.1`. This contribution supports a local operator on a trusted machine. Do not override the hostname, expose it through a tunnel or reverse proxy, or deploy it publicly with a server key: it has no remote operator authentication. Remote calling requires a separately authenticated and authorized deployment.

For a production-mode local run:

```bash
npm run build
npm start
```

`GET /api/health` returns HTTP 200 only when a server credential is present and the CALL-E base URL passes validation. It never contacts CALL-E or returns credential material.

## Verify without placing calls

```bash
npm test
npm run lint
npm run build
```

The automated suite never places a real call. Live calls require all of the following at runtime:

1. A server-side `CALLE_API_KEY`.
2. A valid non-emergency work order.
3. At least one selected vendor with an E.164 number and authorization confirmation.
4. A deliberate checkbox confirmation on the final preview.

Browsing the intake and preview steps is Bellwrench's default no-call path. The browser never receives the CALL-E credential, and leaving the confirmation unchecked prevents dispatch at the server boundary.

## Live-call lifecycle

Bellwrench creates each selected vendor call through `client.calls.create`, then waits through `client.calls.waitForResult`. The split preserves a known call ID if later polling fails. Network errors and HTTP 408, 409, 429, and 5xx create responses are acceptance-ambiguous, so Bellwrench makes no automatic resubmission, even with the original idempotency key. The outcome is immediately `unknown`. Review the CALL-E dashboard to establish whether a call exists before any new attempt; do not use a new dispatch identity to bypass uncertainty. Polling an already known call ID does not create another call.

Selected vendor rows are deduplicated by their validated E.164 destination before the wave. The first selected row is called; additional rows for that number return `failed` with `DUPLICATE_DESTINATION` and no call ID. They do not borrow the first vendor's evidence.

The browser creates a dispatch UUID and saves the active intent locally before execution. The server binds that UUID to the exact task, recipient, result schema, and vendor through a SHA-256 digest. A reload can restore the same intent, but never restores the real-call confirmation or places a call automatically. On a shared device, use “Start another dispatch” after review to clear the locally stored work order and phone numbers.

The call task identifies the AI-assisted purpose, treats operator values as bounded untrusted context, remains inside the disclosure budget, collects the requested structured facts, and refuses booking or spend authorization.

## Result states

- `verified`: call and recipient completed, task completion is true, confidence is at least 0.5, evidence exists, and the complete structured result passes runtime validation.
- `incomplete`: the call ended, but one or more verification gates did not pass. Returned context is not ranked as actionable evidence.
- `failed`: CALL-E definitively rejected, failed, or canceled the attempt. Bellwrench exposes only a safe failure code.
- `unknown`: CALL-E may have accepted the create or a known call could not be read to a trustworthy terminal result. Do not create a new dispatch identity until the run is reviewed.

Returned vendor results are evidence for a human decision. They do not prove licensing, insurance, completed work, a binding quote, or a confirmed booking unless separately verified.

The operator can record either one verified vendor for manual follow-up or no dispatch. This audit record is stored only in the current browser, contains no phone number, and explicitly records that no booking was made.

## Safety boundaries

- Do not use Bellwrench for gas leaks, fire or smoke, medical emergencies, active crimes, trapped occupants, exposed live wiring, structural collapse, or other imminent danger.
- Call only recipients the operator is authorized to contact.
- Do not put access codes, tenant medical information, secrets, or unnecessary personal data in work orders.
- Bellwrench never silently books work, accepts terms, or authorizes spend.
- A failed or unconfigured call path never renders a fabricated successful result.
- Real credentials are allowed only at the exact official HTTPS origin. Non-production HTTP loopback is allowed only with the literal synthetic key `bellwrench-fake-test-key`, for a local test server. Any other key is refused before SDK construction; production refuses loopback even with the fake key.
- Phone-shaped text in provider constraints, summary, evidence, and confidence labels is masked in returned copies for both verified and incomplete results. Original provider objects remain unchanged. This is phone masking, not a guarantee that arbitrary free text contains no other personal information; review evidence before sharing it.

## Side effects and stopping a call

Submitting the final confirmed preview creates one intended outbound CALL-E call for each unique selected destination. Bellwrench creates no recurring schedule, so there is no recurring job to cancel or roll back. If a call is queued or active and must be stopped, use the CALL-E dashboard; do not start another dispatch while an outcome is unknown. A completed phone conversation cannot be undone, and the operator remains responsible for any later booking or purchase made outside Bellwrench.

For live verification, use only test vendors or phone numbers whose owners explicitly consented to the call. Keep real credentials and private numbers in `.env.local` or the browser form; never commit them or include them in screenshots.

## Technology

- Next.js 16 / React 19 / TypeScript
- CALL-E TypeScript server SDK `@call-e/calle` 0.6.0
- Vitest
- Tailwind CSS 4 plus a custom responsive visual system

## Hackathon

Built for [CALL-E: Your Code Is Calling](https://call-e.devpost.com/). The project targets the Most Practical Use Case prize with a specific phone-work bottleneck and a reusable, safety-forward workflow.
