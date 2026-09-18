# Safety: call-attest-challenge-auth

## Honest security model

- This protocol proves ONE-TIME PRE-SHARED COORDINATION over a phonetic
  channel, nothing more. It gives no resistance to a determined
  man-in-the-middle who can hear the code and relay it; this file and the
  SKILL.md say so explicitly.
- The spoken code is audible to anyone on the call or recording it. Never
  use it to authenticate a human or protect high-value operations.
- Fuzzy matching (edit distance <= 1 per token) trades a little strictness
  for ASR noise; a near-miss code still fails closed to FAILED_MISMATCH.

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

## Data handling

- The skill never places calls and makes no network requests.
- Evidence spans are masked: any 7+-digit run keeps only its last 2
  characters.

## Test-call policy

Any live verification must target fictional +1 555-01xx numbers or the
organization's published test hotline, per repository policy.
