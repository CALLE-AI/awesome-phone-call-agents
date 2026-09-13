# One More Story

One More Story is a consent-first oral-history phone workflow. A loved one hears one meaningful question, corrects the read-back, and confirms the final wording. Until that confirmation, the product creates no story.

The browser demo is deliberately a no-call fixture. It makes the full evidence boundary visible without a phone number, CALL-E account, or paid call.

## What it proves

- AI identity is disclosed before the question.
- Permission to continue is recorded separately from permission to contact.
- One approved question is asked; the agent does not improvise another.
- The original answer and correction remain distinguishable.
- A story exists only after explicit confirmation of the corrected read-back.
- A deletion request prevents confirmation.

## Run the no-call demo

```bash
npm install
npm run dev
```

Use **Try the no-call demo** to replay disclosure, permission, question, read-back, correction, and confirmation. The fixture never sends a phone number and never calls CALL-E.

```bash
npm run test
npm run lint
npm run build
```

## Inspect the CALL-E request without calling

The checked-in request uses a reserved fictional number and keeps every authority flag false.

```bash
npm run call:preview -- examples/call.example.json
```

Preview redacts the recipient field. It does not require credentials and cannot place a call.

## Live CALL-E use

Live use is intentionally server-side and fail-closed. Before one call, make a private copy of the example request and provide:

- the adult storyteller's exact E.164 number;
- their explicit permission to be contacted by this automated workflow;
- an explicit BCP 47 locale and, if known, region;
- the family member's name and exactly one approved question;
- approval of the spoken AI/transcription disclosure; and
- a fresh `confirmIntent: true` for this specific call.

Then supply the credential only to the server process and enable the live switch for that invocation:

```bash
CALLE_API_KEY=... CALLE_LIVE_CALLS=enabled npm run call:live -- /private/path/request.json
```

The adapter uses `@call-e/calle` to create one call with a content-derived idempotency key, then waits on that same call ID. The API key never enters the Vite client. Live calls consume CALL-E credit and cause a real phone to ring.

## Side effects, cancellation, and recovery

- `call:preview`, the web demo, tests, lint, and build place no calls.
- `call:live` can place exactly one outbound call after all gates pass.
- There is no recurring schedule, automatic retry, or hidden follow-up.
- If CALL-E accepts a call but result retrieval fails, do not run a new request. Reconcile the accepted call in CALL-E using its call ID and provider records.
- Before acceptance, stop the command. After acceptance, use CALL-E's provider controls for that same call; starting a second call is not cancellation.
- Local demo deletion clears the fixture state only. A real deletion request is returned as structured evidence and must be handled by the operator's retention system.

## Safety boundaries

Do not use this app for minors without a responsible adult and applicable legal review, for anyone who has not agreed to automated contact, or for medical, legal, financial, emergency, crisis, or coercive conversations. Never guess a phone number, locale, consent status, identity, or answer. A timeout, voicemail, silence, model summary, or provider status is not consent or story confirmation.

The structured result keeps disclosure acknowledgment, permission, answer, correction, confirmation, and deletion separate. Only an explicit final confirmation can create a story.
