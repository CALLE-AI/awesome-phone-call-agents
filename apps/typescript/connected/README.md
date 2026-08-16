# Connected

> **Every call picks up where the last one left off.**

Connected is a consent-first AI phone companion for older adults. CALL-E makes a warm scheduled
call, recalls only the interests and family stories the participant approved, and gives the
conversation time to wander. When the person wants more, Connected can offer a verified local event,
set up a reminder for review, or ask a human community coordinator to make an introduction.

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
what enters an operator’s review queue.

## What is included

| Surface | Purpose |
| --- | --- |
| Companion continuity console | Responsive demo of conversations, approved memories, next topics, and optional follow-through |
| CALL-E adapter | Real `@call-e/calle` SDK import, one-recipient dispatch, polling, and strict result schema |
| Preview CLI | Redacted no-call plan for operator inspection |
| Live CLI | Opt-in CALL-E call path behind three consent gates and an environment switch |
| Decision layer | Pure rules for opt-out, confirmed memory, event reminders, and community introductions |
| Tests | Trust-boundary, consent, idempotency, privacy, and invented-event coverage |

## Try it without placing a call

Requires Node.js 22 or newer.

```bash
npm install
npm run dev
```

Open the local URL printed by Vite. The interface uses fictional data and reaches no network.
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

1. Opt-out cancels future host-scheduled calls.
2. Missing consent stores no conversation content.
3. An explicit community-introduction request enters operator review.
4. An explicit reminder request for a verified event enters reminder review.
5. An out-of-scope request enters ordinary operator follow-up.
6. Otherwise, the next consented companion call stays on its visible cadence.

## Practical deployment model

Connected fits charities, councils, senior-living communities, care providers, and volunteer
networks that already know local activities and services. Their scheduler starts one run; CALL-E
makes exactly one call; their staff review optional follow-through. There is no hidden provider-side
recurrence and no requirement to replace existing case-management tools.

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

## Side effects and cancellation

- Development, tests, builds, and `call:preview` place no calls or schedules.
- `call:live` can place one real call only when its environment switch and consent gates pass.
- The host scheduler owns recurrence. Cancel there and mark the participant suppressed.
- An in-call opt-out always becomes cancellation before any other follow-through.
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

## Free public demo deployment

The interface is a static Vite build, so it can run on a free static host without exposing a CALL-E
credential. From this directory, Vercel can use the included `vercel.json` and publish `dist/`:

```bash
npx vercel
```

Keep the public demo in no-call mode. A live CALL-E action belongs in a trusted backend with operator
authentication and the same explicit consent gates—not in browser JavaScript.
