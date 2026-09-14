# Briefline

Objective-driven outbound calling on CALL-E: write a brief instead of a script,
and the agent works the goal, remembers the contact, and places the callback it
promised without anyone pressing a button.

Most phone agents need a branch for every reply. Briefline compiles one
plain-English brief into a task — what must be learnt, what must never be
claimed, when the call may end — hands that to CALL-E, and turns the structured
result back into a lead, a memory and a scheduled callback.

## Why this is useful for phone-call workflows

The part that is hard to build once and reuse is not the call. It is everything
around it: deciding what the call is for, keeping what was learnt, working out
when someone said to ring back, and making sure that ring-back actually happens
without a person babysitting a queue.

- **Briefs, not scripts.** A paragraph becomes a checklist plus hard
  constraints. Changing the goal does not mean rewriting a dialogue tree.
- **Callbacks that place themselves.** "Call me Wednesday after five" is
  extracted as spoken words, resolved by a date parser, and dialled at that time
  with the previous conversation in hand.
- **Memory across calls.** The second call opens knowing the first, so it does
  not restart the conversation from zero.
- **Refusals as a feature.** The scheduler declines to dial more readily than it
  dials: opt-outs, calling hours, stale callbacks, unparseable numbers.

## Setup

This is an external experimental reference. Keep `DRY_RUN=true`, use synthetic contacts and briefs, and leave provider credentials unset for the public walkthrough. The fake-model tests below are the offline verification path; the application preview is not an offline privacy boundary. The app is single-tenant with stubbed authentication, so do not expose live calling or private records to the public internet.

```bash
git clone https://github.com/uthejitha04/dialtone && cd dialtone/backend
python -m venv .venv
./.venv/Scripts/pip install -r requirements.txt      # Windows
# .venv/bin/pip install -r requirements.txt          # macOS / Linux

cp ../.env.example ../.env
```

For a separately authorized live experiment, the source project uses these keys:

```bash
CALLE_API_KEY=      # heycall-e.com
GROQ_API_KEY=       # console.groq.com — compiles the brief
```

Optional, for browser calls and Indic voices: `SARVAM_API_KEY`,
`SMALLEST_API_KEY`, `GEMINI_API_KEY`.

```bash
./.venv/Scripts/python -m uvicorn app.main:app --port 8010
```

Open <http://127.0.0.1:8010>.

## Usage

### From the UI

| Page | What it does |
|---|---|
| `/phone` | Pick a country, type a number, write the brief, dial |
| `/calls` | Transcript, summary, action items, the follow-up queue |
| `/campaigns` | Import a CSV and work the list under concurrency limits |
| `/` | Talk to the same agent over your microphone, no telephony |

### From the API

```bash
curl -X POST http://127.0.0.1:8010/api/phone/call \
  -H 'Content-Type: application/json' \
  -d '{
    "phone": "+15550100123",
    "company": "Example Bakery",
    "objective": "Find out whether they want a website redesign. If they are interested, ask what they would want on the new site. If they ask to be called back, ask when suits them.",
    "verified_facts": ["We build websites for small businesses."],
    "dry_run": true
  }'
```

`dry_run: true` returns the task and result schema that *would* be sent to CALL-E and places no telephone call. It needs no CALL-E key, but compilation can send the brief to a configured Groq/Gemini model before returning the preview. Use only synthetic text here; use the fake-model tests, not this endpoint, when no network traffic is required.

Only after reviewing the source limitations and confirming an authorized E.164 destination, `"dry_run": false` can dial. The response carries a `call_id`; poll
`GET /api/phone/call/{call_id}` or receive the terminal result on the webhook.

## Side effects

Worth reading before setting `dry_run: false` — these reach real people.

- **It rings a real phone** and consumes CALL-E call credit.
- **It writes a contact.** A first call to a number creates one; later calls
  update its status, memory and lead state.
- **It can schedule further calls.** If the person asks to be called back, a
  follow-up is armed and the scheduler will place that call unattended, in the
  configured calling-hours window.
- **It can permanently suppress a number.** An opt-out heard on a call sets
  `do_not_call`, which overrides every later campaign, import and callback.
- **The scheduler ticks every 30 seconds** while the app is running. With
  `DRY_RUN=false` it dials without further confirmation.

`DRY_RUN=true` is the default and exercises all of the above except dialling.

The live scheduler currently rearms failed submissions with a new intent key, including timeouts where CALL-E may already have accepted the call. Campaign dispatch can also advance after an uncertain failure. This is not safe automatic recovery: keep the walkthrough dry-run-only, and stop/reconcile unknown attempts with the provider before enabling another real call or callback. This entry does not qualify unattended live campaigns.

## Cancelling

- **One follow-up:** `POST /api/follow-ups/{id}/cancel`, or the Cancel button
  beside it on `/calls`. It will not be dialled.
- **A campaign:** `POST /api/campaigns/{id}/status {"status": "paused"}`. The
  queue stops handing out contacts immediately; calls already placed run out.
- **Everything:** set `DRY_RUN=true` and restart, or stop the process. The
  scheduler only runs in-process, so nothing is dialled while it is down.
  Armed follow-ups survive in the database and resume when it comes back.
- **A single contact, permanently:** set `do_not_call` on them. Nothing
  overrides it.

A call already in progress is CALL-E's to end; this app cannot hang it up.

## Guardrails

The source combines tested scheduling rules with agent instructions. These are experimental controls, not guarantees about arbitrary conversations or ambiguous provider outcomes:

| | |
|---|---|
| Permanent opt-out | Outranks a callback the same person requested earlier |
| Calling hours | Due callbacks defer to the next window rather than dial |
| No guessed times | An unusable phrase refuses to schedule instead of inventing one |
| No invented facts | The task instructs the agent to use supplied facts; a person must verify consequential claims |
| AI disclosure | Says it is an AI in the opening line; CALL-E rejects tasks that hide it |
| Stale callbacks | A callback missed by six hours reschedules rather than calling cold |
| Bad numbers | Rejected with a row number and reason, never dialled |
| Failed dials | Currently re-armed; ambiguous submissions require manual reconciliation before live retry |
| Webhook trust | CALL-E webhooks are unsigned, so the callback URL carries a secret |

Full detail in [SAFETY.md](https://github.com/uthejitha04/dialtone/blob/master/SAFETY.md).

## Tests

```bash
cd backend && ./.venv/Scripts/python -m pytest -q
```

The author reports 98 tests against a fake model so the suite is free and offline; that count was not independently verified here. They
concentrate on the cases where a mistake reaches a person: that an opt-out beats
a scheduled callback, that a callback time is never guessed, that a failed dial
is re-armed, and that dry run never spends credit.

## Notes

- CALL-E supports English, Hindi and Tamil in India. A call requested in an
  unsupported language falls back to English **and reports the substitution**
  rather than switching silently.
- Sample numbers here are fictional (`+1 555 0100 123`).
- Single-tenant as it stands; auth is stubbed.
