# Result contract v1

Two schemas, deliberately not the same object.

The **extraction schema** is what CALL-E is asked to fill in. It describes
only what a person on the call can say, and it never asks the model to
decide anything: no value, no probability, no recovery estimate. The
**business result** is what the application is willing to assert. It is
derived from the extraction under transcript grounding, never copied from
it.

## claim_status

| Value | When |
| --- | --- |
| `STATED_REJECTED` | The representative stated the claim is rejected in their system. |
| `STATED_RETURNED` | The representative stated it was returned for correction. |
| `STATED_IN_PROCESS` | The representative stated it is being processed. |
| `STATED_PAID` | The representative stated it was paid. |
| `UNKNOWN` | Anything hedged, conditional, deferred to a record they could not see, or never discussed. |

This is the counterparty's statement about their own system, not an
adjudication of the claim and not a copy of the source record's status. A
definitive status requires an evidence quote grounded in a counterparty
turn; a status whose quote carries a hedge is reduced to `UNKNOWN` and the
reduction is recorded.

## Stated fields

Each of these is asserted only when traceable to a counterparty turn, close
enough to their own words to be found by containment:

| Field | Rule |
| --- | --- |
| `stated_reason` | The reason they gave for the hold, rejection, return or non-payment. |
| `required_correction` | The correction they asked for, one sentence. |
| `required_documents` | One entry per document, in their words. Empty is normal. |
| `stated_deadline` | Exactly as stated. A duration is not turned into a date. |
| `escalation_path` | Where they said to escalate, in their words. |
| `stated_next_action` | The single next step they asked for, or omitted. |

## confirmed_reference

A claim, case or credit reference (`reference_kind` of `CLAIM`, `CASE` or
`CREDIT`) is asserted only when it reached `CONFIRMED_IDENTIFIER` through
its own read-back exchange — see `identifier-confirmation.md`. Grounding is
deterministic and conservative: `DIRECT_COUNTERPARTY_QUOTE` when the
complete reference was spoken by the counterparty in one utterance, or
`CONFIRMED_BY_READBACK` when the agent's complete read-back was immediately
and unambiguously confirmed. Anything less leaves the value as an
unconfirmed candidate for human review, and it never enters a write-back
note.

## Terminal states

A workflow outcome carries a transport state and a business state, and they
are answers to different questions.

| Terminal state | Meaning |
| --- | --- |
| `NOT_ATTEMPTED` | A gate refused, or nothing was sent. |
| `IN_FLIGHT` | The call has not reached a terminal state. |
| `TRANSPORT_FAILED` | The call ended without completing. There is no business outcome. |
| `RESULT_UNAVAILABLE` | The call completed with no schema-valid structured result. |
| `INFORMATION_OBTAINED` | The call completed and produced grounded stated values. |
| `ACTION_REQUIRED` | Something specific is needed before this can move. |
| `BUSINESS_UNRESOLVED` | The call completed and settled nothing. |

`TRANSPORT_FAILED` always carries `claim_status: UNKNOWN`. A call nobody
answered is not a claim status.
