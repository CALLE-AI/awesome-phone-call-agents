# TinySlot

TinySlot is an adaptive childcare-vacancy search desk powered by CALL-E. It calls a parent-approved list of childcare centers in small waves, checks each staff-reported answer against the same care constraints, stops when enough qualified options are found, and places a separate parent-approved call to request a tour.

The app is a hackathon reference implementation, not a childcare placement, licensing, or safety-certification service. Availability and prices are time-stamped staff reports, not guarantees.

## Why phone calls

Childcare websites and directory listings often do not expose current age-band openings, exact weekday combinations, operating-hour fit, current tuition, or tour availability. Those details are frequently answered only by staff over the phone. TinySlot turns those conversations into comparable structured results while preserving unanswered questions as unknown.

## Workflow

1. Enter a non-identifying care brief: age band, desired start date, weekdays, care window, budget, and optional subsidy requirement.
2. Review the exact centers and maximum wave size before any call.
3. CALL-E calls at most three authorized destinations in a wave and returns a strict result for each recipient.
4. TinySlot evaluates identity, age band, vacancy, days, hours, subsidy, budget, and evidence with deterministic code.
5. Once the requested number of qualified matches exists, held centers are not called.
6. A parent can review a separate disclosure envelope and authorize one tour-request call by typing `REQUEST TOUR`.

## Run the no-call demo

Requires Node.js 22.13 or newer.

```bash
cd apps/typescript/tinyslot
npm install
npm run dev
```

Open `http://localhost:3000`, leave **Demo** selected, and choose **Run simulated search**. Demo mode uses six fictional childcare centers and reserved non-working NANP numbers. It never contacts CALL-E, consumes credits, or places a phone call.

## Live CALL-E setup

Copy `.env.example` to `.env.local` and provide:

```bash
TINYSLOT_LIVE_ENABLED=true
CALLE_API_KEY=<server-side CALL-E API key>
TINYSLOT_OPERATOR_KEY=<at-least-20-character deployment access key>
CALLE_ALLOWED_NUMBERS=<AUTHORIZED_E164_1>,<AUTHORIZED_E164_2>
```

Restart the app, choose **Live**, enter the same operator key in the UI, select the calling route, and enter only E.164 test destinations whose owners authorized the disclosed AI calls.

`CALLE_API_KEY` is read only by server routes and is never returned to the browser. The app constructs the CALL-E client without a configurable remote origin, so credentials go only through the official SDK default.

## CALL-E implementation

`app/api/calls/route.ts` imports `@call-e/calle` and calls `client.calls.create()` at runtime. It uses:

- one batch CALL-E task per adaptive search wave;
- a strict `recipientResultSchema` for each center;
- a separate strict schema for the tour request;
- metadata binding for campaign, operation, stage, and HMAC phone fingerprints;
- stable SDK idempotency keys;
- polling with `client.calls.get()`;
- local schema validation before results reach the matching engine.

If a create request has an ambiguous outcome, do not invent a new operation ID. Check the accepted CALL-E call ID or retry the same operation so the idempotency key remains stable.

## Safety and privacy

- Live calls are disabled unless `TINYSLOT_LIVE_ENABLED=true` and all credentials and allowlists are configured.
- Every live destination must be valid E.164, present in `CALLE_ALLOWED_NUMBERS`, non-fictional, and covered by the operator's authorization attestation.
- UI and exported reports mask or omit live destination numbers.
- The search uses an age band, not a child's name or birth date.
- The call task prohibits collecting medical details, enrolling a child, accepting policies, making payments, negotiating, or promising a place.
- A waitlist is never classified as an opening.
- Missing identity, schedule, vacancy, or evidence routes to human review.
- The tour request has a separate exact-text approval and bounded disclosure envelope.
- Calls are limited to three recipients per search wave and one recipient per tour request.
- Server routes rate-limit live starts and reject duplicate destinations.
- There are no recurring schedules or hidden retries.

## Medical, legal, financial, and emergency boundaries

TinySlot is an administrative availability tool. It does not provide medical, developmental, legal, licensing, financial, or safeguarding advice. It must not collect a child's diagnosis or decide whether a center can meet medical or disability-related needs; those questions require direct discussion between the parent, qualified professionals, and the center. It cannot authorize charges, evaluate contracts, or make payments. It is not an emergency service and must never be used for urgent child-safety or welfare concerns; contact local emergency services or the appropriate human authority instead.

## Side effects and cancellation

Demo mode has no external side effects. Live search starts up to three real outbound calls and consumes CALL-E credits. The tour action starts one additional real call.

TinySlot can stop before the next wave, but CALL-E does not expose cancellation of an already submitted call through this app. Closing the page does not recall an in-flight call. Preserve the displayed call ID and inspect that result before attempting another operation.

## Result interpretation

The app labels a center **Qualified** only when all hard constraints have supported answers. Budget is shown separately as a parent preference. Fixture results are clearly synthetic and are never represented as provider-verified calls.

TinySlot does not evaluate educational quality, regulatory status, suitability, safeguarding, licensing, or a child's individual needs. Parents must verify those matters independently.

## Validation

```bash
npm run test:unit
npm run lint
npm run build
```

The default tests use no credentials, network access, or real calls. They cover fail-closed matching, waitlist separation, adaptive stopping, strict result parsing, E.164 and allowlist controls, rate limiting, and provider-recipient binding.

## Demo script

1. Show the toddler brief and explain that no child identity is collected.
2. Start the first three-center simulated wave.
3. Show two qualified openings, one waitlist, and three calls avoided by the stop rule.
4. Inspect the evidence matrix and explain that matching is deterministic.
5. Select Willow Room, review the disclosure envelope, type `REQUEST TOUR`, and run the synthetic follow-up.
6. Export the evidence report and show the separate tour outcome.

Detailed submission assets are available in:

- [`docs/demo-script.md`](docs/demo-script.md)
- [`docs/live-validation.md`](docs/live-validation.md)
- [`docs/call-e-feedback.md`](docs/call-e-feedback.md)
- [`docs/devpost-draft.md`](docs/devpost-draft.md)
- [`docs/submission-checklist.md`](docs/submission-checklist.md)
