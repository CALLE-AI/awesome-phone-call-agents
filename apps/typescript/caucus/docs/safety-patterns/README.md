# Safety patterns for phone-call agents

Three reusable safety patterns, extracted from Caucus — a two-party
money-dispute mediator that runs entirely over CALL-E phone calls.
They are written for anyone building a CALL-E (or comparable voice-agent)
workflow that touches more than one person's data, dials real humans, or needs
an agreement to be provable afterwards.

| Pattern | One-line claim | Core code |
|---|---|---|
| [Information-flow control](information-flow-control.md) | A call's prompt is built from a type that *cannot* hold the other party's secrets, proven at compile time, and the final string is re-scanned at runtime — the renderer throws instead of dialing. | `src/renderer.ts` |
| [Consent-first mediation](consent-first-mediation.md) | No substantive call is reachable in the state machine until both parties have said yes on a recorded consent call; every call re-discloses recording; declining or leaving is always available and terminal. | `src/state.ts`, `src/runner.ts` |
| [Dual attestation](dual-attestation.md) | A short spoken code is derived from a SHA-256 digest of the exact settlement terms, so two independent call transcripts prove both parties heard the *same* terms — not a paraphrase of them. | `src/attest.ts`, `src/state.ts` |

## How to read these

Each document has the same shape:

1. **Problem** — stated generally, not in Caucus terms.
2. **The pattern** — mechanics you can implement on any stack.
3. **Reference implementation** — real file paths, short excerpts, and the
   names of the tests that pin each claim, so you can verify rather than trust.
4. **Applying it to your own workflow** — concrete steps.
5. **What this does not guarantee** — the limits, stated plainly.

The companion [threat model](../threat-model.md) says what Caucus defends
against, what it explicitly does not attempt, and what risk remains after
everything below is in place.

## A note on honesty

Every claim in these documents is grounded in code that exists in this
repository and in tests you can run (`npx vitest run`). Where a property is
*not* guaranteed — and several important ones are not — the document says so
explicitly. Three of the design decisions documented here — the switch from a
word-phrase attestation code to digits, the shuttle-call turn order, and the
verifier's bounded false-start tolerance — were forced by failures observed
on real phone calls, and the documents describe those failures rather than
the design we originally hoped would work.

All phone numbers in examples are fictional (`+15550000001` style).
