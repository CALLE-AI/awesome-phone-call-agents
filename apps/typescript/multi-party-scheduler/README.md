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
not confirm, nothing is booked and every party who already said yes gets a call
telling them it is off.

## Why two phases

A single pass cannot be correct. If the caller says "you're booked for Thursday"
while asking, then a later refusal leaves a false booking behind. If it never
commits, everyone has to be called again anyway. So availability is gathered
without promising anything, one time is chosen and then commitment is a separate
round that can be rolled back.

The rollback is the part a human coordinator forgets when the day gets long. Here
it is not optional: it is the same code path every time.

## Try it without an account

`npm run demo` runs three coordinations against a local fake CALL-E. No
credentials, no network beyond localhost, nothing rings.

```text
1. Three parties, one time that works, booked
  Asking Marcus Lee (plumber) about 3 options.
    plumber: can do option 1 and 2. 2 options still open.
  Asking Fatima Haddad (tenant) about 2 options.
    tenant: can do option 2. 1 option still open.
  Asking Dana Alvarez (building superintendent) about 1 option.
    superintendent: can do option 2. 1 option still open.
  Everyone can do option 2, Thursday, August 6 at 2:00 PM. Confirming it.

Outcome      booked
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
```

The dashes in that grid are calls nobody made. Every answer narrows the set, so
the next person hears a shorter list and an impossible schedule is found before
the whole list has been dialled.

## Setup

Node 20 or later.

```bash
cd apps/typescript/multi-party-scheduler
npm install
npm run check   # tsc --noEmit
npm test        # 57 tests, no credentials, no outbound calls
npm run demo    # three runs against the local fake CALL-E
```

## Plan, which is the default

```bash
npm run schedule -- plan --request examples/request.example.json
```

Plan prints the options with the times spoken the way the call will read them,
the call order, the worst case and best case call budget and all three call
scripts. It contacts nothing.

## One live run

```bash
export CALLE_API_KEY="<CALL_E_API_KEY>"
npm run schedule -- run --request your-request.json --live --ledger booking.jsonl
npm run schedule -- replay --ledger booking.jsonl
```

Copy `examples/request.example.json`, replace the reserved 555-01xx numbers with
numbers you are authorized to call and put the least flexible person first. The
sooner the set narrows, the shorter every later call.

## The protocol

| Phase | One call per party | What can happen |
| --- | --- | --- |
| gather | "Which of these could you do?" Nothing is booked and the script says so. | An answer narrows the feasible set. An empty set ends the run as `no_common_slot`. A machine, a silence or an API error ends it as `not_reached`. |
| confirm | "Can I confirm Thursday at 2?" One time, one word back. | Everybody confirms and the outcome is `booked`. Anybody does not and the outcome is `not_confirmed`. |
| release | "That time is not going ahead, nothing is booked." | Sent to every party who confirmed, most recent first. A party the release call cannot reach is reported in `unreleased` for a human to chase. |

Two reading rules, both conservative in the same direction. Availability is
credited only when CALL-E's extracted list and this app's own read of the
transcript agree, so a mishearing cannot invent a free slot. A confirmation
requires the transcript to say it and the extracted answer can veto a
confirmation but never create one.

## The ledger and why replay matters

Every call, every narrowing, the chosen slot and every release is one JSON line.
`replay` walks those lines and recomputes the feasible set after each answer, the
slot that choice implies and whether the outcome follows. A ledger that says
Thursday when the recorded answers do not intersect on Thursday fails, which a
plain log cannot catch. The demo ends by widening one recorded answer and showing
replay reject it.

## The request file

| Field | Notes |
| --- | --- |
| `request_id` | Stable per coordination. Part of every idempotency key, so a retried run reuses calls instead of ringing people again. |
| `meeting.purpose` | Read out loud. 120 characters, because a call is not a document. |
| `meeting.timezone` | IANA name, required. Times are spoken in this zone and never inferred from a number or a locale. |
| `slots[]` | Two to four options, each a full ISO 8601 instant with an offset. The offset must agree with the timezone at that instant or the request is refused. |
| `parties[]` | Two to six people, in call order. E.164 numbers, unique ids, unique numbers. |
| `policy.window_minutes` | The whole coordination has to finish inside it. Release calls are exempt: telling somebody it is off is a duty, not part of the booking. |
| `policy.max_calls` | Hard cap. The request is refused when the worst case exceeds it, before any call is placed. |
| `policy.min_confidence` | Floor on CALL-E's task completion confidence. Below it, an answer does not count. |

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | booked |
| 10 | no time works for everyone, which is a real answer |
| 20 | not booked: a party did not confirm, was not reached, the window closed, the budget ran out or CALL-E returned an error |
| 30 | usage or request file error |
| 40 | replay found a problem in a ledger |

## Side effects, cancellation, credentials

- At most one call per party per phase. Nothing recurring is created, so there is
  no schedule to clean up. Stopping the process stops the run and a call already
  connected finishes on the CALL-E side.
- `plan` and `replay` place no calls and need no credentials.
- `CALLE_API_KEY` is read from the environment only, never from the request file.
  `CALLE_BASE_URL` selects the environment.
- Ledgers are appended with mode `0600`. Numbers are masked to the country code
  plus the last two digits and only the decisive turns are kept.

## What it does not do

- It does not negotiate. The call offers the options in the request file and
  nothing else. If somebody proposes a different time, the call notes it, says
  nothing is booked and ends. Inventing a time on a call is how two people end up
  with two different appointments.
- It does not write to a calendar. The outcome is a slot id and a ledger.
- It does not prove who answered. It reaches the number you listed.
- A release call can fail. When it does, the run says so rather than pretending
  everyone was told.

## Reading further

- [`docs/protocol.md`](docs/protocol.md): the phases, the failure table, the
  reading rules and why the budget is checked before the first call.
- [`examples/ledger.example.jsonl`](examples/ledger.example.jsonl): the ledger the
  demo produced, unedited, which replays cleanly.

This is a demo app for a workflow pattern, not a CALL-E SDK and not a supported
product API.
