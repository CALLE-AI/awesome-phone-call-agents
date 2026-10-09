# Evidence table

Every executed row below carries **exactly one evidence class** — `Recorded
CALL-E result`, `Synthetic scenario` or `Fictional case data` — one command
that anyone can run from this checkout, and one expected result. Failed
attempts and rows that were never executed are **limitations, not
evidence**. The row statuses here mirror the machine-readable registry in
`warrantyops/cassettes.py` (`REGISTRY`), which tests check this file
against; a row cannot be added, upgraded or reclassified by editing prose.

## Executed evidence

| Row | Evidence class | Command | Expected result |
| --- | --- | --- | --- |
| R1 — runtime proof call | `Recorded CALL-E result` | `python3 -m warrantyops --proof-screen` (linked receipt: `proof/runtime-proof-receipt.public.json`) | transport `completed`, terminal `INFORMATION_OBTAINED`, `claim_status: UNKNOWN` (honestly), reference BR-4821 grounded by the verbatim quote "Br Hyphen, 4821.", masked call id `call_dMU…A-3Q`, write-back withheld. Cassette unavailable — recorded before the cassette program; never reconstructed. |
| R3 — live post-routing-fix call | `Recorded CALL-E result` | `python3 -m pytest tests/test_r3_recorded_cassette.py -q` | transport `completed`; person reached (`true` — non-empty counterparty transcript, 18 turns); agent stayed on the NorthStar claim-status inquiry; callee responses did not produce claim-status information, so `claim_status: UNKNOWN` (honestly); write-back withheld. Routing: `IN`/`en-IN`. |
| R4 — recorded owned-number no-answer | `Recorded CALL-E result` | `python3 -m pytest tests/test_r4_recorded_cassette.py -q` | one provider create and zero retries; transport `failed`; no transcript or person-derived status; terminal `TRANSPORT_FAILED`; `claim_status: UNKNOWN`; write-back withheld. Sanitized cassette replays through the real adapter contract. |
| R2 — stated status still needs review and recheck | `Synthetic scenario` | `python3 -m pytest tests/test_r_series_synthetic.py -k r2 -q` | a grounded `STATED_RETURNED` still refuses write-back without an approved decision (`NOT_REVIEWED`) and still rechecks the source (`SOURCE_CHANGED`). Never executed live, by freeze. |
| R3 (synthetic counterpart) — misread reference corrected | `Synthetic scenario` | `python3 -m pytest tests/test_r_series_synthetic.py -k r3 -q` | heard `CASE48171`, corrected to `CASE48178` through its own read-back exchange; only the corrected value asserted. |
| R4 (synthetic counterpart) — no result, no invented status | `Synthetic scenario` | `python3 -m pytest tests/test_r_series_synthetic.py -k r4 -q` | terminal `TRANSPORT_FAILED` with the exact failure code kept; `claim_status: UNKNOWN`; nothing written. |
| R5 (synthetic counterpart) — supplied keypad plan unresolved | `Synthetic scenario` | `python3 -m pytest tests/test_r_series_synthetic.py -k r5 -q` | a *supplied* plan that evidence says did not resolve ends `MENU_UNRESOLVED`; a discovered navigation never does. |
| R6 (synthetic counterpart) — the desk hedges | `Synthetic scenario` | `python3 -m pytest tests/test_r_series_synthetic.py -k r6 -q` | a grounded but hedged quote is kept as evidence while the asserted status stays `UNKNOWN` with a named downgrade. |
| R7 (synthetic counterpart) — same key, same body | `Synthetic scenario` | `python3 -m pytest tests/test_r_series_synthetic.py -k r7 -q` | the second identical run refuses `DUPLICATE_CALL_SUPPRESSED` at the local ledger before any provider; only local suppression is claimed. |
| P14 — 100 sequential FakeCalle reviews | `Synthetic scenario` | `python3 -m pytest tests/test_p14_sequential_reviews.py -q` | 100 reviews: one unique receipt byte string, zero provider creates, zero recipient numbers in the captured event stream. |
| Adversarial page — eighteen attacks | `Synthetic scenario` | `python3 -m warrantyops --verify-adversarial` | exit 0, byte-identical regeneration of `proof/adversarial.html`, every refusal produced by executing the real kernel. |
| Proof screen — W-1042 before/after | `Fictional case data` | `python3 -m warrantyops --verify-proof-screen` | exit 0, byte-identical regeneration; the case is labelled fictional throughout. |

No other row is executed evidence. No row above claims a platform
observation that was not recorded (the remaining synthetic counterparts are
software proofs, never platform observations).

## Failed authorized attempts — not evidence

R8 was separately authorized and separately gated. It created exactly one provider call and used zero retries. It ended as a zero-duration `404` that surfaced as `call_failed`, with `transcript_turns: 0`, no person reached,
`claim_status: UNKNOWN`, and write-back withheld. The `+91…` attempt was
sent `US`/`en-US` routing — a closed routing defect — but the available
data does not independently prove that this caused the carrier/platform
failure. No sanitized cassette or public receipt is published for this row;
the private artifacts remain outside the repository. **R8 is not evidence**
and is not retried. Subsequent R8b attempts on 13 September (2026-09-13)
also failed: one `404` (carrier number-not-reachable on the practitioner's
number), one `408` (timeout, no ring), and one `500` (CALL-E server error).
These are infrastructure failures, not product failures, and are recorded
as known limitations.

| Row | Authorized observation it did not make | Outcome |
| --- | --- | --- |
| R8 | spoken field acceptance through a consenting warranty professional | attempted/failed — one create, zero retries, no transcript, `UNKNOWN`; not evidence |

## Limitations — rows never executed

These rows are **planned/gated** and owner-optional. They carry no evidence
class because they produced no artifacts; they exist here only so their
absence is explicit. No live call, recording, publication or submission is
authorized by this table. The R-series is stopped.

| Row | What it would observe | Status |
| --- | --- | --- |
| R5 (recorded) | real Calls API keypad support and `MENU_UNRESOLVED` shape (owned menu only) | planned/gated — not executed; no platform fact observed |
| R6 (recorded) | whether a hedge survives real ASR and whether the structured result attempts to fill status | planned/gated — not executed; no platform fact observed |
| R7 (recorded) | provider replay behavior, same-key/same-body only | planned/gated — not executed; only local suppression is claimed |
| R9 | Goal comparator, only if the Goal transcript-capability probe passes | planned/gated — probe-gated; not executed |
| R1b | new recorded baseline under the uniform gates | planned/gated — separately authorized; R1 is never re-run |

See `docs/known-limitations.md` for the narrative form of these limitations.
