# Dual attestation of spoken agreements

**Claim:** when two parties who never share a call must agree on exact terms,
derive a short spoken confirmation code from a digest of those terms and have
each party read it back on their own recorded call. Two independent
transcripts then prove both parties heard the *same* terms — because if the
calls had carried different terms, they would necessarily have carried
different codes.

**Reference implementation:** `src/attest.ts`, `src/wordlist.ts`,
`src/state.ts` (`handleAttestation`), `src/runner.ts` (verifier injection),
`src/renderer.ts` (`renderAttestationCall`). Tests: `test/attest.test.ts`,
`test/renderer.test.ts` → *"attestation call: spoken digit code and turn
order"*, `test/state.test.ts` → *"attestation"*.

## Problem

In shuttle mediation (and many other phone workflows — verbal contract
confirmation, change-order approval, settlement of a chargeback) the two
principals are never on the same call. "Both parties agreed" is then a claim
assembled from two separate conversations, and it can fail in ways a single
transcript cannot show:

- the agent read party B a *paraphrase* that dropped a condition party A
  required;
- a bug (or tampering) between the two calls changed the terms;
- an amount was misheard on one call and confirmed as heard, not as meant.

You need agreement to be provable from the transcripts alone, without trusting
the system that placed the calls to have said the same thing twice.

## The pattern

1. **Canonicalize the terms.** Reduce the agreement to a canonical byte string
   that is invariant to condition order, incidental whitespace, duplicates,
   and Unicode representation. Same terms → same bytes, always.
2. **Digest it.** SHA-256 the canonical form. The digest is the durable,
   auditor-recomputable identity of the agreement; store it in your
   append-only log.
3. **Derive a spoken token from the digest.** Short enough to say on a phone
   line, deterministic, no randomness or clock — a pure function of the terms.
4. **On each party's separate call:** read the *full terms* verbatim, state
   the token, ask the party to read the token back, verify it, then ask for
   agreement in their own words. Record all of it.
5. **Verify and log both attestations.** The agreement is settled only when
   both read-backs verify against the same expected token, each on its own
   call, each written to the log with its call id and verbatim transcript.

The token proves *channel integrity* ("we were read the same terms"), the
recorded yes proves *assent*, and the digest proves *what the terms were*.
Three different jobs; keep them separate.

## Reference implementation

### Terms → digest → code

`canonicalTerms` (`src/attest.ts`) sorts conditions by UTF-16 code units,
collapses whitespace, drops empties, dedupes, normalizes to NFC, and emits a
fixed key order:

```ts
const conditions = [...new Set(terms.conditions.map(normalizeCondition))]
  .filter((c) => c.length > 0)
  .sort();
return JSON.stringify({ amountCents, conditions });
```

`termsDigest` is SHA-256 over those bytes. The spoken code is the whole digest
reduced modulo `10^digits` (default 6), zero-padded:

```ts
const value = BigInt(`0x${digest.toLowerCase()}`);
const modulus = 10n ** BigInt(digits);
return (value % modulus).toString().padStart(digits, "0");
```

One-cent or one-condition differences change the code
(`test/attest.test.ts` sweeps 200 adjacent amounts). Golden-value tests pin
the exact canonical bytes, digest, phrase, and code so a silent redefinition
of what a settlement digest *means* is a loud test failure, not a data-format
break discovered in production.

What the digest binds matters as much as how. An "I accept" call rarely
restates the other side's conditions, so Caucus merges the standing offer's
conditions into the settlement terms (`standingOfferConditions` +
`mergeConditions`, `src/state.ts`) before digesting. During development this
merge was missing — first on the live accept path, then, after that was fixed,
still missing on the crash-recovery path — and in both cases the parties would
have attested to a fingerprint of *wrong or divergent terms*. See the
[threat model](../threat-model.md) for the full account; the regression test
is `test/state.test.ts` → *"heals a torn accept to the SAME terms the live
path proposed"*.

### The call itself: turn order is load-bearing

`renderAttestationCall` (`src/renderer.ts`) fixes the order: read the exact
terms → state the code **digit by digit, in two groups of three** → explicitly
ask for a read-back and wait → verify, re-reading at most twice on mismatch —
and proceed to the agreement question even if the read-back never matches,
because recording an honest mismatch is correct behavior and a later
verification step decides what it means → only then ask for agreement in the
callee's own words. The task also instructs the agent to ignore anything
code-like said *before* the code was first read (the callee cannot know it
yet), never to interrupt a read-back, and to capture the final complete
attempt verbatim — never correcting, completing, or tidying it. Several of
these instructions exist because their absence was observed to fail on real
calls; every one is pinned by a named test in `test/renderer.test.ts` →
*"attestation call: spoken digit code and turn order"*.

### Verification

`verifySpokenCode` (`src/attest.ts`) normalizes what ASR transcribed — bare
digits, groupings, number words, the homophones phone lines actually produce
("for" → 4, "won" → 1, "niner" → 9), "double seven" → 77 — and then compares
against the expected code. The comparison rule has two parts, and the second
was forced by a real call:

- **No per-digit forgiveness.** Digits transcribe reliably, so a wrong digit
  is evidence of a wrong code, not of a noisy line. Forgiving one digit of
  six would collapse the effective space from 10^6 to roughly
  10^6 / (1 + 6·9) ≈ 18,000 — a materially weaker claim than the one this
  system makes.
- **One bounded tolerance: the false start.** On a live call (2026-07-30) a
  callee read back "935… 935006" — a false start, then the complete correct
  code — and pure exact matching rejected a read-back any human reviewer
  accepts. The verifier now accepts a read-back iff the exact code appears as
  one **contiguous** digit run and the whole utterance carries at most 2× the
  code's digits. A wrong, missing, or inserted digit still fails — "93006"
  (live, dropped digit) and "9 3 5 0 0 9 6" (live, inserted digit) are
  permanent reject fixtures — digit soup still fails, and a false start
  cannot repair a wrong digit. Chance containment of a 6-digit code in an
  unrelated utterance of ≤ 12 digits stays at a few parts per million, so the
  read-back keeps its evidentiary value. Tests: `test/attest.test.ts` →
  *"live-call regression fixtures (Gate A4)"*, including *'accepts the live
  false start: "935 935006" (complete code after a restart)'* and *"rejects
  digit soup even when it contains the code (containment is bounded)"*.

Any remaining ambiguity resolves toward false *reject*, because a false
reject costs a re-read while a false accept costs the attestation its
meaning.

The state machine (`src/state.ts` → `handleAttestation`) accepts an
attestation only from the party currently being waited on, only once, and only
when the read-back verifies; a mismatch leaves the case pending — it never
settles on a mismatch. What counts as a faithful read-back is an injected
dependency (`TransitionDeps.verifySpoken`, same pattern as
`computeSettlement`), and the production wiring in `src/runner.ts` supplies
the attest-domain verifier:

```ts
verifySpoken: (expected, spoken) => verifySpokenPhrase(expected, spoken).match,
```

That seam exists because its absence was a real defect: the state machine
originally compared read-backs with its own word-oriented string equality, so
the tolerant verifier — fully tested — would never have run in production. An
end-to-end test now replays the live false-start utterance through the
production pipeline (runner → injected verifier → state machine) all the way
to `settled`: `test/e2e.test.ts` → *"settles when a callee false-starts the
attestation code (live-call replay)"*.

Both attestations are written to the ledger with call id, verbatim spoken
phrase (false start and all), and timestamp; `case_settled` carries the terms
digest.

## The measurements (and one failure) behind the design

This section is the honest history. The current design is the *second*
encoding of the digest; the first was disproven by real calls.

### The word-phrase encoding and its verified properties

The original token was three words drawn from a curated 256-word list
(`src/wordlist.ts`), one digest byte per word: 2^24 ≈ 16.8M phrases. The
verifier tolerated one character slip per word ("falcons" for "falcon"), so
the list was built to make that tolerance safe:

- **256 entries, no duplicates, all lowercase ASCII** (tests in
  `test/attest.test.ts` → *"WORDS integrity"*);
- **every pair at Levenshtein distance ≥ 2** — the hard safety floor, since
  distance-1 neighbours would be cross-verifiable under a one-slip tolerance.
  Enforced by test (*"keeps EVERY pair at Levenshtein distance >= 2"*) and
  independently recomputed during review: zero distance-1 pairs, tightest pair
  `amber`/`hammer` at exactly 2. A full-sweep test proves the consequence
  directly: *"can never verify one wordlist entry in place of another"*;
- rhyme control (same final trigraph ⇒ distance ≥ 3), no number words, no
  homophones of common words.
- **Measured collision rate:** over 10,000 randomized term sets (9,998
  distinct), **2 duplicate phrases (0.02%)** — consistent with the birthday
  expectation of ~3 for 2^24. Test: *"keeps collisions at the birthday bound
  over 10k distinct term sets"*.

### What live calls showed

All of that was true and none of it was the property that mattered. On the
first four real calls (2026-07-30), the phrase failed to survive the phone
line in 2 of 2 attestation attempts:

| expected | ASR transcribed |
|---|---|
| topaz chowder cyclone | "Joe Pads, chowder, 2nd 1." |
| topaz chowders cyclone *(deliberate 1-word slip probe)* | "Topaz Chowder's Ticulum." |

Root cause: the wordlist was optimized for pairwise edit distance *between
list entries* — a real property that says nothing about a speech decoder.
Uncommon words spoken in isolation give the decoder no linguistic context, so
it substitutes whatever common-word sequence fits the acoustics. A token with
2^24 theoretical entropy that does not survive the channel delivers zero
effective entropy. These two transcripts are pinned as regression tests
(`test/attest.test.ts` → *"live-call regression (2026-07-30)"*), and the
word-phrase code paths are kept, exported, and tested as documented history.

### The digit code, and what it costs

Digits are the token class every ASR stack is most heavily tuned for — the
reason banks and carriers read back digit codes. The switch keeps the
cryptographic binding (the code is still a pure function of the terms digest;
the ledger still stores the full 256-bit digest) and changes only the spoken
encoding. The cost, measured rather than estimated, on the same 10k term sets
with the same seed: **55 collisions among 9,998 distinct term sets (0.55%)**
against a birthday expectation of ≈ 50 — about 17× the phrase's rate, which is
exactly the 2^24/10^6 keyspace ratio. Test: *"MEASURED: the 6-digit code
collides ~17x more often, over the same 10k term sets"*.

A collision here means two *different settlements* happen to speak the same
six digits. It is an audit nuisance, not a forgery: the code is not a secret
and not a bearer token — it is spoken in the clear on a recorded call — and
the callee still hears the full terms read verbatim and must separately say
yes to them (`agrees_to_terms` in the extraction schema). The digest, not the
code, is what an auditor recomputes. Deployments that want more margin raise
`digits`: 8 digits buys 100× for two more spoken digits
(`codeFromDigest(digest, 8)`), and a shorter code is always the suffix of a
longer one from the same digest.

### The digit code's own live record

Two further real calls (2026-07-30, after the encoding switch) exercised the
digit design component by component. What worked on a live line: the agent
delivered the code digit by digit in two groups; when a read-back was
deliberately wrong it re-read the code and re-asked — twice — without ever
indicating which digit was wrong; and final attempts were captured verbatim.
What failed was our verifier, not the channel: a correct read-back preceded
by a false start ("935… 935006") was rejected by exact matching — the origin
of the containment tolerance described above. A different read-back genuinely
dropped a digit ("93006"); the system recorded an honest mismatch and the
case stayed pending, which is designed behavior, not a defect. All three live
utterances are permanent fixtures: `test/attest.test.ts` → *"live-call
regression fixtures (Gate A4)"*.

What those calls did **not** show: a complete two-party attestation loop —
both parties' codes verified, case settled — end to end on a live line. That
composition of individually proven parts is the stated next gate.

## Applying it to your own CALL-E workflow

1. Canonicalize before digesting, and write golden tests pinning canonical
   bytes → digest → token. Any later "harmless" change to sorting or key order
   is a compatibility break for every already-attested agreement.
2. Speak digits, not words. Instruct the agent to say them digit by digit in
   two groups, to request the read-back explicitly, and to capture the final
   attempt verbatim. Put the read-back *before* the agreement question.
3. Normalize transcripts with digit-word and homophone folding, then require
   the complete code as one contiguous digit run, with a hard bound on stray
   digits (Caucus allows at most 2× the code length, which absorbs a false
   start and nothing more). Never forgive individual digits. Prefer false
   rejects; re-reads are cheap.
4. Store the digest and both verbatim read-backs in your append-only log.
   The token authenticates the channel; the digest is the record.
5. Size the token honestly: compute your birthday bound at expected volume,
   decide what a collision costs in *your* workflow, and write the trade down.

## What this does not guarantee

- **It does not prove identity.** A verified dual attestation proves *both
  callees heard the same terms and read the same code back*. It does **not**
  prove the speaker is who they claim to be: the call reaches whoever answers
  the party's phone, and voice can be impersonated. Caucus makes no biometric
  claim anywhere — see the [threat model](../threat-model.md) non-goals.
- **The full attestation loop is not yet live-proven end to end.** The
  components are: on real calls, digit-by-digit delivery, the no-coaching
  re-read discipline, verbatim capture, and honest-mismatch handling all
  worked (see "The digit code's own live record" above). What has not yet
  happened is a live two-party case settling through both attestation calls
  in sequence. Until it does, "the digit design settles real cases" is an
  expectation built from live-proven parts, not a measurement of the whole.
- **"Exact match" carries one stated relaxation.** The false-start
  containment rule deliberately weakens pure exactness: the code must appear
  as one contiguous run, but up to a code-length of surrounding stray digits
  is tolerated. The bound keeps chance containment at a few parts per
  million, and corruption still fails — but adopters should copy the *bound*,
  not just the tolerance, or "contains the code somewhere" quietly becomes
  the rule.
- **The verifier only runs if you wire it in.** `TransitionDeps.verifySpoken`
  is an injection point; when nothing is injected, `makeTransition` falls
  back to normalized string equality — exact-match for digit codes, which
  rejects "seven three nine two four one" spoken as words. The failure
  direction is safe (false reject → re-attempt, never a false settle), but a
  custom orchestrator that forgets the injection inherits a wide false-reject
  surface. Caucus's own runner wires it (`src/runner.ts`), and the e2e replay
  test exists precisely to keep that seam honest.
- **ASR can still fail, and the system stalls rather than guesses.** A
  mismatch never settles the case (`test/state.test.ts` → *"a mismatched
  phrase does NOT settle and leaves the case pending"*). Stalling is the
  designed failure mode; a deployment must budget for re-attempts.
