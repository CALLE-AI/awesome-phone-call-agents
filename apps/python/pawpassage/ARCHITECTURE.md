# PawPassage architecture

## Components

| Component | Responsibility | Trust level |
| --- | --- | --- |
| Closed case parser | Reject unsupported regions, invalid E.164 values, region/calling-code conflicts, extra fields, and non-HTTPS sources | Local deterministic |
| Preview builder | Compile three propositions into one bounded task and mask the recipient | Local deterministic |
| Approval receipt | Bind a human decision to the full preview digest and mode | Human-controlled local record |
| SQLite call ledger | Reserve intent before network, enforce one create, and record transitions | Durable local source of workflow truth |
| Official SDK adapter | Call `CalleClient.calls.create` once, then read the known call | External side-effect boundary |
| Fake CALL-E server | Exercise the SDK request path on loopback without credentials or calls | Test/demo only |
| Binding validator | Match call ID, task, metadata, recipient, phone, and attempt count | Local deterministic |
| Closed result evaluator | Preserve contradictions and choose an evidence disposition | Local deterministic |
| HTML/JSON report | Present masked evidence for human review | Non-authoritative output |

## State machine

```text
                     deterministic 4xx
RESERVED --------------------------------------> REJECTED_BEFORE_START
   |
   | create accepted with bound call ID
   v
ACCEPTED ---- verified completed result ------> TERMINAL_VERIFIED
   |                                                 |
   | missing/conflicting/failed terminal             +--> evidence disposition
   v
NEEDS_HUMAN

RESERVED ---- timeout / connection / 408 / 409 / 429 / 5xx
   |
   v
SUBMISSION_UNKNOWN

Any repeated execution at any state: return the existing record; zero create calls.
```

A wait timeout, failed status read, or nonterminal response leaves a bound
call in `ACCEPTED`, with its ID and a pending-read reason preserved. Explicit
`reconcile-live` performs one GET request against that ID. An expired approval
does not prevent reading, but its content binding and mode remain mandatory.
Binding mismatches and malformed terminal results stay quarantined.

The potentially dangerous crash point is between provider acceptance and the
local `ACCEPTED` write. Because the prior `RESERVED` record already exists, a
restart refuses to submit again. This may require manual reconciliation, but it
cannot silently create a duplicate call.

## CALL-E wire contract

The adapter uses the current official Python SDK call surface:

- `calls.create(task, recipients, recipient_result_schema, metadata,
  idempotency_key)`;
- `calls.wait_for_result(call_id, interval_seconds, timeout_seconds)`; and
- `calls.get(call_id)` for explicit reconciliation.

There is one recipient and one phone. The recipient result schema uses only
objects, strings, required fields, closed `enum` values, and
`additionalProperties: false`. No union, free-form narrative, or nullable
field is transmitted.

## Why propositions instead of free-form questions

A proposition is stable enough to hash, approve, extract, compare, and show to
a reviewer. It also constrains disclosure: the call asks whether the statement
is confirmed, contradicted, or not established. A free-form travel-planning
agent could expand scope, collect sensitive facts, or mistake advice for
authority.

## Aggregate result

Checkpoint outputs are deliberately weaker than a clearance:

| Result | Meaning |
| --- | --- |
| `EVIDENCE_PACKET_READY` | All three propositions confirmed and written follow-up offered |
| `GAPS_FOUND` | At least one proposition explicitly contradicted |
| `NEEDS_HUMAN_REVIEW` | Missing fact, wrong role, no written reference, or commitment boundary |
| `NEEDS_HUMAN_RECONCILIATION` | Provider acceptance or terminal meaning is uncertain |
| `DO_NOT_CONTACT` | Recipient opted out or consent was not confirmed |

A journey of all-ready checkpoints becomes
`EVIDENCE_COMPLETE_FOR_HUMAN_REVIEW`, never `CLEARED` or `APPROVED`.
