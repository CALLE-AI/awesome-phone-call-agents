# Ethics and calling controls

Callibrate phones small organizations that are usually busy and often staffed by
volunteers. The controls below exist because a verification system that is
unpleasant to receive will be blocked, and a blocked number verifies nothing.

## Before the call

CALL-E is integrated **behind** these gates, not around them. If any refuses, no
plan is created and no telephone rings. They are checked in the order they are
cheapest to fail.

1. **Destination allowlist.** `CBR_CALL_ALLOWLIST` names every number this
   deployment may reach. It is empty by default, which means a fresh install
   cannot place a live call at all. Production refuses to start with live
   calling and an empty allowlist.
2. **Permanent suppression.** One "stop calling" sets `do_not_call` on the
   organization, which covers every service it runs, forever, and cannot be
   cleared by any automatic path.
3. **Recorded consent**, with a validity window, a day-of-week set, and a local
   time window evaluated in the organization's own timezone. "Not before nine"
   means nine where the phone is.
4. **A call cap** carried by the consent record and decremented in the same
   transaction that reserves the call, so two workers racing for the last
   consented call cannot both win it.
5. **Spacing.** An organization is left alone for at least
   `CBR_MINIMUM_CALL_INTERVAL_DAYS` after any call to it. Zero is allowed only
   outside production, so a sandbox can be demonstrated repeatedly; a queue with
   no memory of who it just phoned will phone the same small charity every
   morning.

A refusal is written to the ledger as `call.refused` with its reason.

## Who may ask

The gates decide whether a number may be called. A separate question is who may
spend that permission, because *Verify before I go* is the one thing in the
product a stranger can press. A deployment that can dial a real number takes
anonymous requests only when its operator has said so
(`CBR_ALLOW_PUBLIC_VERIFICATION=true`); otherwise a visitor's press is refused
before a task exists, and a curator runs the call from the queue instead. Where
the route is open, a deployment-wide daily budget bounds the anonymous crowd, on
top of a per-address limiter that only ever slowed one caller down.

What a visitor is told afterwards is the record's own new value and a sentence
of progress. The transcript names a person who answered a phone, and it is read
by curators, not by whoever pressed the button.

## During the call

The instruction CALL-E is given is generated from the contract, shown in full in
the console before anybody agrees to place the call, and printable with
`callibrate contract <task>`. It requires:

- **Disclosure first.** The agent says it is an automated assistant calling on
  behalf of the directory in its first sentence, before it asks anything. A
  transcript whose first turns contain no disclosure is a `STOP`.
- **No invented values.** The agent never proposes a value the provider did not
  say, and never accepts one it has not heard them say.
- **A readback in full.** A new value is said back in whole words, and the
  provider is asked to confirm it before the call moves on.
- **Positive questions.** "Is that still right?", never "is any of that out of
  date?", so a yes means yes to software that cannot hear tone.
- **Four immediate endings.** A request not to be called again; a person looking
  for help rather than working there; distress or a wrong number; or a closure.
  On a closure the agent thanks them and stops. It does not press for
  confirmation of a closure, and it does not ask follow-up questions about it.

## After the call

- **Transcripts are redacted before storage.** Phone numbers and email addresses
  are masked by `privacy.redact_pii` on the way in.
- **No audio is kept.** The stored record is the text a curator will read, which
  is also the text the evidence rules ran on, so a verdict is reproducible from
  what the ledger holds.
- **One consequence is stated rather than worked around.** Redaction masks phone
  numbers, so a phone readback cannot be corroborated from the record. A phone
  change from a live call therefore always reaches a person. The alternative
  would be storing unredacted numbers to make an automatic write easier, which
  is the wrong trade.

## What software is never allowed to do

- **Remove a service.** Every removal, closure and status change is a human
  decision, whatever the call established. A removal strands the person who
  needed it most.
- **Change eligibility.** A wrong eligibility line sends somebody to be turned
  away at a door.
- **Delete a field.** `_apply_change` refuses a null value outright. There is no
  automatic path to an empty field.
- **Write around the validators.** A curator's approval and an automatic change
  go through the same `_apply_change`, so a curator typing a malformed phone
  number is refused for the same reason the policy would refuse it.
- **Edit the ledger.** The `audit_events` table carries triggers that abort any
  UPDATE or DELETE, and every row carries the hash of the row before it.

## For the person on the other end

The provider gets one short call, in which somebody says what they are and why
they are calling, reads back what they heard, and takes no for an answer. The
second half of the Open Referral thesis is why that is worth their two minutes:
they are asked once, and the answer is published for every directory, agency and
helpline that reads the record, rather than each of them phoning separately.

## Claims discipline

The default caller is the **pilot line**, and it is never described as anything
else. It is labelled `pilot-line` in the ledger, the console badge reads
`pilot line · no telephone`, and the demonstration film says so. What a pilot
run proves is the evidence rules, the policy, the write path and the ledger,
which are the production ones either way. What it does not prove is how a real
provider speaks, and no figure in this repository is presented as if it did.
