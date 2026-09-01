# Result contract v0

Two schemas, deliberately not the same object.

The **extraction schema** is what CALL-E is asked to fill in. It describes only
what a person on the call can say. The **business result** is what the
application is willing to assert. It is derived from the extraction, never
copied from it.

## coverage_status

| Value | When |
| --- | --- |
| `COVERED` | The representative stated the failure is covered. |
| `NOT_COVERED` | The representative stated it is not. |
| `UNKNOWN` | Anything hedged, conditional, deferred to a record they could not see, or never discussed. |

`COVERED` and `NOT_COVERED` each require an evidence quote. A coverage decision
with no quote is reduced to `UNKNOWN` and the reduction is recorded.

## resolution_status

| Value | When |
| --- | --- |
| `RMA_ISSUED` | A return authorization was issued. |
| `REPLACEMENT_APPROVED` | A replacement was approved. |
| `REPAIR_APPROVED` | A repair was approved. |
| `DOCUMENTATION_REQUIRED` | They asked for a document or photograph. |
| `DIAGNOSTICS_REQUIRED` | They asked for a further test or reading. |
| `HUMAN_ACTION_REQUIRED` | They referred the matter onward. |
| `UNRESOLVED` | The call ended without any of these. |

The first three assert an authorization the operator will act on. Each is only
allowed to survive when the reference reached `CONFIRMED_IDENTIFIER`; otherwise
the resolution is downgraded to `HUMAN_ACTION_REQUIRED` and the reference is
dropped rather than reported.

## Other fields

| Field | Rule |
| --- | --- |
| `authorization_reference` | Populated only from a confirmed read-back. |
| `replacement_eta` | Exactly as stated. A duration is not turned into a date. |
| `return_deadline` | Exactly as stated. |
| `required_documents` | One entry per document, in their words. Empty is normal. |
| `next_action` | One sentence, or null. |
| `evidence` | Field name plus the words that establish it. Only quotes that survived every check. |

## Terminal states

A workflow outcome carries a transport state and a business state, and they are
answers to different questions.

| Terminal state | Meaning |
| --- | --- |
| `NOT_ATTEMPTED` | The authorization gate refused, or nothing was sent. |
| `IN_FLIGHT` | The call has not reached a terminal state. |
| `TRANSPORT_FAILED` | The call ended without completing. There is no business outcome. |
| `RESULT_UNAVAILABLE` | The call completed with no schema-valid structured result. |
| `BUSINESS_RESOLVED` | An authorization was established and confirmed. |
| `BUSINESS_ACTION_REQUIRED` | Something specific is needed before this can move. |
| `BUSINESS_UNRESOLVED` | The call completed and settled nothing. |

`TRANSPORT_FAILED` always carries `coverage_status: UNKNOWN`. A call nobody
answered is not a coverage decision.
