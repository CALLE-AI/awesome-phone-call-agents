---
name: caucus-mediation
description: >-
  Run a neutral, consent-first phone mediation that settles a two-party money
  dispute (security deposit, unpaid invoice, freight detention, ...) through the
  Caucus MCP server. Use when BOTH parties have already agreed to attempt
  settlement by phone and the user wants an automated neutral go-between to
  shuttle offers between them, confirm any agreement with dual spoken
  attestation, and produce a verifiable, non-binding settlement memorandum.
  In live mode this skill PLACES REAL PHONE CALLS to real people. Do not use it
  to collect a debt from, or pressure, a party who has not consented.
---

# Caucus — neutral phone mediation for two-party money disputes

Caucus is shuttle diplomacy as a protocol. A neutral AI caller phones each
party in turn over CALL-E: first to obtain recorded consent from both, then in
alternating "shuttle" rounds that relay each side's latest offer verbatim and
capture the response (accept / reject / counter), and finally — if an offer is
accepted — one attestation call to each party in which they hear the exact
settlement terms and read back a 6-digit confirmation code derived from a
SHA-256 digest of those terms. Every state transition is appended to a
hash-chained sqlite ledger, so the whole case can be independently re-verified
and rebuilt from the ledger alone. The output is a settlement memorandum that
is explicitly **non-binding**.

The mediator is a go-between, not an advisor. It never takes sides, never
evaluates who is right, and never gives legal advice.

## When to use this skill

Use Caucus when ALL of these are true:

- Exactly two parties dispute a concrete money amount in USD.
- **Both parties have already agreed, outside this system, to attempt phone
  mediation.** This is a hard precondition, not a formality — the first two
  calls re-confirm it on a recorded line, and a "no" from either party ends
  the case.
- Both parties are reachable at known phone numbers and a non-binding,
  mutually attested memorandum is an acceptable outcome.

Do NOT use Caucus when:

- Only one party wants the calls. Caucus refuses to act as a one-sided
  collections tool; opening a case to pressure a non-consenting party is a
  misuse of the system and the consent call is designed to stop it.
- The parties need a legal determination, legal advice, or a binding award.
  Caucus produces none of those (see Boundaries below).
- The dispute is not reducible to an amount within a known range plus
  non-monetary conditions.

## Side effects — read before calling anything

- **Live mode places real phone calls.** A live `caucus_step_case` rings a
  real human at the number on file and costs money. Live dialing requires BOTH
  `live: true` on the step call AND `CALLE_API_KEY` set on the server process;
  with either missing the step is refused or runs against a deterministic mock
  client that dials no one. Default is mock.
- **`caucus_open_case` never dials.** Neither do `caucus_case_status`,
  `caucus_verify_case`, or `caucus_case_memo`. The ONLY tool that can place a
  call is `caucus_step_case`, and each invocation places at most one call.
- **Nothing proceeds on its own.** There is no background loop; a case only
  advances when you call `caucus_step_case`. If you stop stepping, nobody's
  phone rings again.
- **Pacing is YOUR responsibility in live mode.** The case policy records a
  call window (quiet hours), cooling-off minutes, and a retry ladder, but the
  step tool does not refuse an out-of-window or immediate-retry dial — it
  dials when you call it. When driving live, check the policy in
  `caucus_case_status` and only step during the callee's allowed hours, and
  wait out retry delays after a `no_answer` yourself. (Stated plainly because
  it is a real limitation of the current MCP surface, not a solved problem.)

## Setup

The server speaks MCP (JSON-RPC 2.0, newline-delimited) over stdio. From the
`caucus` repository:

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
      "env": {
        "CAUCUS_DB": "/path/to/caucus.db"
      }
    }
  }
}
```

Add `"CALLE_API_KEY": "..."` to `env` ONLY when you intend live calls. Leaving
it unset is itself a safety measure: the server then cannot dial at all.

State persists in the sqlite ledger at `CAUCUS_DB`. Restarting the server
loses nothing — cases rehydrate from the ledger by `case_id`.

## The tool sequence for a full mediation

1. **`caucus_open_case`** — register the dispute. Provide a neutral one-sentence
   `summary` both parties would agree with (it is read to each of them on
   every call), the disputed `amount_dollars`, and each party's `label` (how
   the mediator refers to them aloud — heard by BOTH parties) and E.164
   `phone`. Returns `case_id`. Places no call.

2. **`caucus_step_case`** repeatedly — each call advances the case by exactly
   one step. The order of work is fixed by the protocol:

   | Step | What happens |
   |---|---|
   | 1 | clock tick, no call (`created` -> `consent_pending_a`) |
   | 2 | consent call to party A |
   | 3 | consent call to party B |
   | 4… | alternating shuttle rounds: odd rounds call A, even rounds call B, each relaying the other side's standing offer and capturing accept / reject / counter |
   | after an accept | attestation call to A, then attestation call to B |

   After each step, read the returned `state`, `terminal`, and `noop`. Stop
   stepping when `terminal` is true. When `noop` is true the step changed
   nothing (a `no_answer` that should wait out its retry delay, or a terminal
   case) — STOP looping, inspect `caucus_case_status`, and decide; never
   immediately re-step a noop in live mode, because that redials a human.

3. **`caucus_case_status`** — side-effect-free inspection at any point:
   state, per-round offer history with verbatim evidence quotes, the
   negotiation engine's public assessment (impasse detection, neutral midpoint
   suggestion), and the settlement with attestation records once one exists.

4. **`caucus_verify_case`** — after the case terminates (and any time you
   suspect tampering): recomputes the entire hash chain and checks both
   attestation read-backs against the digest-derived code, including that the
   two attestations came from two distinct calls. Only present a settlement to
   anyone after `verdict` is `"pass"`.

5. **`caucus_case_memo`** — the settlement memorandum as markdown. It masks
   phone numbers, cites verbatim evidence per round, includes the SHA-256
   terms digest and the mandatory non-binding notice, and contains nothing one
   party may not see — deliver the SAME memo to both parties. It works at any
   state; before settlement it documents the rounds so far and says plainly
   that no settlement was reached.

Terminal states: `settled`, `impasse`, `declined_consent`, `expired`,
`cancelled`. See `references/mediation-flow.md` for the full state machine and
`references/result-schemas.md` for every tool's output shape.

## Consent requirements

- Mutual agreement to mediate must exist BEFORE you open a case. Opening a
  case is not a way to obtain it.
- The first two calls of every case ask each party for explicit, recorded
  verbal consent, after disclosing: the call is recorded and captured as
  structured notes, Caucus is neutral and works for both parties, the process
  is voluntary and non-binding, and the callee may leave at any time.
- Consent extraction is deliberately strict: silence, politeness, or staying
  on the line never count. Anything unclear is recorded as `unknown` and the
  case does not advance.
- A "no" from either party moves the case to `declined_consent`, terminally.
  Do not reopen a case against a party who declined.

## Cancellation

Stated honestly: this MCP surface does not currently expose a cancel tool
(the underlying state machine supports operator cancellation and records a
`case_cancelled` ledger event, but no tool here triggers it). What you can
rely on instead:

- **Stop stepping.** Calls happen only inside `caucus_step_case`, so an
  abandoned case never dials anyone again.
- **TTL expiry.** Every case carries `ttl_hours` (default 72). Once past its
  TTL, the next step expires the case terminally instead of dialing.
- **Party exit.** Either party can decline on any call; declining consent
  terminates the case, and the mediator is instructed to end calls politely
  whenever a callee wants out.

## Boundaries — what Caucus will not do

These are design rules enforced in the call scripts and the code, not
aspirations:

- **Never advises.** The mediator refuses to tell either party what to do,
  predict outcomes, or share opinions about who is right. The only
  quasi-evaluative output is a neutral midpoint observation, voiced only when
  both parties' own public offers already straddle it.
- **Never evaluates legal merit.** No claim is judged; offers are relayed, not
  endorsed.
- **Non-binding output.** Every call and every memo states that nothing here
  is a contract, a legal determination, or legal advice. Parties are told to
  consult a licensed attorney before relying on the terms.
- **Requires mutual consent** (see above), and **refuses one-sided
  collections**: the consent script explicitly distinguishes voluntary
  mediation from debt collection and tells the callee they may leave.
- **Party-private data never crosses parties.** Intake notes and reservation
  bounds are taint-checked out of every rendered call — a render that would
  leak aborts before any phone rings — and never appear in any tool output.
  Phone numbers are masked to last-4 in every status, verdict, and memo.

## Worked example (all numbers fictional, +1555… style)

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

`caucus_case_status` then shows (abridged):

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

## What mock mode does and does not prove

Mock mode exercises the entire production pipeline — state machine,
taint-checked rendering, ledger, digest/attestation crypto — against scripted
personas; only the phone network is simulated. The personas are demo
negotiators, not models of real ones. Treat a clean mock run as proof the
protocol works, not proof of what real callees will say.
