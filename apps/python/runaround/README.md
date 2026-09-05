# Runaround

**Two organizations each say the other one is responsible. Runaround calls them
in turn, records who sent the request where in their own words, and stops with
proof the moment the referrals close on themselves.**

Every consequential phone task in this repository assumes that somewhere on the
other end there is a desk that owns the request. Often there is not. The retailer
says it is the carrier's claim; the carrier says it is the shipper's claim; the
insurer says talk to the clinic and the clinic says talk to the insurer. The
question never gets answered and nobody ever refuses to answer it, which is why
the person chasing it has nothing to escalate.

Runaround treats that as the primary case rather than an error path. The unit of
work is not a call, it is a **referral edge**: one desk, the desk it named, and
the sentence that named it. A chain of those edges either reaches an owner or
closes on itself, and closing on itself is a finding, not a failure.

```text
  ORD-8472 damaged
        │
        ▼
  Example Retail (+1*****00) ──"damage in transit is the carrier's claim"──┐
        ▲                                                                  │
        │                                                                  ▼
        └──"the box was packed by the shipper, the claim is theirs"── Example Freight (+1*****11)

  loop_detected after 2 calls: +1*****00 -> +1*****11 -> +1*****00
  evidence pack: both sentences, both dates, numbers masked
```

## Two rules do the work

**A referral advances the chain only when the words that gave it come with it.**
`referral_target_phone` without `referral_quote` is refused as
`unverified_referral` and the case goes to a person. A number with no sentence
behind it is an extraction artifact, and dialling it means calling a stranger on
the strength of a guess.

**A number spoken on a call is not permission to dial it.** The desk you
authorized is the desk you authorized. When a call names a new destination the
case stops at `awaiting_approval` and waits for `runaround approve`. This is the
difference between an agent that chases a question and an agent that walks
outward through the phone book on its own.

Everything else follows from those two:

| Situation | What Runaround does |
| --- | --- |
| Referral points at a desk already called | `loop_detected`, chain stops, loop path recorded |
| Desk gives its own number back | `self_referral`, chain stops |
| Desk tells you to call yourself | `referred_to_requester`, chain stops |
| Same organization name, a different number | `loop_suspected` — a person decides, because names are not identities |
| Desk owns it but did not answer today | `owner_without_answer`, not a resolution |
| Call failed, or the result did not validate | `unreachable` — never read as "no referral" |
| Hop budget spent | `budget_exhausted` |

The number `+1 (555) 010-0` and the number `+15550100` are the same desk. Loop
detection normalizes to E.164 in one place (`runaround/phone.py`), so a chain
cannot be hidden by punctuation a receptionist read out differently.

## Quick start — no calls, no API key

```bash
cd apps/python/runaround
python3 -m runaround --data ./demo-data init-demo
python3 -m runaround --data ./demo-data plan parcel-8472
python3 -m runaround --data ./demo-data run parcel-8472 \
    --mode fixture --fixture fixtures/chain_loop.json
python3 -m runaround --data ./demo-data approve parcel-8472
python3 -m runaround --data ./demo-data run parcel-8472 \
    --mode fixture --fixture fixtures/chain_loop.json
python3 -m runaround --data ./demo-data evidence parcel-8472
```

Fixture mode is the default and places no calls. `fixtures/chain_resolved.json`
runs the same case to an owner who accepts the claim;
`fixtures/chain_unquoted_referral.json` shows the chain refusing a number that
arrived without words. All fixture numbers are NANP fiction-reserved `555-01xx`.

Python 3.10 or newer, standard library only. No third-party dependency, at
runtime or for the tests.

## Tests

```bash
python3 -m unittest discover -s tests -t . -q
```

57 tests. None of them opens a socket: the CALL-E transport is injected, so the
adapter is exercised against recorded responses, including the poll ceiling and
the documented error codes.

## Live path (opt-in, rings a real telephone)

```bash
export CALLE_API_KEY=...
python3 -m runaround --data ./data run <case_id> \
    --mode live --once --i-understand-this-calls-people
```

`--mode live` alone is not enough; without the acknowledgement flag the command
exits before building a request. Use `--once` while you are learning what a case
does, so one command is one call.

The base URL is pinned. `CALLE_BASE_URL` exists for a future official host, but
`assert_approved_origin` compares the parsed hostname against an allow-list, so
`api.heycall-e.com.evil.example` cannot receive the bearer token by ending in
the right letters.

## What it does to CALL-E

Contract source: `https://docs.heycall-e.com/openapi/calle.openapi.yaml`
(CALL-E Developer API 0.6.0).

- `POST /v1/calls` — one recipient, one hop, with `result_schema` describing the
  seven fields the chain reads back, and an `Idempotency-Key` derived from
  `case_id + hop_index + destination`. The key comes from the authorization to
  place the hop, not from the attempt, so a retried timeout returns the original
  call instead of ringing a person twice.
- `GET /v1/calls/{call_id}` — polled until `completed`, `failed`, or `canceled`.
- A poll ceiling that is reached raises rather than returns. The call may still
  be running; its outcome is unknown, and an unknown outcome must be reconciled
  by a person before the case dials anyone again.

The task text is assembled by code, never written per case, so every hop
discloses automation the same way and closes with the same two questions. From
the second hop on it carries the chain history verbatim: a desk that hears *"two
people have already sent me here, and here is what they said"* answers a
different question than a desk that hears the request cold.

## Side effects, cancellation, and state

- One `run` places at most `hop_budget` calls (default 4) and stops at the first
  approval gate. `--once` places at most one.
- The case file under `--data` is the only durable state. It is written before
  the call and again after it, so an interrupted run shows a call that may have
  happened rather than no record at all.
- `runaround stop <case_id> --reason ...` ends a case immediately. A stopped or
  terminal case refuses to place another call.
- Nothing recurs. There is no scheduler, no retry timer, and no background job.
  A call happens because someone ran a command.

## Safety

- The agent discloses that it is an AI assistant in its opening line.
- It is instructed not to accept, decline, or negotiate any offer, settlement,
  payment, appointment, or commitment, and not to press a person who declines.
- Phone numbers are masked to `+1*****00` in previews, status output, and the
  evidence pack. The full number appears in the call request and the case file,
  because the next hop has to dial it.
- Destination authorization is per desk and recorded per hop
  (`intake` or `approval`), so the evidence pack shows who let each call happen.
- See [`docs/referral-authorization.md`](docs/referral-authorization.md) for why
  a number given on a call is treated as a claim rather than a permission.

## What this does not establish

The evidence pack records what was said on a call to the number shown. It does
not verify who said it, their authority to say it, or whether the organization
would repeat it. A detected loop proves two desks each named the other on the
dates shown — which is exactly what a complaint needs and exactly as far as a
phone call can go.
