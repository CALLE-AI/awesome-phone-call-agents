# Caucus mediation flow — state machine reference

This is the authoritative map of how a case moves, for agents driving
`caucus_step_case`. Source of truth: `src/state.ts` (transitions) and
`src/runner.ts` (which call each state owes next).

## States

| State | Terminal | Meaning | Next step performs |
|---|---|---|---|
| `created` | no | Case registered, nothing dialed | clock tick (no call) |
| `consent_pending_a` | no | Awaiting party A's recorded consent | consent call to A |
| `consent_pending_b` | no | A consented; awaiting party B | consent call to B |
| `rounds_active` | no | Both consented; shuttle negotiation running | shuttle call (see alternation below) |
| `attestation_pending_a` | no | An offer was accepted; settlement proposed | attestation call to A |
| `attestation_pending_b` | no | A attested; awaiting B | attestation call to B |
| `settled` | yes | Both parties attested the same code on separate calls | nothing (steps are noops) |
| `impasse` | yes | Round limit reached, or engine detected stall/oscillation | nothing |
| `declined_consent` | yes | A party answered "no" to the consent question | nothing |
| `expired` | yes | Case passed its `ttl_hours` before finishing | nothing |
| `cancelled` | yes | Operator cancellation (state machine supports it; not exposed as an MCP tool) | nothing |

## Diagram

```
created --tick--> consent_pending_a --A yes--> consent_pending_b --B yes--> rounds_active
                        |                            |                          |
                     A "no"                       B "no"                   offer accepted
                        v                            v                          v
                 declined_consent             declined_consent        attestation_pending_a
                                                                                |
                                                                          A reads code back
                                                                                v
   any non-terminal --tick past TTL--> expired                        attestation_pending_b
   rounds_active --max rounds / engine impasse--> impasse                       |
                                                                          B reads code back
                                                                                v
                                                                             settled
```

## Shuttle alternation

Round `n` calls party A when `n` is odd, party B when `n` is even. Each
shuttle call relays the OTHER side's standing offer (amount, conditions, and
any rationale that party approved for sharing — nothing else) and captures the
callee's move:

- `open` — first proposal when nothing has been relayed yet (round 1).
- `counter` — a different amount in response to the relayed proposal.
- `accept` — explicit agreement to the relayed proposal. An accept without a
  restated amount takes the standing offer's amount, and the settlement merges
  the standing offer's conditions with any the accepter voiced — conditions
  are never silently dropped.
- `reject` — refusal without a new amount.

Amounts must be whole-cent USD within `[0, amount_in_dispute]`; anything else
is recorded as a failed round (`round_failed` in the ledger) and the round
does not advance.

## Failed and unanswered calls

A call that ends `no_answer`, `declined`, `timed_out`, or `failed` — or that
completes without a parseable structured result — does NOT advance the case:
the step returns `noop: true` and the state is unchanged (shuttle attempts
additionally leave a `round_failed` audit entry). The server does not schedule
retries; the case policy's `retry_delays_minutes` ladder documents the
intended pacing, and the caller is responsible for waiting it out before
stepping again. In live mode, re-stepping immediately after a `no_answer`
redials a human immediately — do not do that.

An attestation read-back that does not match the code also leaves the state
unchanged (still pending), so the caller may re-attempt. The verifier
tolerates exactly one bounded artifact observed on live calls — a false start
followed by the complete correct code — and still rejects any wrong, missing,
or inserted digit.

## Timing policy (recorded, not enforced by the server)

`caucus_open_case` accepts and records a policy:

- `call_window` `{start_hour, end_hour, timezone}` — the hours during which
  dialing is acceptable, callee-local. Default 09:00–20:00 America/New_York.
- `cooling_off_minutes` — intended pause between shuttle rounds. Default 0.
- `retry_delays_minutes` — retry ladder after unanswered calls. Default [15, 60].
- `max_rounds` (default 8) and `ttl_hours` (default 72) — these two ARE
  enforced by the state machine: exceeding `max_rounds` produces `impasse`,
  and any step after the TTL produces `expired`.

The window, cooling-off, and retry ladder are honored by a caller that chooses
to honor them; `caucus_step_case` itself dials whenever invoked. Check the
policy via `caucus_case_status` and pace live steps accordingly.

## Attestation

When a round's offer is accepted, the settlement terms `{amount_cents,
conditions}` are canonicalized and hashed (SHA-256). Two encodings of that
digest exist:

- the **terms digest** (full 64-hex) — stored in the ledger and the memo; what
  an auditor recomputes;
- the **attestation code** (digest mod 10^6, six digits) — what each party
  hears and reads back on their attestation call.

Because the code is a pure function of the terms, both parties reading back
the same code is evidence both were read the same terms — not a paraphrase.
Each party attests on a SEPARATE call, and `caucus_verify_case` checks the
calls are distinct. The code is not a secret and not a bearer token; the
digest carries the cryptographic weight.

## Ledger and rehydration

Every accepted transition appends one or more entries to a per-case
hash-chained ledger (`hash = SHA-256(prev_hash + canonical(entry))`):
`case_created`, `consent_recorded`, `consent_declined`, `offer_recorded`,
`round_failed`, `settlement_proposed`, `attestation_recorded`,
`case_settled`, `case_impasse`, `case_cancelled`, `case_expired`.

The ledger is the only durable state. The MCP server rebuilds any case from
its entries after a restart, so `case_id` remains valid across server
restarts as long as the same `CAUCUS_DB` file is used. `caucus_verify_case`
recomputes every hash and link; any tampered byte breaks the chain at a
reported sequence number.
