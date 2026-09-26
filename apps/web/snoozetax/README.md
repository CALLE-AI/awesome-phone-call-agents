# SnoozeTax

**An alarm clock that phones you and makes you think, because a snooze button
cannot tell whether you are awake.**

Built on [CALL-E](https://www.heycall-e.com/) for the "Your Code Is Calling" hackathon.

---

## The problem

Every alarm app measures the same thing: a tap. Tapping is something people do in
their sleep, with their eyes closed, and forget by breakfast. The alarm believes
it worked. The user goes back to sleep.

A conversation is different. You cannot hold one without being conscious.

## What it does

At wake-up time, CALL-E places a real phone call, reads out a three digit code,
and asks for it back in reverse order. Repeating a code proves you can hear;
reversing one proves somebody is home. The answer is graded on the call itself,
and the verdict comes back as structured data: was it right, and did they sound
awake or were they slurring through it.

If the call is missed, nothing is punished yet. Do Not Disturb, no signal and a
flat battery all look identical to oversleeping, so a missed call opens a
ten-minute window to answer on the web instead. Let that run out and CALL-E
places a second call, to the accountability contact the user nominated, to tell
them you are still in bed.

No card on file, no fees. The stake is a person.

## How CALL-E is used

| Feature | Where |
|---|---|
| Outbound calls (`POST /v1/calls`) | Verification, wake-up, and shame calls |
| `result_schema` structured extraction | Grades the spoken answer and judges grogginess |
| Terminal webhooks | `call.completed` drives the wake state machine |
| Transcripts | Stored per wake event and shown in History |
| `Idempotency-Key` | Stops a retry or double cron tick from billing twice |

Four distinct call types, each with its own task prompt and result schema:

1. **Verification** reads a 4-digit code to confirm the number is real.
2. **Consent** phones the nominated accountability contact once to ask permission.
   Until it comes back `granted`, that number is never called again.
3. **Wake-up** reads out a three digit code and grades the reversal on the call.
   The expected answer is computed server-side and written into the prompt, so a
   model that reversed the digits wrong can never reject a correct answer.
4. **Accountability** calls that second human when the sleeper never woke up.

Every prompt and schema is browsable at `/admin`, rendered from the same builders
the live calls use so the page cannot drift from what is actually spoken.

## Run it

The default is **dry-run**: no calls are placed and no credits are spent, so the
whole app can be explored without an API key.

```bash
# Backend
cd backend && npm install && node index.js       # http://localhost:4005

# Frontend
cd frontend && npm install && npm run dev        # http://localhost:5173
```

Sign up with any number in E.164 format (`+447700900123`). In dry-run the
verification code is shown on screen instead of being spoken.

### Placing real calls

Credentials are read at runtime from AWS SSM and are never written to disk.
Set `CALLE_API_KEY` directly if you are not using SSM.

```bash
cd backend
DRY_RUN=false CALLE_API_KEY=iams_live_... node index.js
```

Terminal webhooks need a public URL, so point `PUBLIC_URL` at a tunnel:

```bash
DRY_RUN=false PUBLIC_URL=https://your-tunnel.example node index.js
```

One-shot integration check (costs one call):

```bash
node test-live-call.js +447700900123
```

### Tests

```bash
cd backend && npm test     # 58 checks, dry-run, no credits spent
```

## Architecture

```
frontend/  React + Vite. Landing, auth, alarm, the ten-minute answer screen.
backend/
  index.js          Express API, node-cron scheduler, webhook receiver
  adapters/calle.js  The ONLY file that knows CALL-E exists
  lib/wake.js        Wake-up state machine (vendor-neutral)
  lib/challenges.js  The question bank and answer grading
  lib/db.js          SQLite schema
  lib/secrets.js     AWS SSM loader
```

Business logic never imports the vendor SDK: `lib/wake.js` returns intents and
the adapter is what turns them into phone calls.

### The wake-up state machine

```
calling ──answered correctly on the phone──────────────────> passed
   │
   ├──answered, wrong ──────────────────> awaiting_web   (10 minutes)
   │
   ├──no answer, attempts left──> retrying ─(1 min)─> calling
   │
   └──no answer, no attempts left──────> awaiting_web   (10 minutes)
                                               │
                     correct on the web ───────┼──────────> passed
                     ten minutes expire ───────┴──────────> failed → shamed
```

**Answering and getting it wrong is not the same as never picking up**, and the
two take different branches. This is the whole reason `answer_correct` is a
three-value enum rather than a boolean: `no` means a human spoke and got it
wrong, `unknown` means nobody was reached.

Someone who spoke has already proved they are awake and holding the phone.
Calling them back to ask the identical question they just failed would burn a
billed call to tell them nothing new, so they go straight to the web window,
where the code is displayed and all they owe is the reversal.

A missed call proves nothing. Do Not Disturb, bad reception and a flat battery
are indistinguishable from a snooze, so that is the case that earns the second
ring: the phone may genuinely never have been heard.

## Side effects

Everything this app does that reaches the outside world, in one place:

| Trigger | Side effect | Cost |
|---|---|---|
| Sign-up | One call to the user's own number, reading a 4-digit code | ~$0.05 |
| Saving a **new** contact number | One consent call to that number, asking permission | ~$0.05 |
| Alarm fires | One wake-up call to the user | ~$0.05 |
| First call **unanswered** | One retry call, 60 seconds later | ~$0.05 |
| Ten-minute window expires | One call to the accountability contact | ~$0.05 |

A wake-up call that was answered and failed deliberately does **not** bill a
retry: the user is awake, so the web window is both cheaper and more useful than
repeating the question.

Nothing else leaves the machine. There are no payments, no SMS, no third-party
analytics, and no data sent anywhere but CALL-E. A worst-case morning is three
calls (wake, retry, and the contact call), roughly $0.15.

**Consent is enforced at call time, not at save time.** An accountability
contact is a third party who never signed up, so nominating them only marks the
number `pending`; CALL-E phones them once to ask, and `punish()` refuses to dial
any contact whose status is not `confirmed`. A `declined` number can never be
re-asked through the API.

## Cancelling and rolling back

The scheduler is a recurring workflow, so every part of it can be switched off:

| To stop | Do this |
|---|---|
| One alarm | Toggle it off in the UI, or `PUT /api/alarms/:id` with `enabled: false` |
| All calls, globally | Run with `DRY_RUN=true` (the default). Calls are simulated and logged, never placed |
| The scheduler entirely | `node -e "require('./index.js')"` imports the app without starting cron |
| The accountability contact | `DELETE /api/me/contact` clears the number and sets status back to `none` |
| Everything | Stop the process. No calls are queued outside it |

Deleting an alarm removes future rings but keeps past wake events, so history
and streaks survive. A call already handed to CALL-E cannot be recalled: once
`POST /v1/calls` returns, that phone will ring. The controls above prevent the
*next* call; they cannot cancel one already in flight.

## Known limits

- **The caller ID varies.** CALL-E routes Spanish numbers over a shared
  international pool, so the number is not stable between mornings. A dedicated
  number needs a dashboard purchase plus KYC. This is exactly why the web
  fallback exists rather than being an afterthought.
- **No SMS.** CALL-E is voice-only, so re-entry is a long-lived session rather
  than a magic link. A verification call is the recovery path for a new device.
- **No mid-call validation.** CALL-E cannot call back into the server during a
  conversation, so answers are graded after the call ends, from the structured
  result.
- **One alarm per account.** The scheduler and schema handle many; the cap is a
  single constant in the API.

## Licence

MIT.
