# Caucus threat model

What Caucus defends against, what it explicitly does not attempt, and what
risk remains. Every defense cited here is implemented in this repository and
pinned by named tests; where a defense is partial, this document says so.
Judges and adopters are invited to verify rather than trust: the test suite
(`npx vitest run`) and the ledger traces are the evidence.

## System sketch

Caucus mediates a two-party money dispute over real phone calls: recorded
consent from both parties, alternating shuttle calls relaying typed offers,
and — on acceptance — a settlement whose SHA-256 terms digest yields a spoken
confirmation code that both parties read back on separate attestation calls.
Every accepted state transition appends to a hash-chained SQLite ledger, and
any case can be rebuilt from the ledger alone (`rehydrate` in `src/state.ts`).

Where data lives: the full `CaseRecord` (including each party's private
reservation bound and intake notes, `PartyPrivate` in `src/types.ts`) lives in
the local store and ledger. Rendered call tasks, transcripts, and structured
results pass through the CALL-E platform. The settlement memorandum
(`src/memo.ts`) always masks phone numbers to their last four digits.

## Assets

1. **Each party's private reservation bound and intake notes** — the thing a
   negotiation adversary most wants; disclosure to the other party is
   irreversible and decisive.
2. **Party phone numbers** — each party's number must not be spoken to the
   other, and never appears unmasked in memoranda.
3. **Integrity of recorded offers** — an offer in the record must be what the
   party actually said on a call, bounded and evidence-backed, not a model's
   invention.
4. **Integrity of the settlement terms** — the digest both parties attest to
   must bind exactly the terms they were read, identically on both calls, and
   identically across crashes.
5. **Integrity of the case history** — the ledger must make after-the-fact
   tampering evident.

## Trust assumptions

Stated up front because no defense below crosses them:

- **The CALL-E platform is trusted.** It receives every task string and
  returns every transcript. Caucus keeps party A's secrets out of party B's
  *call*; it cannot and does not keep anything from the calling platform
  itself.
- **The host running Caucus and its SQLite file are trusted.** The ledger is
  tamper-*evident*, not tamper-*proof* (see below), and the genesis payload
  used by `rehydrate` necessarily contains both parties' private data. The
  ledger is a trusted store, not a shareable artifact.
- **The operator is trusted.** The CLI's mock-by-default gate (`--live` plus
  `CALLE_API_KEY`, `src/cli.ts`) protects against accident, not against a
  malicious operator.

## Threats and defenses

### T1 — A curious party tries to learn the other's bottom line

The highest-value attack, and it requires no technical skill: just ask the
mediator leading questions.

**Defense.** The prompt for a call to party B is built exclusively from a
projection type that structurally cannot hold party A's private data, a
compile-time proof keeps it that way, and the final string is re-scanned at
runtime for A's reservation (in cents, dollar, and grouped renderings), note
tokens, and phone digits — the renderer throws rather than dials
(`src/renderer.ts`; poison, isolation, and fast-check property tests in
`test/renderer.test.ts`). The scan exempts only amounts a party has itself
offered aloud — self-disclosure is the owner's right — and fails closed when a
derived public number (an engine midpoint hint) coincides with the private
bound (*"FAILS CLOSED when a straddling suggestion collides with the other
party's private bound"*). Neutrality rules in every task text instruct the
agent to refuse advice and predictions. Details:
[information-flow-control](safety-patterns/information-flow-control.md).

**Residual risk.** The task text contains no secret to leak — that is the real
defense — but the live voice agent's improvisation is governed by the calling
platform, not by this renderer; an agent manipulated into *speculating* about
the other side is not detectable by a string scan of the prompt. And no system
can prevent legitimate inference: a party who watches the other side's
concession pattern across rounds learns something about their bound from
public data alone. That is negotiation, not a leak.

### T2 — The LLM hallucinates an offer or fabricates evidence

**Defense.** Structured results are extracted against a strict-subset JSON
schema whose field descriptions demand verbatim quotes and explicit `unknown`
over guessing (`src/schemas.ts`); the returned payload is re-validated with
zod, and anything malformed is a logged `round_failed`, never a guessed offer
(`src/state.ts`). Amounts must be whole cents within `[0, dispute total]` —
out-of-bounds and sub-cent extractions are rejected. An "accept" that restates
nothing inherits the standing offer's amount and conditions rather than
letting the model supply them (`test/state.test.ts` → *"an accept that
restates nothing inherits the standing offer's amount AND conditions"*).
Evidence strings are carried as provenance and are never relayed into the
other party's call (`test/renderer.test.ts` → *"never relays raw evidence
quotes"*). The shuttle script has the agent read back what it captured before
ending the call, and the dual attestation re-reads the final terms verbatim to
both parties before anything settles.

**Residual risk.** Extraction can still mishear a *plausible, in-bounds*
amount; a schema cannot catch a wrong-but-valid number. The read-back on the
call and the dual attestation bound the damage to intermediate rounds — final
terms are confirmed by both parties against the exact text — but a garbled
intermediate offer can waste rounds. And "evidence" is model-selected quoting
of a real transcript: the transcript is the ground truth, the quote is not
cryptographically bound to it.

### T3 — A mis-rendered prompt leaks context

The bug class where a template edit, a debug dump, or a convenience refactor
puts the whole case record into a task string.

**Defense.** Same machinery as T1, and the layering is the point: the type
layer makes the leak inexpressible in the data path, the single-`SCRIPT`-table
construction makes task vocabulary equal to template-words ∪ public-words, and
the runtime scan exists precisely to catch future template edits that sidestep
the view. Every render path funnels through one `finalize()` that runs
`assertNoTaint` before returning, and the orchestrator renders before it
dials, so a taint violation aborts before a phone rings (`src/runner.ts`).

**Residual risk.** The scan is lexical: sub-4-character note tokens,
sub-3-digit runs, and semantic paraphrase are outside its reach (the type
layer, not the scan, is what stands between those and the string). A leak
through any channel other than the rendered task — logs, the memorandum, the
ledger — is out of this mechanism's scope; the memorandum masks phones by
construction (`test/e2e.test.ts` → *"produces a settlement memorandum that
masks phones and cites evidence"*), but log hygiene is the deployment's job.

### T4 — A tampered ledger

**Defense.** Every entry is hash-chained per case:
`hash = SHA-256(prevHash + canonical(entry))` over a deterministic
serialization that throws on anything JSON cannot faithfully represent
(`src/ledger.ts`). Changing any byte of meaning in a stored entry invalidates
its hash; rewriting the hash breaks the successor's `prevHash` link.
`verifyChain` recomputes the whole chain and reports the first break
(`test/ledger.test.ts` → *"verifyChain tamper detection"*: mutated payloads,
flipped bytes, rewritten types, back-dated timestamps, deleted and swapped
entries, re-homed cases, plus a fast-check property that mutating any single
entry breaks the chain at exactly that entry).

**Residual risk.** This is tamper-*evidence*, not tamper-*proof*. An attacker
with write access to the SQLite file can rewrite an entry *and* recompute
every subsequent hash in the chain, producing a consistent forged history.
The test suite states this limit as loudly as the strengths — two tests
document what verification does **not** catch: *"does NOT detect truncation
of the newest entry (the chain has no external anchor)"* and *"does NOT
detect a full re-forge of the tail"*. Detection of those requires an
out-of-band anchor — a copy of a chain-head hash stored elsewhere, or
countersignatures — which Caucus does not implement. Within the stated trust
assumption (the host is trusted), the chain defends against partial
corruption and casual after-the-fact editing, not against a root-level
adversary.

### T5 — A torn write produces divergent settlement terms

The subtlest integrity failure this project found in its own code, recorded
here by behavior because it is exactly the class of bug this design exists to
prevent. An "accept" emits two ledger events (`offer_recorded` and
`settlement_proposed`). Two related defects were found during development:
first, the settlement was built from the accepting call's conditions alone —
dropping conditions the standing offer required, so both parties would have
attested a fingerprint of terms that omitted a condition one of them insisted
on. After that was fixed on the live path, the crash-recovery path that heals
a torn append (first event persisted, second lost) still rebuilt the
settlement the old way — so the same case, replayed through a crash, would
have settled on a *different digest and a different spoken code* than the
uninterrupted run. The safety mechanism itself would have been attesting to
the wrong thing.

**Defense, in the order that matters.** (1) The cause is removed: the runner
appends each transition's drafts in a single SQLite transaction
(`Ledger.appendMany`; the `LedgerSink` interface in `src/runner.ts` accepts
nothing weaker), so the common tear is unreachable — `test/e2e.test.ts`
asserts both accept drafts share one epoch inside one chain. (2) The recovery
still exists for other crash points and now applies the *identical* condition
merge as the live path — pinned by `test/state.test.ts` → *"heals a torn
accept to the SAME terms the live path proposed"*, a test verified to be
load-bearing by reverting the fix and watching it fail. (3) Determinism is
tested end to end: identical inputs produce an identical settlement digest
(`test/e2e.test.ts`).

**Residual risk.** The heal path covers the tear patterns we could construct;
a crash mode nobody has imagined could still find a divergence. The honest
general lesson is recorded with the fix: when correctness logic exists in two
places, the second one is where it will rot.

### T6 — ASR mishears the attestation

**Defense.** The spoken confirmation token is a 6-digit code, not words —
switched after live calls measured the original three-word phrase failing
2 out of 2 times ("topaz chowder cyclone" transcribed as "Joe Pads, chowder,
2nd 1."). Digits are the token class voice channels transcribe most reliably.
The attestation script fixes the turn order (terms → code digit by digit in
two groups → explicit read-back request → at most two re-reads → agreement
question) and forbids the agent from correcting or completing a read-back.
Verification folds digit words and homophones, then requires the complete
code as one contiguous digit run with a bounded amount of surrounding noise —
a tolerance added when a live callee false-started ("935… 935006") and pure
exact matching wrongly rejected a correct read-back. A wrong, missing, or
inserted digit still fails (a dropped and an inserted digit were each
observed live and are regression fixtures), remaining ambiguity resolves
toward false *reject*, and a mismatch leaves the case pending rather than
settled. The verifier is injected into the state
machine (`TransitionDeps.verifySpoken`, wired in `src/runner.ts`) — a seam
created after review found the state machine comparing read-backs with its
own string equality, which would have kept the tested verifier out of
production. Details and measurements:
[dual-attestation](safety-patterns/dual-attestation.md).

**Residual risk.** A persistent mishearing stalls the case — safe direction,
but a real operational cost, and observed live: on one of the two digit-code
calls a read-back genuinely dropped a digit ("93006") and the case correctly
recorded an honest mismatch and stayed pending. Those two calls proved the
digit design's components individually — digit-by-digit delivery, the
no-coaching re-read discipline, verbatim capture — but the composition, a
two-party attestation
loop settling a live case end to end, has not been run; until it has, "the
digit design settles real cases" is an expectation built from live-proven
parts, not a measurement. And the false-start containment rule relaxes
"exact match" by a stated bound (contiguous code, at most 2× the code's
digits in the utterance); chance containment stays at a few parts per
million.

### T7 — Replayed or duplicated call results

Webhook-style integrations re-deliver; a state machine that double-applies a
result double-moves a case.

**Defense.** Transitions are idempotent and monotonic: stale round numbers,
re-delivered consents, and double-delivered attestations are no-ops returning
the same record instance; every accepted transition increments `epoch`
(`src/state.ts`; the *"IDEMPOTENT: ..."* tests in `test/state.test.ts`).
Rendered calls carry a deterministic idempotency key
(`caseId:round:callee:purpose`) that is byte-stable across identical renders
(`test/renderer.test.ts` → *"is byte-stable across identical renders"*), so a
retried dial can be deduplicated by the call layer.

**Residual risk.** Idempotency keys are only as good as the call layer's
respect for them; the mock honors them, and a live integration must too.

## Explicit non-goals

Caucus does **not** claim, and should never be deployed as if it claimed:

- **Identity or biometrics.** A verified attestation proves the person who
  answered the party's phone heard the exact terms and read the code back. It
  does not prove who that person was. Voice can be impersonated; SIM swaps and
  shared phones exist. Nothing in this system authenticates a speaker.
- **Legal advice or binding arbitration.** Every consent and attestation call
  states it in the fixed script: not a law firm, never legal advice, nothing
  in the process legally binding on its own (`SCRIPT.nonBinding`,
  `src/renderer.ts`). The memorandum is a record of what was said, not an
  enforceable instrument.
- **Debt collection.** The script says so on the consent call
  (`SCRIPT.notCollections`), and the structure backs it: both parties must
  consent before any substantive call, either may decline or cancel at any
  time into a terminal state, and the shuttle protocol is symmetric by
  construction. See
  [consent-first-mediation](safety-patterns/consent-first-mediation.md).
- **Moving money.** Settlement execution — payment, escrow, enforcement — is
  entirely out of scope.

## Residual risks, plainly

The short list an adopter should carry away:

1. The live voice agent can say things the task never instructed; prompts
   instruct, they do not constrain. Recordings are the audit trail.
2. Concession patterns leak information to a thoughtful adversary through
   entirely public data; mediation cannot prevent inference.
3. The CALL-E platform and the host see everything; all guarantees are
   scoped inside that trust boundary.
4. The ledger detects tampering; it does not prevent it, and a root-level
   attacker can rewrite it consistently absent an external anchor.
5. Intermediate offer extraction can be wrong-but-plausible; only the final
   terms are dual-attested.
6. Attestation proves same-terms, not identity — by design, and stated
   wherever attestation is described.
7. Quiet-hours, cooling-off, and retry pacing are policy declarations with
   tested helpers (`withinCallWindow`, `nextRetryAt` in `src/calle.ts`), not
   yet enforced by the orchestrator loop.
8. The digit read-back's components are live-proven (delivery, re-read
   discipline, verbatim capture, honest-mismatch handling); the full
   two-party attestation loop on a live line is not, and stays an
   expectation until a real case settles through it.
