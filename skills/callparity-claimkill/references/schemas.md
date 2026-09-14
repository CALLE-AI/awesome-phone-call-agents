# Schemas

## Claim node

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | Stable claim id such as `dock`. |
| `text` | string | Party A's claim in one sentence. |
| `evidence.span.quote` | string | Verbatim source span. May be empty. |
| `observable_of` | string | The freight observable this node tests. |
| `status` | enum | `SUPPORTED`, `UNTESTED`, `CONTRADICTED`, `UNREACHABLE`, `ABSTAIN`. |
| `confidence` | number | Below 0.45 forces `ABSTAIN`. |
| `party` | string | Usually `A` for the quoted source. |

`CONFIRMED` is an input alias of `SUPPORTED`. The engine stores and emits `SUPPORTED` only.

## Graph edge

| Field | Type | Notes |
| --- | --- | --- |
| `claim_id` | string | Node that was tested. |
| `tested_by` | string | Call id or question id that tested the claim. |

## Refutation question

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | Stable question id. |
| `text` | string | Spoken question for Party B. |
| `targets` | string[] | Claim ids this question could falsify. |

`leak_score` and `spoken_seconds` are computed. They are not stored on the fixture.

## Merge event

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | Call id used on `tested_by` when a quote omits a question id. |
| `disposition` | string | `completed`, `voicemail`, `no-transcript`, or `unreachable`. |
| `quotes[].claim_id` | string | Node the quote addresses. |
| `quotes[].quote` | string | Party B span. |
| `quotes[].polarity` | string | `contradicts`, `supports`, or empty. Empty means no falsifier. |
| `quotes[].tested_by` | string | Optional question id. |

Could-not-verify in a human summary maps to `UNREACHABLE`, `ABSTAIN`, or `UNTESTED`. Merged graph JSON also sets `overall` to `SUPPORTED`, `CONTRADICTED`, or `could-not-verify`.
