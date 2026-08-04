# Multi-Party Scheduler

Some appointments need three people in one place and none of them share a
calendar. A tenant, a plumber and a building superintendent. A patient, a
translator and a nurse. A pickup that needs a warehouse, a driver and a broker.
Somebody sits with a phone and works through the list and the failure is always
the same: two people said yes, the third could not make it and the first two
were never told.

This app runs that coordination as a two-phase protocol over CALL-E calls. Phase
one asks each party which of a few options they could do and never says anything
is booked. Phase two confirms exactly one time with everybody. If any party does
not confirm, nothing is arranged and every party who already said yes gets a call
telling them it is off.

What it produces is a verbal confirmation from every party, recorded in a ledger.
It writes to no calendar and creates no booking in any system, so the outcome is
`verbally_confirmed` and never `booked`.

## Why two phases

A single pass cannot be correct. If the caller says "you're booked for Thursday"
while asking, then a later refusal leaves a false booking behind. If it never
commits, everyone has to be called again anyway. So availability is gathered
without promising anything, one time is chosen and then commitment is a separate
round that can be rolled back.

The rollback is the part a human coordinator forgets when the day gets long. Here
it is not optional: it is the same code path every time and `resume` finishes it
even when the process dies half way through.

## Try it without an account

`npm run demo` runs the whole thing against a local fake CALL-E, including a run
that is killed mid-commit and recovered. No credentials, no network beyond
localhost, nothing rings.

```text
1. Three parties, one time that works, confirmed by voice with all three
  Asking Marcus Lee (plumber) about 3 options.
    plumber: can do option 1 and 2. 2 options still open.
  Asking Fatima Haddad (tenant) about 2 options.
    tenant: can do option 2. 1 option still open.
  Asking Dana Alvarez (building superintendent) about 1 option.
    superintendent: can do option 2. 1 option still open.
  Everyone can do option 2, Thursday, August 6 at 2:00 PM. Confirming it.

Outcome      verbally_confirmed
Agreed       option 2, Thursday, August 6 at 2:00 PM
With         plumber, tenant, superintendent
             every party said yes on a call. Nothing is booked in any system.
Calls        6 placed, 2 saved against the worst case

party           opt1   opt2   opt3
plumber         yes    yes    no
tenant          no     yes    -
superintendent  -      yes    -

2. No time works, found on the second call
Outcome      no_common_slot
Calls        2 placed, 6 saved against the worst case

3. The last party pulls out
    superintendent: not confirmed. Releasing everyone who had confirmed.
    released tenant.
    released plumber.
Outcome      not_confirmed

4. A crash between the yes and the release call, then resume
    plumber: confirmed.
    tenant: confirmed.
  the process is killed here

  replay of the crashed ledger: ok=false
   entry 17: no outcome entry, the run did not finish

  Resuming ash-lane-3b-leak: 0 unsettled, 2 owed a release call.
    released tenant.
    released plumber.

Outcome      not_confirmed
Note         resumed an unfinished run, nothing is going ahead

  replay after resume: ok=true, 25 entries, outcome not_confirmed
```

The dashes in that grid are calls nobody made. Every answer narrows the set, so
the next person hears a shorter list and an impossible schedule is found before
the whole list has been dialled.

## Setup

Node 20.6 or later, which is what `node --import` needs.

```bash
cd apps/typescript/multi-party-scheduler
npm install
npm run check   # tsc --noEmit
npm test        # 131 tests, no credentials, no outbound calls
npm run demo    # four runs against the local fake CALL-E
```

## Plan, which is the default

```bash
npm run schedule -- plan --request examples/request.example.json
```

Plan prints the options with the times spoken the way the call will read them,
the call order with each party's calling window, the worst case and best case
call budget and all three call scripts. It contacts nothing. `plan --json` prints
the same request with the phone numbers masked.

## One live run

```bash
export CALLE_API_KEY="<CALL_E_API_KEY>"
npm run schedule -- run --request your-request.json --live --ledger booking.jsonl
npm run schedule -- replay --ledger booking.jsonl
```

Copy `examples/request.example.json`, replace the reserved 555-01xx numbers with
numbers you are authorized to call and put the least flexible person first. The
sooner the set narrows, the shorter every later call.

Ctrl-C cancels a run in flight. No new gather or confirm call is placed, everybody
who already said yes is still called and told it is off and a call that was
already connected is recorded as unsettled because the API has no way to hang it
up. A second Ctrl-C gives up on the release calls too. Nothing is created after the
signal fires, including the reconciliation of an ambiguous create: that one looks
like a lookup and is a create, so if the first request never landed it would start
the very call the cancellation was meant to stop. It is left unresolved under the key
already on disk instead, for `resume` to settle.

## When a run does not finish

```bash
npm run schedule -- resume --request your-request.json --ledger booking.jsonl --live
```

A process can die between the call that got a yes and the call that owes the
apology and a create response can be lost while the call itself goes ahead.
Both leave somebody expecting an appointment that is not happening.

There is a narrower window than either. A call is accepted by CALL-E and the
process dies before the entry that says what the call did. So the two lines that
make a call recoverable are written by the code that places it, not by its caller:
a `call_attempt` line with the exact idempotency key, the attempt number it belongs
to, a digest of the payload that key was taken over and the provider origin and
account it went to, before the create, then a `call_accepted` line with the
id CALL-E returned, before anything waits on the call. A crash in between leaves
the key on disk, usually the call id with it, so the call is still findable.

`resume` reads the ledger, settles every call it cannot account for and places
the release calls that are still owed. A call with an id is settled by asking for
it. A call with no id, which is what a lost create response leaves behind, is
settled by re-issuing the idempotency key the ledger recorded for it: CALL-E
answers with the call it already has or places the one the run owed. That key is
read, never derived a second time, because deriving it reads the call script and
the script lives in this repo: a crash, an upgrade, then a resume would otherwise
send a key CALL-E has never seen and ring a second phone.

Re-issuing a recorded key is only safe while it still stands for the same request to
the same provider, so three things are checked first and any one of them fails the
call closed. The payload digest recorded with the key has to match what this build
would send under it, because when the first request never reached CALL-E the key is
unknown there and the create places a call with whatever body goes out now. The
provider origin and account digest have to match the port in hand, because a key is a
reservation inside one namespace and the same string sent elsewhere creates the call
there while the original stays open. And no new attempt at a call is minted while an
earlier one is unaccounted for.

A call with neither an id nor a recorded key, which only a ledger written by an older
version of this app
can hold, is refused rather than dialled and named in the note for a person to
check. Guessing the key there is the one mistake that rings somebody who may be on
the line already. A gather call nothing settled is named for a person too:
`resume` never gathers again, so there is no call it could place that would finish
one. It never picks a different slot. Once any release call has gone out the
appointment stays off, so a late yes cannot bring it back.

It also refuses to touch a ledger unless the request digest matches. That digest is
taken over the request whole, so an edit to anything, the id included, is a refusal
rather than a second call.

## The protocol

| Phase | One call per party | What can happen |
| --- | --- | --- |
| gather | "Which of these could you do?" Nothing is booked and the script says so. | An answer narrows the feasible set. An empty set ends the run as `no_common_slot`. A machine, a silence or a refusal from the API ends it as `not_reached`. |
| confirm | "Can I confirm Thursday at 2?" One time, one word back. | Everybody confirms and the outcome is `verbally_confirmed`. Anybody does not and the outcome is `not_confirmed`. |
| release | "That time is not going ahead, nothing is booked." | Sent to every party who said yes, most recent first. A party the release call cannot reach or cannot be called inside their hours is reported in `unreleased` for a human to chase. Only a person acknowledging the call on the transcript clears that debt. The extracted answer can veto that acknowledgment but never create one. |

Two reading rules, both conservative in the same direction. Availability is
credited only when CALL-E's extracted list and this app's own read of the
transcript agree, so a mishearing cannot invent a free slot. A confirmation has to
come from the transcript, after the turn where the caller asked the confirmation
question and the extracted answer can veto a confirmation but never create one.
Delivery of a release call follows the same rule, because writing off a debt is
the one place an extraction could quietly decide somebody had been told.

A confirmation also has to have landed in time. The window is checked again when
the result comes back, against the local clock and against the completion time
CALL-E reports, so a late answer and a replayed idempotency key from an older
round are both refused. The completion time is read before either clock: one that
is missing or unreadable is refused as `completion_time_unknown`, with
`completion_time_usable` recorded next to the verdict so a ledger line can never
claim the window was weighed against a time nobody could read. The person may well
have said yes, so that yes still earns the release call.

Who is owed that call is read from the transcript and never from the call status. A
call CALL-E reports as `failed` or `canceled` can still hold the confirmation
question and a yes after it, which is a line that dropped once the person had
agreed. Treating the status as proof that nobody committed would let a provider
error code cancel the one duty this app exists to keep, so the yes counts and the
release call goes out. The outcome then names the check that refused the yes:
`window_expired` only when a window check refused it, otherwise `not_confirmed`
with the reason in the note, so a call that failed is never filed as a timer that
ran out.

## When a call cannot be accounted for

A failure that the server chose to send on the first attempt is definite: no call
was created, so the round carries on. No reply at all, a request timeout, a rate
limit, a conflict on the idempotency key, a server error, a read that fails after
the create got through and a call CALL-E has not finished with are all different.
Any of them can sit on top of a call that is ringing somebody right now.

Those are reconciled, never guessed. The same idempotency key goes back to CALL-E
first, which returns the call it already holds for that key and cannot place a
second one. Getting that call back is the only thing that settles it. Any other
answer, a definite 401 or 403 included, leaves the call `unresolved`, because a
refusal can be decided before the idempotency lookup and so says nothing about the
request that went unanswered. Then the run stops with the outcome `unresolved`, the
ledger records whatever call id is known and the status `unresolved` and the note
names the call to reconcile. Nobody else is called.
That matters most in the confirm phase: a call that might still agree the time
must not be followed by calls telling everybody it is off. Anybody who already
said yes is recorded as owed a call and `resume` places it once the open call is
settled.

Every script refuses the same things: no medical, legal or financial advice, no
payment or card details and anybody who says there is an emergency is told to
hang up and call their local emergency number.

## The ledger and why replay matters

Every call, every narrowing, the chosen slot, every release and every recovery is
one JSON line. `replay` walks those lines and recomputes the feasible set after
each answer, the slot that choice implies and whether the outcome follows. A
ledger that says Thursday when the recorded answers do not intersect on Thursday
fails, which a plain log cannot catch. A terminal outcome that is not a
confirmation has to show every party who said yes either released or named in
`unreleased`. Every line for a call also records the idempotency key it went out
under, which is the only handle on a create whose response was lost. Two of those
lines are written before the call is placed rather than after it comes back, so
replay can also catch the call nobody recorded an answer for: an attempt with no
result behind it means a call may have gone ahead that this history cannot account
for. It is reported by party and phase. One ledger is written by one process at
a time: the run takes an `O_EXCL` lock on `<ledger>.lock` before it dials anybody.

## The request file

| Field | Notes |
| --- | --- |
| `request_id` | Stable per coordination. Part of every idempotency key and bound into the resume digest, so a retried run reuses calls instead of ringing people again and an edited id is refused rather than dialled. |
| `meeting.purpose` | Read out loud. 120 characters, because a call is not a document. |
| `meeting.timezone` | IANA name, required. Times are spoken in this zone and never inferred from a number or a locale. |
| `slots[]` | Two to four options, each a full ISO 8601 instant with an offset. The offset must agree with the timezone at that instant or the request is refused. |
| `parties[]` | Two to six people, in call order. E.164 numbers, unique ids, unique numbers. |
| `parties[].consent_recorded` | Must be `true`. A party without recorded consent to be called about this appointment is refused before any call. |
| `parties[].calling_hours` | `{ "start": "09:00", "end": "20:00", "timezone": "..." }`, checked in that zone before every call including a release call. Defaults to 09:00 to 20:00 in the meeting timezone, which is a floor rather than a guess. A window that wraps past midnight is refused. |
| `policy.window_minutes` | The whole coordination has to finish inside it. Release calls are exempt: telling somebody it is off is a duty, not part of the booking. Calling hours are not exempt. |
| `policy.max_calls` | Hard cap. The request is refused when the worst case exceeds it, before any call is placed. |
| `policy.min_confidence` | Floor on CALL-E's task completion confidence. Below it, an answer does not count. |

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | every party confirmed the time by voice |
| 10 | no time works for everyone, which is a real answer |
| 20 | not confirmed: a party did not confirm, was not reached, the window closed, the budget ran out, the run was canceled, a call could not be accounted for or CALL-E refused the call |
| 30 | usage, request file, ledger lock or resume error |
| 40 | replay found a problem in a ledger |

## Side effects, cancellation, credentials

- At most one call per party per phase. Nothing recurring is created, so there is
  no schedule to clean up.
- Ctrl-C cancels a run in flight: no new gather or confirm call, the release calls
  still go out and a call already connected is recorded as unsettled because the
  API has no cancel. `resume` settles it.
- `plan` and `replay` place no calls and need no credentials.
- `CALLE_API_KEY` is read from the environment only, never from the request file.
  `CALLE_BASE_URL` and `--base-url` select the environment and both are checked
  before the key is sent. The host has to be `api.heycall-e.com`. A local fake may
  use `localhost`, `127.0.0.1` or `::1`. Any other host has to be named in
  `CALLE_ALLOWED_HOSTS` or with `--allow-host`. Names are matched exactly, with no
  suffix match and no wildcard. An opted in host still has to be https, because
  https on its own is not trust: it says the wire is encrypted, not who answers.
  Anything else is refused rather than warned about.
- Every idempotency key carries a short sha256 of the call payload and the attempt
  number it belongs to, so a call is reused only when it would say the same words and
  a retry is a call the provider has never seen. The key goes into the ledger with
  the call, beside the payload digest and the provider it was sent to and `resume`
  sends that exact string back only while all three still hold, so recovery cannot
  invent a new key after the scripts have moved on or replay an old one somewhere
  else.
- Ledgers are appended with mode `0600`, re-applied on every append rather than
  only when the file is created. A target that is not a regular file is refused.
  Numbers are masked to the country code
  plus the last two digits, in `--json` output too and only the decisive turns
  are kept.

## What it does not do

- It does not book anything. There is no calendar write and no booking adapter, so
  the best outcome is `verbally_confirmed`: every party said yes on a call and the
  ledger records who said it and when.
- It does not negotiate. The call offers the options in the request file and
  nothing else. If somebody proposes a different time, the call notes it, says
  nothing is booked and ends. Inventing a time on a call is how two people end up
  with two different appointments.
- It does not prove who answered. It reaches the number you listed.
- A release call can fail. When it does, the run says so rather than pretending
  everyone was told.
- It cannot hang up a call that is already connected. The API has no cancel, so a
  canceled run records that call as unsettled instead of guessing what it said.

## Reading further

- [`docs/protocol.md`](docs/protocol.md): the phases, the failure table, the
  reading rules and why the budget is checked before the first call.
- [`examples/ledger.example.jsonl`](examples/ledger.example.jsonl): the ledger the
  demo produced, unedited, which replays cleanly.

This is a demo app for a workflow pattern, not a CALL-E SDK and not a supported
product API.
