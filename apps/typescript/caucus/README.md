# Caucus — neutral phone mediation for two-party money disputes

Two people disagree about money — a withheld security deposit, an unpaid
invoice, a truck detained at a dock — and neither wants to call the other.
Caucus is shuttle diplomacy as a protocol. A neutral AI caller phones each
party in turn over CALL-E: first to obtain recorded consent from both, then
in alternating rounds that relay the other side's standing offer verbatim and
capture the response, and finally — if an offer is accepted — one attestation
call to each party in which they hear the exact settlement terms and read
back a six-digit code derived from a SHA-256 digest of those terms. Every
accepted state transition is appended to a hash-chained sqlite ledger, so a
case can be rebuilt and independently re-verified from the ledger alone. The
output is a settlement memorandum that is explicitly **non-binding**.

- **Language:** TypeScript, strict ESM, Node 22 or later
- **CALL-E surface used:** server SDK (`@call-e/calle`)
- **Interfaces:** CLI, MCP server (5 tools), read-only web dashboard, and the
  [`caucus-mediation`](../../../skills/caucus-mediation/) Agent Skill

## The problem

Most two-party money disputes are too small for lawyers and too raw for a
direct call. The mediator's oldest tool for that situation is the caucus:
keep the parties in separate rooms and carry offers between the rooms.
Running that over real phone calls with an AI go-between creates three
problems that have to be solved in code rather than in prose:

1. The go-between holds both sides' private intake — what each party would
   actually settle for — and one leaked number ends the negotiation. Keeping
   party A's data out of party B's call has to be a proof, not a habit.
2. Nobody should ever get a mediation call they did not agree to. Consent has
   to be a state the machine cannot skip, and a "no" has to be terminal.
3. When the parties do agree, "agreed" has to be checkable later: evidence
   that both heard the *same* terms, not each a paraphrase.

## How a case moves

```text
open case (no call is placed)
        |
consent call to A ---- "no" ----> declined_consent (terminal)
        |
consent call to B ---- "no" ----> declined_consent (terminal)
        |
shuttle rounds: odd rounds call A, even rounds call B
  each call relays the OTHER side's standing offer (amount, conditions,
  approved rationale — nothing else) and captures accept / counter / reject
  with a verbatim transcript quote as evidence
        |                                   |
    offer accepted                 round limit / stall detected
        |                                   v
attestation call to A                    impasse (terminal)
  hears the exact terms, reads back the 6-digit code
        |
attestation call to B   (separate call, same digest-derived code)
        |
     settled  ---->  memorandum: non-binding, phones masked,
                     identical for both parties

every accepted transition --> hash-chained sqlite ledger
                              (the case rehydrates from it alone)
```

**Consent.** The first two calls disclose, in fixed script text: the call is
recorded and captured as structured notes, the mediator is neutral and works
for both parties, the process is voluntary and non-binding, this is not debt
collection, and the callee may leave at any time. Consent extraction is
deliberately strict — silence, politeness, or staying on the line never
count, and anything unclear is recorded as `unknown` and does not advance the
case.

**Shuttle rounds.** Offers are typed, not prose: structured extraction
against a strict schema, re-validated with zod, amounts required to be whole
cents inside `[0, amount in dispute]`. A malformed or out-of-bounds result is
a logged `round_failed`, never a guessed offer. An "accept" that restates
nothing inherits the standing offer's amount *and* conditions — terms are
never silently dropped, and the dual attestation is where a party refuses a
term they did not mean to accept.

**Attestation.** The settlement terms `{amount, conditions}` are
canonicalized and hashed with SHA-256. The full digest goes to the ledger and
the memorandum; the digest reduced to six spoken digits is what each party
hears and reads back on their own call. Because the code is a pure function
of the terms, both parties reading back the same code is evidence both were
read the same terms. The code is not a secret and not a bearer token; the
digest carries the cryptographic weight, and the verifier checks the two
attestations came from two distinct calls.

**Ledger.** Every entry is chained per case
(`hash = SHA-256(prev_hash + canonical(entry))`). Verification recomputes the
whole chain and reports the first break. The ledger is the only durable
state: the CLI, the MCP server, and the live-case runner all rehydrate a case
from its entries, so a killed process resumes exactly where it stopped.

## What a shuttle call can never contain

The safety core is information-flow control between the two parties, enforced
in three independent layers in `src/renderer.ts`:

1. **Type level.** Every task string is built exclusively from a
   `TaintSafeView` whose type structurally cannot hold either party's private
   fields. A compile-time proof (a `DeepKeys` type walk over the whole view)
   fails the build if any nesting of the view ever gains a `private`,
   `notes`, or `reservationCents` key.
2. **Construction.** The fixed prose lives in one `SCRIPT` table and
   templates interpolate only view fields, so the task vocabulary is
   template words plus public-view words by construction.
3. **Runtime tripwire.** `assertNoTaint` rescans the final string for the
   other party's reservation amount in cents, dollar, and grouped renderings,
   distinctive fragments of their private notes, and their phone digits in
   any formatting — and throws instead of dialing. It exempts only amounts a
   party has itself offered aloud, and fails closed when a derived public
   number (an engine midpoint hint) happens to coincide with the other
   party's private bound.

The orchestrator renders before it dials, so a taint violation aborts before
any phone rings. The renderer carries 139 tests of its own, including
adversarial poison cases and fast-check property tests.

## How it differs from its neighbors

Three apps in this repository share parts of the shape, and none covers this
one's case:

- [`phone-approval-gate`](../phone-approval-gate/) is a **single approver**
  speaking a one-time code to authorize one change. Caucus has **two opposing
  parties**, and the code is not an approval secret but a digest fingerprint
  both must independently speak.
- [`verify-contact-claim`](../verify-contact-claim/) is **one-party
  verification** — one call, one question, a hash-chained record. Caucus
  keeps the hash-chained record and adds an alternating multi-call
  negotiation between parties whose interests conflict, with per-round
  verbatim evidence.
- [`multi-party-scheduler`](../multi-party-scheduler/) coordinates
  **availability** among parties who all want the same meeting. Caucus
  mediates parties who want opposite outcomes, which is why it needs
  information-flow control between them — a problem scheduling does not have.

The combination is the contribution: opposing parties, a compile-time plus
runtime proof that private data never crosses between their calls, structured
alternating negotiation, and dual attestation of the exact final terms.

## Setup

Node 22 or later.

```bash
cd apps/typescript/caucus
npm install
npm test        # 559 tests across 14 files; no credentials, no calls
```

Rehearse a complete case end to end — scripted mock personas, nothing dials:

```bash
npx tsx scripts/run-live-case.ts --rehearse --yes
```

Build demo data (settled mock cases with vertical-appropriate negotiators)
and browse it in the dashboard:

```bash
npx tsx scripts/build-demo.ts
npx tsx scripts/serve-dashboard.ts demo.db
# open http://localhost:8787/
```

## No call by default

Mock mode is not a demo bolted on; it is the default state of every entry
point, and live dialing is a double gate:

- The CLI dials only when **both** `--live` is passed **and** `CALLE_API_KEY`
  is set in the environment. `--live` without the key is refused, not
  downgraded. There is no other path to a real dial.
- The MCP server's step tool dials only when the request says `live: true`
  **and** the server process has `CALLE_API_KEY`. Leaving the key unset means
  the server cannot dial at all.
- The live-case runner demands exactly one of `--rehearse` or `--live`,
  requires the operator to press Enter before every individual call, and
  accepts real phone numbers **only** from CLI flags — never from any file in
  this repository.

Mock mode exercises the entire production pipeline — state machine,
taint-checked rendering, ledger, digest and attestation code — against
scripted personas; only the phone network is simulated.

## Side effects and cancellation

- **Only the step operation places calls, and at most one call per step.**
  Opening a case, reading status, verifying the ledger, and rendering the
  memorandum never dial. There is no background loop and no scheduler: a case
  advances only when the operator steps it, so stopping is silence.
- **Pacing is recorded policy, partly enforced.** Each case carries a call
  window (callee-local quiet hours), cooling-off minutes, and a retry ladder.
  `max_rounds` and `ttl_hours` **are** enforced by the state machine
  (`impasse` and `expired` are terminal); the window, cooling-off, and retry
  delays are honored by a caller that chooses to honor them — the step
  operation itself dials when invoked. In live mode, do not re-step
  immediately after a `no_answer`; that redials a human.
- **Cancellation.** The state machine supports an operator cancel event and
  records a terminal `case_cancelled` ledger entry, but neither the CLI nor
  the MCP surface currently triggers it — stated plainly as a limitation.
  What always holds: stop stepping and nobody's phone rings again; every
  case expires terminally past its TTL; and either party can decline on any
  call, which terminates the case.
- A call already in flight finishes on the CALL-E side; stopping the process
  stops everything after it.
- `CALLE_API_KEY` is read from the environment only, never from case files or
  the database.

## Verticals are configuration, not code

A dispute type is a JSON file, not a fork: `config/security-deposit.json`,
`config/unpaid-invoice.json`, and `config/freight-detention.json` each define
the party roles and labels, a default policy (rounds, TTL, call window, retry
ladder), suggested settlement conditions, and tone guidance for the consent
and shuttle scripts. The engine, renderer, and ledger are untouched across
verticals; `test/verticals.test.ts` pins the generalization.

## The dashboard

`web/` renders any case from the ledger, read-only by construction: the
sqlite connection is opened `query_only`, so the dashboard can observe a case
and never mutate one. Phone numbers appear exclusively masked to their last
four digits, and party-private intake data — including the bounds the engine
derives from it — never enters the payload. `exportStatic` writes the same
frontend plus one case's payload to a flat folder: a complete working replay
with no server, no API key, and no network dependency.

## MCP server and Agent Skill

`node dist/mcp.js` speaks MCP over stdio and exposes five tools:

| Tool | Dials? | Does |
| --- | --- | --- |
| `caucus_open_case` | never | registers the dispute, returns `case_id` |
| `caucus_step_case` | at most one call | advances the case by exactly one step |
| `caucus_case_status` | never | state, per-round offers with verbatim evidence, settlement |
| `caucus_verify_case` | never | recomputes the hash chain and re-checks both attestations |
| `caucus_case_memo` | never | the non-binding memorandum, identical for both parties |

The [`caucus-mediation`](../../../skills/caucus-mediation/) skill packages
the whole workflow — preconditions, consent rules, the step loop discipline,
and a worked example — for any agent stack that can register an MCP server.

## Safety model

The short version: consent-first (no substantive call is reachable in the
state machine until both parties said yes on a recorded line), neutrality
rules in every task text (the mediator refuses advice, predictions, and
opinions on who is right), disputes-not-collections scoping (the consent
script says so and either party can always leave), information-flow control
between the parties (compile-time proof plus runtime scan), dual attestation
of exact terms, masked phone numbers in every output, and a non-binding
memorandum.

The long version is written down, with named tests pinning each claim and the
limits stated as loudly as the strengths:

- [`docs/threat-model.md`](docs/threat-model.md) — assets, trust assumptions
  (the CALL-E platform and the host are trusted), seven threats with defenses
  and residual risks.
- [`docs/safety-patterns/information-flow-control.md`](docs/safety-patterns/information-flow-control.md)
- [`docs/safety-patterns/consent-first-mediation.md`](docs/safety-patterns/consent-first-mediation.md)
- [`docs/safety-patterns/dual-attestation.md`](docs/safety-patterns/dual-attestation.md)

The three pattern documents are written to be reused on any voice-agent
stack, not only here.

## Evidence and limits

What happened, with its evidence:

- **A real two-party case settled over 11 real CALL-E calls** — 10 on the ledger plus one refused read-back that never entered the chain: two recorded
  consents, six shuttle rounds (one side $400 → $550 → $700, the other
  $1,000 → $800 → accept at $700, conditions captured each round), then dual
  digit-code attestation. The hash chain verified (13 entries), rehydration
  reproduces the final state from the ledger alone, and the memorandum
  carries per-round verbatim quotes. Both parties were role-played by the
  operator on two separate real phones — real telephony and real ASR,
  scripted humans.
- **The verifier refused a bad read-back before it ever accepted a good
  one.** The first attestation read-back arrived garbled ("454574624"); the
  verifier found no contiguous correct code and refused it, the case stayed
  pending, the operator re-dialed with a fresh idempotency suffix, and both
  parties then read back the same code (457624) on separate calls.
- **The attestation encoding is live-derived, not designed on paper.** The
  original three-word phrase was disproven on real calls — ASR mangled
  isolated uncommon words ("topaz chowder cyclone" came back as "Joe Pads,
  chowder, 2nd 1.") — and was replaced with the six-digit read-back code
  banks use, derived from the same digest. The verifier is injected into the
  state machine rather than duplicated inside it, and its bounded
  false-start tolerance exists because a live callee said "935 935006": the
  complete code must appear as one contiguous digit run, and any wrong,
  missing, or inserted digit still fails.
- **ASR mishears, and the system is honest about which guarantee it makes.**
  On the live case, a spoken condition "with the keys returned" was captured
  as "with the kids returned". Caucus records terms *as heard*, and the dual
  attestation proves both parties heard the *same recorded terms* — not that
  ASR heard the speaker perfectly. The read-back on every shuttle call and
  the verbatim terms on both attestation calls are the correction points.
- **559 tests across 14 files**, including the 139-test adversarial renderer
  suite, crash-resume property tests, and sqlite tamper-detection tests. All
  run with no credentials and no calls.

What is *not* guaranteed:

- **Not identity verification.** A verified attestation proves the person who
  answered the party's phone heard the exact terms and read the code back —
  not who that person was. Nothing here authenticates a speaker.
- **Not legal advice, not binding.** Every call and every memorandum says so
  in fixed script text. The memorandum is a record of what was said, not an
  enforceable instrument.
- **Tamper-evident, not tamper-proof.** An attacker with write access to the
  sqlite file can rewrite an entry and recompute every subsequent hash; the
  chain has no external anchor, and the tests document that limit explicitly.
- **A refused attestation attempt leaves no case-ledger entry** — the refusal
  is a state-machine no-op, so its evidence lives in CALL-E's own call logs
  rather than in the chain. Ledgering failed attempts is future work.
- **Prompts instruct; they do not constrain.** The taint machinery governs
  the rendered task string. The live voice agent's improvisation is governed
  by the calling platform, and concession patterns leak information to a
  thoughtful adversary through entirely public data — that is negotiation,
  not a leak.

This is a demo app for a workflow pattern, not a CALL-E SDK and not a
supported product API.
