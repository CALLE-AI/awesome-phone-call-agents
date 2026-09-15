# Verdict taxonomy

Four verdicts, and no more, are shown to the user.

| Verdict | Meaning | Requires |
|---|---|---|
| `MATCH` | A recipient statement supports the asserted value. | a verbatim quote |
| `MISMATCH` | A recipient statement contradicts the asserted value. | a verbatim quote |
| `UNCLEAR` | The call produced information, but not enough - or not specific enough, or contradictory - to resolve to yes/no. | nothing; this is the honest default |
| `NO_CONTACT` | No usable conversation with a person happened (voicemail, IVR, no answer, call failed). | no recipient turns |

`UNCLEAR` is a feature. It means the skill reached someone but is declining to guess. Report
it as "we called and asked, but could not get a clear answer" - never as an error or a
failure to complete.

## Diagnostic tags (stored, not shown as a primary state)

`scripts/verdict.py` attaches these for the record and for later analysis:

- `AMBIGUOUS` - no verbatim quote for the claim
- `CONFLICTING` - recipient gave both a yes and a no
- `LOW_CONFIDENCE` - a quote exists but yields no definite yes/no
- `NO_CONTACT` - no conversation
- (a fuller call-outcome taxonomy - `VOICEMAIL`, `IVR`, `NO_ANSWER`, `BUSY`,
  `INVALID_NUMBER`, `UNSUPPORTED_REGION` - is derived from CALL-E's terminal call state
  when you pass the raw call object to `--transcript`)

## What each verdict does downstream

- `MATCH` / `NO_CONTACT` / `UNCLEAR`: recorded on the attestation, no further action.
- `MISMATCH` **with** an evidence quote: also written as a row in `corrections.csv`
  (`old_value` -> `new_value`, with the quote and the source).
- `MISMATCH` without a quote is impossible - it would have been forced to `UNCLEAR`.

## Expiry

Every attestation carries `attested_at` and `expires_at`. The window comes from the claim
pack's `expires_after_days` (default 90, mirroring common re-verification standards). An
attestation past its `expires_at` should be re-verified with a fresh call.
