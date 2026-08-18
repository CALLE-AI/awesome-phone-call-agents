---
name: caucus-mediation
description: Mediate a two-party money dispute (security deposit, unpaid invoice, freight detention) through neutral, consent-first CALL-E phone calls driven by the Caucus MCP server. The workflow shuttles offers between the parties in alternating rounds, confirms any agreement with a six-digit code both parties read back on separate calls — derived from a SHA-256 digest of the exact settlement terms — and produces a verifiable, non-binding settlement memorandum backed by a hash-chained ledger. Use when both parties have already agreed to attempt settlement by phone. In live mode this skill places real phone calls to real people; never use it to collect a debt from, or pressure, a party who has not consented.
license: MIT
---

# Caucus Mediation

Use this skill when an agent must settle a concrete two-party money dispute
and both parties have already agreed to attempt phone mediation.

`caucus-mediation` is a mediation workflow skill. A neutral AI caller phones
each party in turn over CALL-E: first to obtain recorded consent from both,
then in alternating "shuttle" rounds that relay each side's latest offer
verbatim and capture the response (accept / reject / counter), and finally —
if an offer is accepted — one attestation call to each party in which they
hear the exact settlement terms and read back a six-digit confirmation code
derived from a SHA-256 digest of those terms. Every state transition is
appended to a hash-chained sqlite ledger, so the whole case can be
independently re-verified and rebuilt from the ledger alone. The output is a
settlement memorandum that is explicitly **non-binding**. The design goal is
a go-between that never takes sides, never invents an offer, and never lets
"agreed" mean anything weaker than both parties having heard the same terms.

## When To Use

Use this skill when ALL of these are true:

- Exactly two parties dispute a concrete money amount in USD.
- **Both parties have already agreed, outside this system, to attempt phone
  mediation.** This is a hard precondition, not a formality — the first two
  calls re-confirm it on a recorded line, and a "no" from either party ends
  the case terminally.
- Both parties are reachable at known phone numbers and a non-binding,
  mutually attested memorandum is an acceptable outcome.

## When Not To Use

Do not use this skill to:

- run one-sided calls: if only one party wants the calls, this is collections
  pressure, not mediation. The consent call is designed to stop exactly that,
  and opening a case to pressure a non-consenting party is a misuse of the
  system.
- obtain a legal determination, legal advice, or a binding award; the
  workflow produces none of those, and every call says so.
- mediate a dispute that is not reducible to an amount within a known range
  plus non-monetary conditions.
- verify anyone's identity: an attestation proves the person who answered the
  party's phone heard the exact terms, not who that person was.
- move money: payment, escrow, and enforcement are entirely out of scope.

## Consent And Disclosure Rules

These are load-bearing, not boilerplate:

1. Mutual agreement to mediate must exist BEFORE a case is opened. Opening a
   case is not a way to obtain it.
2. The first two calls of every case ask each party for explicit, recorded
   verbal consent, after disclosing: the call is recorded and captured as
   structured notes, the mediator is neutral and works for both parties, the
   process is voluntary and non-binding, this is not debt collection, and the
   callee may leave at any time.
3. Consent extraction is deliberately strict: silence, politeness, or staying
   on the line never count. Anything unclear is recorded as `unknown` and the
   case does not advance.
4. A "no" from either party moves the case to `declined_consent`, terminally.
   Never reopen a case against a party who declined.
5. The mediator never advises, never predicts outcomes, and never shares an
   opinion on who is right. The only quasi-evaluative output is a neutral
   midpoint observation, voiced only when both parties' own public offers
   already straddle it.
6. Party-private data never crosses parties. Intake notes and reservation
   bounds are taint-checked out of every rendered call — a render that would
   leak aborts before any phone rings — and never appear in any tool output.
   Phone numbers are masked to last-4 in every status, verdict, and memo.

## Mediation Workflow

The Caucus MCP server exposes five tools; only one of them can dial.

1. **`caucus_open_case`** — register the dispute. Provide a neutral
   one-sentence `summary` both parties would agree with (it is read to each
   of them on every call), the disputed `amount_dollars`, and each party's
   `label` (how the mediator refers to them aloud — heard by BOTH parties)
   and E.164 `phone`. Returns `case_id`. Places no call.

2. **`caucus_step_case`**, repeatedly — each invocation advances the case by
   exactly one step and places at most one call. The order of work is fixed
   by the protocol: a no-call clock tick, consent call to A, consent call to
   B, then alternating shuttle rounds (odd rounds call A, even rounds call
   B), and after an accept, one attestation call to each party. After each
   step, read the returned `state`, `terminal`, and `noop`. Stop stepping
   when `terminal` is true.

3. **`caucus_case_status`** — side-effect-free inspection at any point:
   state, per-round offer history with verbatim evidence quotes, the
   negotiation engine's public assessment (impasse detection, neutral
   midpoint suggestion), and the settlement with attestation records once one
   exists.

4. **`caucus_verify_case`** — after the case terminates, and any time
   tampering is suspected: recomputes the entire hash chain and checks both
   attestation read-backs against the digest-derived code, including that the
   two attestations came from two distinct calls. Only present a settlement
   to anyone after `verdict` is `"pass"`.

5. **`caucus_case_memo`** — the settlement memorandum as markdown. It masks
   phone numbers, cites verbatim evidence per round, includes the SHA-256
   terms digest and the mandatory non-binding notice, and contains nothing
   one party may not see — deliver the SAME memo to both parties. Before
   settlement it documents the rounds so far and says plainly that no
   settlement was reached.

Terminal states: `settled`, `impasse`, `declined_consent`, `expired`,
`cancelled`. The full state machine is in
`references/mediation-flow.md`; every tool's output shape is in
`references/result-schemas.md`.

**Three things stop a case no matter what was said on the line**, and all
three are deliberate:

1. **A `noop` step.** A call that goes unanswered, fails, or returns an
   unusable structured result changes nothing; the step reports `noop: true`.
   Stop looping, inspect `caucus_case_status`, and decide — never immediately
   re-step a noop in live mode, because that redials a human.
2. **Unclear consent.** Anything short of an explicit yes in the callee's own
   words is recorded as `unknown`, and the case stays where it is.
3. **An attestation mismatch.** A read-back that does not contain the
   complete code as one contiguous digit run leaves the case pending rather
   than settled. The verifier tolerates exactly one artifact observed on live
   calls — a false start followed by the complete correct code — and still
   rejects any wrong, missing, or inserted digit.

## Requirements

There are two different floors, and only one of them can ring a phone:

| What you are doing | Needs | Why |
|---|---|---|
| Everything in mock mode (the default) | Node 22+, `npm install`, `npm run build` | The full pipeline runs against a deterministic mock client; nothing dials |
| Live calls | All of the above, plus `CALLE_API_KEY` on the server process AND `live: true` on each step call | Both are required together; with either missing, a live request is refused or runs against the mock |

Leaving `CALLE_API_KEY` unset is itself a safety measure: the server then
cannot dial at all.

## Quick Start

The server speaks MCP (JSON-RPC 2.0, newline-delimited) over stdio. From the
Caucus app directory (`apps/typescript/caucus` in this repository):

```sh
npm install
npm run build
CAUCUS_DB=./caucus.db node dist/mcp.js
```

Typical MCP client registration:

```json
{
  "mcpServers": {
    "caucus": {
      "command": "node",
      "args": ["/path/to/caucus/dist/mcp.js"],
      "env": { "CAUCUS_DB": "/path/to/caucus.db" }
    }
  }
}
```

Add `"CALLE_API_KEY": "..."` to `env` ONLY when you intend live calls. State
persists in the sqlite ledger at `CAUCUS_DB`; restarting the server loses
nothing — cases rehydrate from the ledger by `case_id`.

### Worked example (all numbers fictional, +1555… style)

A $1,200 security-deposit dispute. The values below are from a real mock-mode
run of this server and are deterministic — you can reproduce them.

Open the case:

```json
{
  "name": "caucus_open_case",
  "arguments": {
    "vertical": "security_deposit",
    "summary": "Disputed deductions from a residential security deposit after move-out.",
    "amount_dollars": 1200,
    "party_a": { "label": "the landlord", "phone": "+15550000001" },
    "party_b": { "label": "the tenant",  "phone": "+15550000002" }
  }
}
```

Result (abridged): `{"case_id": "cs_…", "state": "created", "note": "No call
was placed. …"}`

Then call `caucus_step_case` with `{"case_id": "cs_…"}` repeatedly (no `live`
flag: mock mode, nothing is dialed). The eleven steps of this run:

| # | Step summary | State after |
|---|---|---|
| 1 | advanced clock | `consent_pending_a` |
| 2 | consent call to party A: completed | `consent_pending_b` |
| 3 | consent call to party B: completed | `rounds_active` |
| 4 | shuttle round 1 — A opens at $540 | `rounds_active` |
| 5 | shuttle round 2 — B counters $1,200 | `rounds_active` |
| 6 | shuttle round 3 — A counters $640 | `rounds_active` |
| 7 | shuttle round 4 — B counters $960 | `rounds_active` |
| 8 | shuttle round 5 — A counters $720, "tenant returns both mailbox keys" | `rounds_active` |
| 9 | shuttle round 6 — B accepts $720 | `attestation_pending_a` |
| 10 | attestation call to party A: completed | `attestation_pending_b` |
| 11 | attestation call to party B: completed | `settled` |

Note step 9: the tenant's bare "I accept" still yields a settlement carrying
the landlord's mailbox-keys condition — the standing offer's conditions are
merged in rather than silently dropped, and the dual attestation is where a
party refuses a term they did not mean to accept.

## What The Output Looks Like

`caucus_case_status` on the settled example (abridged):

```json
{
  "state": "settled",
  "settlement": {
    "amount_cents": 72000,
    "conditions": ["tenant returns both mailbox keys"],
    "terms_digest": "0cf582ca8d8a5cf414ab0259190224a09b4b111bc7a76fbfd07fff4525c3ae0f",
    "attestation_phrase": "821711",
    "attestations": [
      { "party": "A", "spoken_phrase": "821711", "verified": true },
      { "party": "B", "spoken_phrase": "821711", "verified": true }
    ]
  }
}
```

The code `821711` is not random: it is the terms digest reduced to six spoken
digits, so both parties reading back the same code is evidence they were read
the same terms. `caucus_verify_case` returns `"verdict": "pass"` with named
checks (chain integrity, each attestation, distinct attestation calls), and
`caucus_case_memo` returns the memorandum to deliver to both parties.

Mock mode exercises the entire production pipeline — state machine,
taint-checked rendering, ledger, digest and attestation code — against
scripted personas; only the phone network is simulated. Treat a clean mock
run as proof the protocol works, not proof of what real callees will say.

## Side Effects And Cancellation

- Side effect: **live mode places real phone calls.** A live
  `caucus_step_case` rings a real human at the number on file and costs one
  billable CALL-E call. The ONLY tool that can place a call is
  `caucus_step_case`, and each invocation places at most one.
- Nothing proceeds on its own: there is no background loop and no scheduler.
  A case advances only when you call `caucus_step_case`; if you stop
  stepping, nobody's phone rings again.
- Pacing is YOUR responsibility in live mode. The case policy records a call
  window (callee-local quiet hours), cooling-off minutes, and a retry ladder,
  but the step tool does not refuse an out-of-window or immediate-retry dial —
  it dials when you call it. Check the policy in `caucus_case_status`, only
  step during the callee's allowed hours, and wait out retry delays after a
  `no_answer` yourself. (Stated plainly because it is a real limitation of
  the current MCP surface, not a solved problem.)
- Cancellation, stated honestly: this MCP surface does not currently expose a
  cancel tool (the underlying state machine supports operator cancellation
  and records a `case_cancelled` ledger event, but no tool here triggers it).
  What you can rely on instead: stop stepping (an abandoned case never dials
  anyone again); TTL expiry (every case carries `ttl_hours`, default 72, and
  the next step past it expires the case terminally instead of dialing); and
  party exit (either party can decline on any call, which terminates the
  case, and the mediator is instructed to end calls politely whenever a
  callee wants out).
- Data: state lives in the sqlite file at `CAUCUS_DB` on the host you run the
  server on. Tool outputs mask phone numbers to last-4 and never contain
  party-private intake data; the ledger itself necessarily holds the full
  case record, so treat the file the way you treat anything with two people's
  dispute in it.

## References

- `references/mediation-flow.md`: the full state machine, shuttle
  alternation, failed-call handling, the timing policy and which parts of it
  are enforced, and how attestation and the hash-chained ledger work.
- `references/result-schemas.md`: every tool's output shape, the privacy
  invariants that hold for all of them, and how errors are reported.
