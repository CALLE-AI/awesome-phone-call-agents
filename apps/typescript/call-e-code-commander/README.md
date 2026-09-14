# CALL-E Code Commander

> An on-call escalation commander that phones your engineers, explains the incident in conversation, and returns their spoken decision as typed JSON.

Production breaks at 03:00. Your alerting tool fires a push notification into a silenced phone, then another, then a robocall that reads an error code at a person who is not yet awake enough to parse it. Nothing moves until somebody eventually opens a laptop and starts reading dashboards.

CALL-E Code Commander replaces that with a phone call that can actually hold a conversation. It rings the primary on-call, explains what broke and who is affected, answers the questions the engineer asks back, and leaves the call with one explicit authorised action. If nobody picks up, it climbs the rota and tells the next person why they are being woken instead of the primary.

The decision extracted from that conversation is the only thing in the system that can change production.

---

## Why this is phone work

Three properties of an incident page make it a phone problem rather than a notification problem, and all three are things a chat message cannot do.

**It has to wake someone up.** A ringing phone is the only channel that reliably interrupts a sleeping human, which is why every serious on-call rota still ends in a phone call.

**It has to answer questions.** The first thing a woken engineer says is "how bad is it?" A recorded announcement cannot answer that. CALL-E is given the incident facts and answers from them, and says plainly when it does not know something rather than inventing an answer.

**It has to produce an accountable decision.** "Did anyone approve this deploy?" is the question every post-incident review asks. Here the answer is a structured record: who was reached, on which number, what they authorised, in their own words, and how confident the extraction was.

---

## How it works

```text
 Production alert
        │
        ▼
 ┌──────────────────────────────────────────────┐
 │  Investigation council (runs unattended)     │
 │   1. Triage        2. Root cause             │
 │   3. Patch         4. Sandbox verification   │
 └──────────────────────────────────────────────┘
        │  patch staged, production UNCHANGED
        ▼
 ┌──────────────────────────────────────────────┐
 │  5. HUMAN AUTHORISATION GATE                 │
 │     the pipeline stops here                  │
 └──────────────────────────────────────────────┘
        │
        ▼
 CALL-E escalation ladder
   rung 1  primary on-call  ──answered & authorised──┐
     │                                               │
     │  ┌── "give me ten minutes" ──┐                │
     │  │   ladder waits, does NOT  │                │
     │  └── climb, then calls back ─┘                │
     │                                               │
     │ no answer / no decision                       │
   rung 2  backup on-call   ──answered & authorised──┤
     │ no answer / no decision                       │
   rung 3  engineering manager ─────────────────────┤
     │ rota exhausted                                │
     ▼                                               ▼
  deploy BLOCKED                          deploy / rollback / hold

 Every terminal call state is also delivered to a webhook receiver and
 re-read from the API, so the ladder above survives the browser tab that
 started it.
```

The council can investigate, write a patch, and prove it green in a sandbox on its own. It cannot ship. Step 5 is a hard stop, and the only key that opens it is a decision spoken by a human on a CALL-E call.

### The ladder's stopping rules

The ladder climbs on silence and stops on a human. Five rules decide which:

| What came back | What the ladder does |
| --- | --- |
| The named engineer authorised a change | Stops. The change is applied. |
| The named engineer said hold for review | Stops. A held decision is still a decision, so the backup is not woken. |
| The named engineer asked for time | Waits, then calls **that person** back. The rota is not climbed. |
| Voicemail, a colleague, a low-confidence extraction, or a failed call | Climbs to the next rung. |
| The rota ran out | Stops. The deploy is blocked. Silence is never consent. |

Only the third row involves calling the same person twice, and it happens because they asked for it on the first call.

---

## CALL-E platform usage

| Capability | Where it is used |
| --- | --- |
| `calls.create` | Places each rung of the escalation ladder |
| `recipient_result_schema` | Extracts the spoken decision as typed JSON |
| `Idempotency-Key` | Derived from incident and contact, so a retry never double-dials. An agreed callback carries an explicit attempt number, so the one call that should dial twice is a different request |
| `callback_minutes` | An engineer who asks for ten minutes gets a callback, not an escalation past them |
| `metadata` | Carries incident ID, service, severity, and rung through to webhooks |
| `calls.get` | Drives live rung state: queued, dialling, in progress, completed |
| `calls.listEvents` | Streams developer events into the incident timeline |
| `webhook_url` | Terminal call state is delivered to a receiver, so an escalation survives a closed tab |
| `call.result_validation_failed` | A structured result that failed schema validation fails closed like any other unusable call |
| `completion_confidence` | A low-confidence extraction escalates instead of shipping code |
| `transcript_turns` | Mirrored into the transcript pane and the post-mortem |
| `evidence` | Attached to the post-incident review |
| `region` / `locale` | Resolved from published coverage, so routing is not left to chance |
| Stable error codes | Branching on `unsupported_region`, `insufficient_balance`, and the rest, not on HTTP status |

### The decision schema

This is the contract that turns a conversation into an action. It lives in `src/agents/calleService.js`.

```js
{
  type: 'object',
  required: ['answered_by', 'decision'],
  additionalProperties: false,
  properties: {
    answered_by:           { type: 'string', enum: [
                               'named_engineer', 'different_person',
                               'voicemail_or_ivr', 'no_answer', 'unknown' ] },
    decision:              { type: 'string', enum: [
                               'deploy_hotfix', 'hold_for_review',
                               'rollback_release', 'escalate_to_backup',
                               'no_decision' ] },
    reason:                { type: 'string' },
    acknowledged_severity: { type: 'string', enum: ['yes', 'no', 'unknown'] },
    callback_minutes:      { type: 'integer' },
    questions_asked:       { type: 'array', items: { type: 'string' } }
  }
}
```

`answered_by` is an enum rather than a boolean, following CALL-E's own schema
guidance to prefer string enums with an explicit `unknown` value for judgements
that may be unclear. It matters here more than anywhere else: only
`named_engineer` can authorise a deploy. A voicemail greeting, an automated
menu, a colleague who picked up the on-call phone, and an answer the extraction
model could not classify all fail closed and climb the ladder instead.

---

## Safety rules

These are enforced in code, not just described.

**Nothing ships without the named engineer.** `interpretDecision` grants authorisation only when `answered_by` is `named_engineer` and the decision is one that authorises a change. Voicemail, a different person, and an unclassifiable answer all escalate instead.

**Coverage is checked before a credit is committed.** A valid E.164 number does not establish that its destination is supported, so every rung is resolved against CALL-E's published regions first, and the recipient's `region` and `locale` are set from that table. An uncovered destination is refused in the dialog rather than failing as `unsupported_region` after the call is accepted.

**Completion confidence corroborates, it never authorises.** CALL-E documents `completion_confidence` as confidence in its own task-completion judgment, explicitly not in the business answer, and states that a high score does not establish that a person answered. So the authorisation comes from `answered_by` and `decision` in the structured result. Confidence and `task_completed` can withhold a deploy, never grant one.

**An unanswered rota fails closed.** Exhausting the ladder blocks the deploy. Silence is never read as consent.

**A webhook delivery is a notification, never evidence.** The SDK ships signature helpers and marks both deprecated, stating the reason: current CALL-E deliveries are not signed and carry no signature headers. So a POST to the receiver is unauthenticated traffic from the public internet, and its body contains a complete call task including a structured result that says who answered and what they authorised. Reading a deploy authorisation out of that body would let anyone who guessed the URL ship code by sending a JSON document. The only field taken from a delivery is the call id. Everything recorded is then re-read from the API with the server key and interpreted by the same `interpretDecision` the ladder uses, so a forged delivery supplies no facts.

**The hosted demo cannot be used to dial a stranger.** A proxy that attaches a credential is an open relay unless it is narrow: this one forwards three call routes and nothing else on the account, requires an incident correlation id, rate limits placement separately from polling, and on a public deployment will only ring numbers its owner nominated. An unconfigured deployment refuses every call rather than allowing every call. A local dev server dials whatever you type, because it holds your key and rings your phone.

**A ringing phone is not shown as a person on the line.** The Calls API reports an attempt as `in_progress` from the moment it starts dialling, so that status alone never turns a rung green. The connected state waits for a transcript turn spoken by the recipient, which is the earliest evidence that anybody is actually talking.

**A rung that was never dialled is not recorded as unanswered.** When CALL-E refuses to place a call, no phone rang, and the post-mortem says so rather than reporting an unanswered rota. The deploy stays blocked either way.

**A failed call is recorded for what it was.** `failure_code` has no published enum and the platform warns against reading a decline or a no-answer out of it, so it is preserved for support and never interpreted. The structured result is separate evidence, so when a failed call still carries a schema-valid `answered_by`, that is what the audit trail records. A failed call can never authorise anything regardless of what it says.

**A human hold stops the ladder.** If the primary says "hold it, I want to read the diff", the backup is not woken.

**Asking for time is a decision, and it is honoured.** An engineer who says "give me ten minutes" has not failed to decide. They have decided to look before deciding, which is the right answer to being woken at 3am and asked to change production. The ladder waits and calls them back rather than waking their colleague, and the callback opens by saying it is the call they asked for instead of reading the same script again. One deferral per person: a second is a decision that is not coming, so the ladder climbs. The wait is capped at thirty minutes, because a live incident cannot wait on an optimistic estimate, and the shortfall is announced rather than hidden.

**The call never asks for credentials.** The task prompt forbids requesting passwords, tokens, or one-time codes, and instructs CALL-E to end the call without giving incident detail if anyone other than the named contact answers.

**Retries do not re-dial.** The idempotency key is derived from the incident and contact IDs, never from a timestamp. An agreed callback carries an explicit attempt number in that key, so the one call that should dial the same person twice is a different request while every accidental redial is still refused. An attempt number never comes from a clock: attempt 2 exists because an engineer asked for it.

---

## Surviving the closed tab

Polling from a browser works while somebody is watching the browser. For a tool
whose entire job is 3am, "it works while you watch it" is not a property worth
having. A laptop lid closes, a phone discards a tab, a train enters a tunnel, and
an escalation that was mid-climb stops existing.

So calls are created with a `webhook_url`, and CALL-E posts terminal call state
to a receiver. The outcome is recorded server-side against the incident id in the
call metadata, and the page reads it back when it returns.

**The delivery is a notification, never evidence.** This is the part worth
reading the code for. The SDK ships webhook signature helpers and marks both of
them deprecated, stating the reason plainly: current CALL-E deliveries are not
signed and carry no signature headers. So a POST to the receiver is
unauthenticated traffic from the public internet, and its body contains a
complete call task, including a structured result naming who answered and what
they authorised.

Reading a deploy authorisation out of that body would mean anybody who guessed
the URL could ship code to production by sending a JSON document.

The only field taken from a delivery is the call id. Everything recorded is then
re-read from the CALL-E API with the server key, over a connection the account
authenticates, and interpreted by the same `interpretDecision` the ladder uses. A
forged delivery for a call that does not exist reads back as nothing. A forged
delivery naming a real call reads back the outcome that was already true. Either
way the sender supplies no facts.

Reusing `interpretDecision` rather than writing a second one is deliberate. A
separate implementation of "may this authorise a deploy" living in the webhook
path is how a system ends up with a back door more permissive than its front
door.

`CALLE_WEBHOOK_TOKEN` adds a shared secret to the receiver URL. It is a spam gate
and it is documented as exactly that: it travels in a URL, so it is not
authentication, and nothing in the trust model rests on it.

---

## What the review gets

Two numbers and one file, because a post-incident review is where an on-call tool
is actually judged.

**Time from page raised to human decision.** Measured from the page, not from a
call connecting, so an unanswered first rung counts against it. That is the
honest reading: production was undecided for that whole time. An alerting tool
cannot produce this number at all, because a notification has no end state to
measure to.

**Every rung, not only the one that answered.** "The primary reached voicemail at
03:12" is a finding about the rota, and it disappears from any record that only
keeps the successful call.

**The trail as a file.** The post-mortem exports a JSON audit record: who was
reached, on which number, what they authorised in their own words, at what
confidence, which call id it came from, how long each call took, and whether a
callback was agreed or ended early by an operator. It says whether the run was
live or simulated in its own first field, because the file outlives the
interface that labelled it on screen. It records what happened and draws no
conclusions.

---

## Running it

### Requirements

Node.js 18 or newer.

### Install and test

```bash
npm install
npm test        # 50 tests, no network or credits required
npm run dev     # http://localhost:5173
```

### The custom code playground

Pick the custom incident from the feed and paste your own broken code. A static
scanner runs over it and reports what it actually matched, with real line numbers
and the matched text as evidence, at a stated confidence per rule.

It does not generate a patch, and the panes that would show one say so. Putting a
confident, wrong diff in front of an engineer during an incident is worse than
showing nothing, so the scanner reports findings and hands the judgement back.
When nothing matches, it says nothing matched.

### Simulation mode

Leave the API key blank and page the rota. The ladder runs as a clearly labelled
simulation, and it runs the whole shape of a real escalation: rung 1 reaches
voicemail, rung 2 answers but asks for ten minutes to read the diff, the ladder
waits and calls them back instead of waking the manager, and the callback
authorises. No phone rings and no credits are spent. The wait is compressed,
which is said out loud in the interface and in the terminal rather than left to
look like ten minutes passed. Every surface that shows a simulated result says
so.

### Live mode

CALL-E's SDK is a server SDK and its guidance is that keys must not be sent to
browser code, so there is no key field in the app at all. The key is read from
the server environment and never reaches the page.

Create a `.env` file in the project root:

```bash
CALLE_API_KEY=iams_live_your_key_here

# Optional, and the rota can also just be typed into the dialog.
CALLE_ROTA_PRIMARY_NAME=Priya Raman
CALLE_ROTA_PRIMARY_PHONE=+919876543210
CALLE_ROTA_BACKUP_NAME=Sam Okoro
CALLE_ROTA_BACKUP_PHONE=+14155552671
```

The rota is read on the server and prefilled into the dialog, where it can be
changed before anything is dialled. It is kept in `.env` rather than in source
for the same reason a rota is not usually checked in: those are real people's
mobile numbers, and this repository is public. A fresh clone starts with empty
fields. Anything already typed into the dialog in this browser wins over the
seed, because replacing a number that is about to be dialled would be worse
than showing none.

Then start the app normally:

```bash
npm run dev
```

The dev server prints which mode it is in at startup and exposes a small proxy
at `/api/calle` that attaches the Authorization header on the way out. The
page asks the server which mode it is in and shows a banner saying whether a
real phone can ring. Requests leaving the browser carry no credential.

With no key configured the app runs a clearly labelled simulation instead. No
phone rings, no credits are spent, and nothing has to be typed into the page.

`.env` is gitignored. `.env.example` shows the expected shape.

Get a key from the [CALL-E dashboard](https://dashboard.heycall-e.com/account/api-keys).
Production keys start with `iams_live_`. Verify the whole loop from the
terminal before you rely on it:

```bash
node scripts/verifyLiveCall.js +14155552671 iams_live_...
```

That places one real call, prints the resolved region, the structured decision
it extracted, and a coverage table of which API fields CALL-E returned. It exits
non-zero if no structured decision came back.

The script reads the same `.env`, so once the file exists both arguments can be
dropped. With none, it dials the seeded rung 1 contact by name, which is the
destination the web app would dial first:

```bash
node scripts/verifyLiveCall.js
```

### Deploying it

A production build is static files, so a plain static host has no server to hold
the key and the page falls back to a labelled simulation. That is safe, but a
reviewer opening the link never sees a phone ring.

`api/calle/` holds the same proxy as serverless functions, so a deployed copy
behaves like a local one. On Vercel, import the repository, set `CALLE_API_KEY`
in the project's environment variables, and deploy. Add the `CALLE_ROTA_*`
variables if you want the hosted rota prefilled too.

The key lives in the hosting provider's environment and is never in the bundle.
Confirm which mode a deployment is in by opening `/api/calle/mode`: it reports
whether a server key is present, how many destinations the deployment may ring,
and whether a webhook receiver is configured. It never returns the key, and it
never returns the numbers themselves.

**A public deployment needs one more variable than a local one.** A hosted copy
is reachable by anyone with the link, and the proxy behind it signs every
request with your key. So the deployed function will only ring numbers you
nominated: the `CALLE_ROTA_*` phones, plus anything in
`CALLE_DEMO_ALLOWED_NUMBERS`. With neither set it refuses every call rather than
becoming an anonymous dialler on your balance. Simulation mode still runs the
whole ladder for anybody, which is what a visitor who types their own number
gets, and the banner says so before they press the button rather than after.

To let the escalation outlive the browser tab, set `CALLE_WEBHOOK_URL` to
`https://your-deployment/api/calle/webhook`. Calls are then created with that
`webhook_url`, and terminal state is delivered to the receiver whether or not
anyone is still on the page. Add `CALLE_WEBHOOK_TOKEN` to keep unsolicited
traffic out of it, and read `api/_lib/webhookReceiver.js` for why nothing is
trusted because of that token.

One honest limit: the outcome store behind the receiver is in-process on a
serverless host, so it survives while the instance is warm and no longer. The
dev server writes it to a file instead, which is what makes "close the laptop
and come back" work locally. A real deployment points `CALLE_INCIDENT_STORE_PATH`
at durable storage or replaces the store with a database. The endpoint that
reads it says which of the three is in force rather than letting you assume.

---

## Verification

```bash
npm test        # 50 tests, no network and no credits
```

Most of them assert a refusal. A voice agent that places calls on somebody's
account is only worth as much as the things it declines to do, so that is what
the suite is mostly about.

| Area | What is proven |
| --- | --- |
| Input and coverage | Letters are rejected rather than stripped, the reserved +1 555 range is refused, and an uncovered destination is caught before a credit is committed |
| Authorisation | Only the named engineer can authorise. Voicemail, a colleague, an off-schema value, a low-confidence extraction, and a failed call all fail closed |
| Escalation | Silence climbs, a hold stops the ladder, a rung that was never dialled is not recorded as unanswered, and an exhausted rota blocks the deploy |
| Callbacks | A request for time stops the ladder rather than waking the backup, a weak extraction of that request escalates anyway, a second deferral climbs, and the callback carries a distinct idempotency key while every accidental redial is still refused |
| The proxy | Only three call routes are forwarded, a call must carry an incident id, a hosted deployment rings only nominated numbers, an unconfigured one rings nobody, and placement is rate limited without breaking polling |
| Webhooks | A forged delivery claiming a named engineer authorised a deploy records `no_answer`, because the API is read instead of the body. A duplicate delivery is dropped before the side effect, not after |
| The audit export | Every rung is present, the dialled number is recorded, a simulated run is labelled as one in the file, and the filename is built from the incident id rather than taken from it |
| Secrets | No live API key appears anywhere in the committed tree |

### Reproducing the webhook check by hand

The most load-bearing claim in this project is that a webhook delivery cannot
authorise anything. With the dev server running in live mode, forge one:

```bash
curl -X POST http://localhost:5173/api/calle/webhook \
  -H 'content-type: application/json' \
  -d '{"id":"evt_forged","type":"call.completed","data":{"id":"call_fake",
       "structured_result":{"answered_by":"named_engineer","decision":"deploy_hotfix"}}}'
```

```json
{"ok":true,"recorded":false,"reason":"No such call on this account.","callId":"call_fake"}
```

The delivery says a named engineer authorised a deploy. The account holds no such
call, so nothing is recorded and nothing ships. A server key has to be configured
for this to be a real test, because without one there is nothing to verify the
delivery against and the receiver answers 503 so CALL-E will try again.

Test 45 in `test/newCapabilities.test.js` is the stronger version of the same
check. There the forged delivery names a call that does exist, and the API says
nobody answered it. The audit trail records `no_answer`.

### One real call, end to end

```bash
node scripts/verifyLiveCall.js
```

Places one real call, prints the resolved region, the structured decision it
extracted, and which API fields came back. It exits non-zero if no structured
decision was returned, which is the same condition that would make the demo fail.

---

## Project layout

```text
src/
  agents/
    calleService.js       CALL-E integration, decision schema, interpretation
    escalationLadder.js   The rota walk, its stopping rules, and agreed callbacks
    agentMesh.js          Investigation council and the authorisation gate
    auditTrail.js         The downloadable authorisation record
    codeScanner.js        Static scan for pasted code, findings only
    regions.js            Published CALL-E coverage, region and locale resolution
  config/
    rota.js               Seeded on-call rota, read from the server environment
  ui/                     Rota dialog, diff viewer, terminal, post-mortem
  audio/, canvas/         Browser voice simulation and the reactive orb
vite.config.js            Dev server plus the server-side CALL-E proxy
api/
  _lib/proxyGuard.js      Route allowlist, recipient allowlist, rate limits
  _lib/webhookReceiver.js Delivery handling, and why a delivery is never believed
  _lib/incidentStore.js   Terminal outcomes, so an escalation outlives the tab
  calle/                  The proxy, mode, webhook, and incident endpoints
scripts/
  verifyLiveCall.js       One real call, end to end, from the terminal
test/
  calle.test.js           35 tests covering validation, decisions, escalation, scanning, coverage
  newCapabilities.test.js 15 tests covering the proxy guard, callbacks, webhooks, and the audit export
```

---

## Limitations

The three built-in incident scenarios carry authored root causes and patches. They are fixtures standing in for the upstream tooling an incident feed would provide, not live analysis of your repository.

The custom code path is different: it runs a real scan and reports only what it found. It is a pattern scanner, so it recognises a fixed set of fault classes and will miss anything outside them. Every finding states its own confidence, and the low-confidence heuristics say so.

The webhook receiver's outcome store is in-process on a serverless host, so a
deployed copy remembers a finished escalation only while that instance stays
warm. The dev server writes it to a file. Neither is a database, and the endpoint
that reads it says which one is in force rather than implying durability it does
not have.

The per-address rate limit is held in the same process, so a host running several
instances counts each separately. It bounds a burst rather than guaranteeing a
global ceiling, which is why the recipient allowlist is the control that actually
stops an unwanted call.

Everything downstream of the authorisation gate is real: the call, the conversation, the structured extraction, the escalation, the callback, and the refusal to deploy without a human.

## License

MIT
