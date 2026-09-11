# Connected

> **Every call picks up where the last one left off.**

Connected is a self-service, consent-first AI phone companion for older adults. The older adult books
the first call. CALL-E makes a warm scheduled conversation, recalls only the interests and family
stories they approved, and gives the conversation time to wander. Before goodbye, they choose the
next call time together; Connected carries that cadence and the approved threads forward. When the
person wants more, it can also offer a verified local event or community introduction.

It is not a survey, monitoring system, or emergency detector. **The product is the conversation.**
Everything else exists to make the next conversation—and the next human connection—more likely.

## Why it is worth building

Telephone-befriending programs are deeply human but hard to offer consistently at scale. Generic
automated calls feel transactional because each call begins from zero. Connected uses CALL-E for a
non-obvious phone task: companionship with continuity.

- “Did that first tomato beat the birds?” instead of “How are you today?”
- “How did Leo’s school play go?” instead of a scripted wellbeing questionnaire.
- “There’s a local-history tea on Tuesday” only when it fits the person’s interests.
- “Would you like Maya from the centre to introduce you?” only after explicit opt-in.

The AI owns the social conversation. Deterministic code owns consent, memory, event validity, and
what may be remembered, scheduled, or shared outside the conversation.

## What is included

| Surface | Purpose |
| --- | --- |
| Self-service companion experience | First-call booking, consent state, approved memories, live metrics, call history, and the next agreed call |
| Protected browser-to-CALL-E workflow | Server-side `@call-e/calle` import pinned to the official HTTPS origin, one-call dispatch, status polling, evidence-bound results, and no browser credential |
| End-to-end judge mode | A labelled fixture exercises the same post-call transition without placing a real call |
| Preview CLI | Redacted no-call plan for operator inspection |
| Live CLI | Opt-in CALL-E call path behind three consent gates and an environment switch |
| Decision layer | Pure rules for opt-out, confirmed memory, event reminders, and community introductions |
| Tests | Trust boundaries, consent, idempotency, privacy, result validation, invented events, state transitions, and action closure |

## Try it without placing a call

Requires Node.js 22 or newer.

```bash
npm install
npm run dev
```

Open the local URL printed by Vite, choose **Book my first conversation**, and run the end-to-end demo.
It simulates a completed companion call, then updates approved memory, the timeline, impact counters,
and the human reminder queue. State persists in that browser. The fixture is explicitly labelled and
reaches no phone network.
Names, profiles, and the companion-call photograph are fictional or AI-generated demo material; they
do not depict an enrolled participant.

Preview the exact CALL-E task and structured result contract:

```bash
npm run call:preview -- examples/check-in.example.json
```

The preview masks the recipient list and places no call.

## Run one approved CALL-E companion call

Live calls fail closed. Keep the server SDK key in the environment, never in source or request JSON.

```bash
export CALLE_API_KEY="calle_live_key"
export CALLE_LIVE_CALLS="enabled"
npm run call:live -- path/to/approved-check-in.json
```

The request must include an explicit E.164 number and the exact boolean `true` for
`contactConsentRecorded`, `aiDisclosureApproved`, and `confirmOneCall`. The app imports
`CalleClient` at runtime, creates one call using an authorization-derived idempotency key, and waits
for the structured result. Live calls consume CALL-E credit.

## The conversation contract

The companion discloses that it is AI, asks permission to continue, lets the participant lead, and
uses approved memories only as optional openings. It leaves room for stories, humour, silence, and a
change of subject. Near the end, it asks what would be enjoyable to talk about next time.

It may save at most one new conversation thread after reading it back and hearing explicit
confirmation. It offers only events supplied by the operator. It never invents personal details,
books an event, promises a service, diagnoses, monitors risk, or pretends to be human.

The post-call policy is intentionally small:

1. Opt-out cancels already queued QStash messages carrying that participant's hashed cadence label.
2. Missing consent stores no conversation content.
3. An explicit community-introduction request enters operator review.
4. An explicit reminder request for a verified event enters reminder review.
5. An out-of-scope request enters ordinary operator follow-up.
6. An agreed ISO date and time becomes the next visible, cancellable companion call.

## Practical deployment model

Connected begins with the older adult, not a call team: they book once, talk by ordinary phone, and
choose the next call during each conversation. CALL-E returns that agreed time as structured data,
and Connected adds it to the continuing cadence. Charities, councils, or community services are
optional destinations only when the person asks to be introduced—not gatekeepers for companionship.

## How this meets the judging criteria

| Criterion | Evidence in this project |
| --- | --- |
| Real World Impact | A specific continuity problem for socially isolated older adults; verified local-event and human-introduction follow-through; an eight-week loneliness pilot target with honest denominators |
| Quality of the Idea | CALL-E is a continuing companion—not a survey, sales bot, or generic reminder—and the consent/memory/action pattern is reusable by community organizations |
| Technical Implementation | The Vercel function imports `CalleClient`, calls `client.calls.create(...)` at runtime, polls `client.calls.get(...)`, validates the result, and applies deterministic post-call rules |
| Product Experience & Demo | One flow covers self-booking → consent → call → structured result → approved memory → next agreed call; judge mode demonstrates it safely in under a minute |

## Measuring impact honestly

The hackathon demo does **not** claim reduced hospitalization. A real partner could evaluate that
long-term hypothesis with appropriate consent, governance, and study design. Connected first measures
what the product can credibly change:

- calls reached, consented, enjoyed, and completed—each with its own denominator;
- participant-reported connection pulse over time;
- continuity: confirmed memories reopened and next topics revisited;
- event reminders requested and community introductions completed;
- repeat participation, opt-outs, and deletion requests;
- operator actions accepted, completed, or still open.

The public page cites the WHO estimate that roughly one in four older adults experience social
isolation or loneliness, CDC summaries of associated cardiovascular risk, and a 2024 randomized
telephone-intervention trial reporting a medium-to-large loneliness effect (`d = 0.60`). Those are
external signals, not Connected outcomes. Connected's displayed **≥15%** eight-week improvement is a
prospective pilot target, not a result.

## Side effects and cancellation

- Development, tests, builds, and `call:preview` place no real calls.
- `call:live` can place one real call only when its environment switch and consent gates pass.
- The participant chooses the next time in conversation. Before a replacement is queued, Connected cancels every pending QStash message carrying that participant's hashed cadence label.
- An evidence-bound in-call opt-out calls QStash's cancellation API before any other follow-through. The live companion panel's **Cancel future calls** control uses an authenticated `DELETE /api/connected` request with the participant id to provide the same cancellation path outside a call.
- Cancellation applies to messages still queued or retrying in QStash. It cannot recall a delivery that has already reached `/api/dispatch`; that boundary is stated rather than hidden.
- Replaying the same authorized `runId` produces the same idempotency key.

## Privacy and boundaries

- Phone numbers come only from operator-owned request data and are masked in previews and output.
- Credentials are read only from the environment.
- Public CLI output excludes phone numbers, transcripts, and conversation content.
- Memories require confirmed read-back and can be deleted on request.
- Connected gives no medical, legal, financial, or emergency advice and is not an emergency service.

## Verify

```bash
npm test
npm run build
```

Tests use a fake CALL-E port and need no credentials or network access.

## Vercel deployment

The public demo is fully usable in judge mode without credentials. The same deployment includes the
protected `/api/connected` serverless endpoint. To enable its **Live CALL-E** tab, add these encrypted
environment variables in Vercel:

```text
CALLE_API_KEY=<server-side CALL-E API key>
CONNECTED_ACCESS_TOKEN=<strong private self-service access code>
CONNECTED_DISPATCH_TOKEN=<random secret accepted only by the scheduled-call endpoint>
CONNECTED_PUBLIC_URL=<your production URL, for example https://connected.example.com>
QSTASH_TOKEN=<Upstash QStash token>
```

Then deploy from this directory using the included `vercel.json`:

```bash
npx vercel --prod
```

The API key never enters browser JavaScript. Every credentialed SDK client is pinned to
`https://api.heycall-e.com`; deployment input cannot redirect the CALL-E credential to another origin.
The first live call requires contact consent, approved AI disclosure, an E.164 number, the private
access code, and a fresh one-call confirmation. On completion, Connected accepts structured output
only after exact call id, task text, single recipient, metadata, completed attempt, non-empty evidence,
`status=completed`, and `taskCompleted=true` all match the original authorization. CALL-E then extracts
`next_call_at`; the server cancels any older message with the participant's hashed cadence label and queues an authenticated, delayed QStash message to
`/api/dispatch`, which creates the next CALL-E conversation at the time the older adult chose. The
source call id and CALL-E idempotency key protect retries from creating duplicate calls. QStash's
`Upstash-Not-Before` delivery is the serverless clock; no person has to trigger the next call.

For a real pilot, replace browser-local history with an encrypted audited datastore and add phone
verification. The deployment can still demonstrate the complete cadence safely when live credentials
are absent: judge mode applies the identical result, memory, and next-call transition locally.
