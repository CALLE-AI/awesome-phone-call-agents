# Safety pattern: dual attestation of spoken agreements

When two parties who never share a call must agree on exact terms, derive a
short spoken confirmation code from a digest of those terms and have each
party read it back on their own recorded call. Two independent transcripts
then prove both parties heard the *same* terms — because if the calls had
carried different terms, they would necessarily have carried different codes.

**Reference implementation:**
[`apps/typescript/caucus`](../apps/typescript/caucus/) — `src/attest.ts`,
`src/state.ts` (`handleAttestation`), `src/runner.ts` (verifier injection),
`src/renderer.ts` (`renderAttestationCall`); tests in `test/attest.test.ts`,
`test/renderer.test.ts`, and `test/state.test.ts` → *"attestation"*.

## Problem

In shuttle mediation — and in contract confirmation, change-order approval,
chargeback settlement — the two principals are never on the same call. "Both
parties agreed" is then assembled from two separate conversations, and can
fail in ways a single transcript cannot show: the agent read party B a
*paraphrase* that dropped a condition party A required; a bug (or tampering)
between the calls changed the terms; an amount was misheard on one call and
confirmed as heard, not as meant. Agreement must be provable from the
transcripts alone, without trusting the system that placed the calls to have
said the same thing twice.

Related patterns in this repository solve adjacent, single-channel problems —
[`phone-approval-gate`](../apps/typescript/phone-approval-gate/) has one
approver speak a one-time code to authorize an action, and
[`verify-contact-claim`](../apps/typescript/verify-contact-claim/) verifies a
claim with one party and keeps a hash-chained record. Dual attestation is for
the two-opposing-parties case: the *same* digest-derived code must come back
from *both* sides, on separate calls, before anything is considered agreed.

## The pattern

1. **Canonicalize the terms** to a byte string invariant to condition order,
   whitespace, duplicates, and Unicode representation.
2. **Digest it** (SHA-256). The digest is the durable, auditor-recomputable
   identity of the agreement; store it in your log.
3. **Derive a spoken token from the digest** — short enough for a phone line,
   a pure function of the terms.
4. **On each party's separate call:** read the *full terms* verbatim, state
   the token, ask the party to read it back, verify, then ask for agreement
   in their own words. Record all of it.
5. **Settle only when both read-backs verify** against the same expected
   token, each on its own call, each logged with its call id and verbatim
   transcript.

The token proves *channel integrity*, the recorded yes proves *assent*, and
the digest proves *what the terms were*. Three jobs; keep them separate.

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

`termsDigest` is SHA-256 over those bytes, and `codeFromDigest` derives the
spoken code as the whole digest reduced modulo `10^digits` (default 6),
zero-padded — deterministic, no randomness, no clock.

One-cent or one-condition differences change the code
(`test/attest.test.ts` sweeps 200 adjacent amounts), and golden-value tests
pin the exact canonical bytes, digest, and code, so a silent redefinition of
what a settlement digest *means* is a loud test failure.

What the digest binds matters as much as how. An "I accept" call rarely
restates the other side's conditions, so the app merges the standing offer's
conditions into the settlement terms (`standingOfferConditions` +
`mergeConditions`, `src/state.ts`) before digesting. During development this
merge was missing twice — on the live accept path, then on the crash-recovery
path — and in both cases the parties would have attested to a fingerprint of
wrong or divergent terms. Regression: `test/state.test.ts` → *"heals a torn
accept to the SAME terms the live path proposed"*.

### The call: turn order is load-bearing

`renderAttestationCall` (`src/renderer.ts`) fixes the order: read the exact
terms → state the code **digit by digit, in two groups of three** →
explicitly ask for a read-back and wait → verify, re-reading at most twice on
mismatch without ever indicating which digit was wrong → ask for agreement in
the callee's own words, even if the read-back never matched (recording an
honest mismatch is correct behavior). The agent is told to ignore anything
code-like said *before* the code was first read, never to interrupt a
read-back, and to capture the final complete attempt verbatim. Each
instruction exists because its absence was observed to fail on real calls;
each is pinned by a named test in `test/renderer.test.ts` → *"attestation
call: spoken digit code and turn order"*.

### Verification

`verifySpokenCode` (`src/attest.ts`) normalizes what ASR transcribed — bare
digits, groupings, number words, homophones ("for" → 4, "won" → 1,
"niner" → 9), "double seven" → 77 — then compares under two rules:

- **No per-digit forgiveness.** Digits transcribe reliably, so a wrong digit
  is evidence of a wrong code. Forgiving one digit of six would collapse the
  effective space from 10^6 to roughly 10^6 / (1 + 6·9) ≈ 18,000.
- **One bounded tolerance: the false start.** On a live call a callee read
  back "935… 935006" — a false start, then the complete correct code — and
  pure exact matching rejected a read-back any human reviewer accepts. The
  verifier accepts a read-back iff the exact code appears as one
  **contiguous** digit run and the whole utterance carries at most 2× the
  code's digits. A wrong, missing, or inserted digit still fails — "93006"
  (live, dropped digit) and "9 3 5 0 0 9 6" (live, inserted digit) are
  permanent reject fixtures in `test/attest.test.ts` — and a false start
  cannot repair a wrong digit. Chance containment of a 6-digit code in an
  unrelated utterance of ≤ 12 digits stays at a few parts per million.
  Ambiguity resolves toward false *reject*: a false reject costs a re-read;
  a false accept costs the attestation its meaning.

The state machine (`src/state.ts` → `handleAttestation`) accepts an
attestation only from the party currently awaited, only once, and only when
the read-back verifies; it never settles on a mismatch. What counts as a
faithful read-back is an injected dependency (`TransitionDeps.verifySpoken`);
the production wiring in `src/runner.ts` supplies the attest-domain verifier:

```ts
verifySpoken: (expected, spoken) => verifySpokenPhrase(expected, spoken).match,
```

That seam exists because its absence was a real defect: the state machine
originally compared read-backs with its own string equality, so the tolerant
verifier — fully tested — would never have run in production. An e2e test now
replays the live false-start utterance through the production pipeline to
`settled` (*"settles when a callee false-starts the attestation code
(live-call replay)"*, `test/e2e.test.ts`).

### The design history: a disproven encoding

The current code is the *second* encoding of the digest. The first was three
words from a curated 256-word list (`src/wordlist.ts`): 2^24 phrases, every
pair at Levenshtein distance ≥ 2 (enforced by test), 2 collisions per 10k
distinct term sets. All of that was true, and none of it was the property
that mattered — on the first real calls (2026-07-30) the phrase failed to
survive the phone line in 2 of 2 attempts:

| expected | ASR transcribed |
|---|---|
| topaz chowder cyclone | "Joe Pads, chowder, 2nd 1." |
| topaz chowders cyclone *(deliberate 1-word slip probe)* | "Topaz Chowder's Ticulum." |

Uncommon words spoken in isolation give a speech decoder no linguistic
context, so it substitutes whatever common-word sequence fits the acoustics —
2^24 theoretical entropy that does not survive the channel is zero effective
entropy. Both transcripts are pinned as regression tests. Digits are the
token class ASR is most heavily tuned for (the reason banks read back digit
codes), so the switch changed only the spoken encoding and kept the
cryptographic binding — the ledger still stores the full 256-bit digest. The
measured cost, same 10k term sets: 55 collisions vs the phrase's 2, the
2^24/10^6 keyspace ratio. A collision means two different settlements speak
the same six digits: an audit nuisance, not a forgery — the code is not a
secret, the callee still hears the full terms and must separately agree, and
the digest is what an auditor recomputes. For margin, raise `digits`: 8
buys 100× for two more spoken digits.

### The live record

A real two-party case has settled through this design end to end: two
recorded consents, six negotiation rounds converging from $400 / $1,000 to
$700, then dual attestation — 13 real CALL-E calls, with a verified 13-entry
hash chain that rehydrates to the same state. The refusal path fired first:
the initial attestation read-back arrived as a nine-digit garble
("454574624"), `verifySpokenCode` found no contiguous code and refused it,
the case stayed pending, and on the re-dial both parties read back the same
code — 457624 — each on their own call. Earlier component calls (2026-07-30)
had already shown digit-by-digit delivery, the no-coaching re-read
discipline, and verbatim capture working on a live line.

## Applying it to your own CALL-E workflow

1. Canonicalize before digesting, and write golden tests pinning canonical
   bytes → digest → token. A later "harmless" change to sorting or key order
   is a compatibility break for every already-attested agreement.
2. Speak digits, not words: digit by digit, two groups, read-back requested
   explicitly and captured verbatim, *before* the agreement question.
3. Normalize transcripts (digit words, homophones), then require the complete
   code as one contiguous run with a hard bound on stray digits. Never
   forgive individual digits; prefer false rejects — re-reads are cheap.
4. Store the digest and both verbatim read-backs in your append-only log.
5. Size the token honestly: compute the birthday bound at your volume, decide
   what a collision costs in *your* workflow, and write the trade down.

## Limits

- **It does not prove identity.** A verified dual attestation proves both
  callees heard the same terms and read the same code back — not that either
  speaker is who they claim to be. The call reaches whoever answers the
  party's phone, and voice can be impersonated; no biometric claim is made —
  see the app's [threat model](../apps/typescript/caucus/docs/threat-model.md).
- **ASR can mishear the terms themselves, and the system records terms AS
  HEARD.** On the live settled case, a spoken condition "with the keys
  returned" was captured as "with the kids returned", and both parties then
  attested to the code derived from the as-captured terms. Dual attestation
  proves both parties heard the *same recorded terms* — not that ASR heard
  the speaker perfectly. The verbatim read of the full terms on each call is
  the human's chance to catch a capture error.
- **"Exact match" carries one stated relaxation.** The false-start
  containment rule tolerates up to a code-length of stray digits around one
  contiguous correct code. Copy the *bound*, not just the tolerance, or
  "contains the code somewhere" quietly becomes the rule.
- **The verifier only runs if you wire it in.** Without the
  `TransitionDeps.verifySpoken` injection, the state machine falls back to
  normalized string equality, which rejects codes spoken as number words —
  a safe direction (false reject, never a false settle), but a wide
  false-reject surface for an orchestrator that forgets the seam.
- **A refused attempt stalls the case and leaves no case-ledger entry.** A
  mismatch is a state-machine no-op: the case stays pending (test: *"a
  mismatched phrase does NOT settle and leaves the case pending"*), and the
  failed attempt is recorded only in the calling platform's own call log, not
  in the app's hash chain. Stalling is the designed failure mode — budget for
  re-dials; ledgering refused attempts is future work.
