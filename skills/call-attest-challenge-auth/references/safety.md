# Safety: call-attest-challenge-auth

## Honest security model

- This is an offline coordination illustration, not authentication.
  Matching a supplied transcript to a supplied expected code proves neither
  identity nor authorized access. A listener can relay a heard code.
- The spoken code is audible to anyone on the call or recording it. Never
  use it to authenticate a human or protect high-value operations.
- Fuzzy matching (edit distance <= 1 per token) accepts some near-miss
  codes for ASR noise. VERIFIED is an advisory match label, not a safe
  authorization decision; never release sensitive information on its basis.

## Secret handling

- The shared secret is read from an environment variable
  (CALL_ATTEST_SECRET by default) and never accepted on the command line,
  where process listings could expose it.
- The expected code lives in the craft output only - the plan_call goal
  never contains it. Keep craft output local; do not commit it.
- Fixtures use the standards-reserved 555-01xx block and a throwaway
  example secret; no real secret appears in this repository.

## Replay detection

- The nonce ledger is append-only JSONL. Verification appends the nonce
  only on VERIFIED; a nonce already present yields REPLAY_SUSPECTED with
  an investigate_replay action.
- The ledger is advisory: without one, verification still works but
  replays are not detected.
- The local ledger does not provide concurrent/crash-proof replay defense.
  Keep the example sequential and do not use it for security decisions.

## Data handling

- The skill never places calls and makes no network requests.
- Evidence spans are masked: any 7+-digit run keeps only its last 2
  characters.
- This limited digit-run masking does not anonymize all phone formats,
  names, emails or private text. Keep real transcripts and cards private.

## Test-call policy

Use fictional fixtures only for offline tests; do not dial reserved example
numbers. Any separate host-run live test requires explicit per-run intent
and an authorized, valid E.164 destination. These helpers neither authorize
nor place calls; a suggested follow-up is not permission to call again.
