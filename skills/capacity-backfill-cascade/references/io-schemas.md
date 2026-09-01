# capacity-backfill-cascade input and output schemas

## reservations.jsonl (one JSON object per line)

| Field | Type | Notes |
| --- | --- | --- |
| booking_id | string | unique id, e.g. R-001 |
| name | string | guest name |
| phone | string | E.164 number; fictional reserved numbers in samples |
| party_size | integer | seats needed |
| slot | string | ISO 8601 datetime with timezone |
| consent | boolean | must be true to dial |
| status | string | PENDING_CONFIRM, CONFIRMED, CANCELLED, RESCHEDULED, NO_ANSWER, RECOVERED |

## waitlist.jsonl

| Field | Type | Notes |
| --- | --- | --- |
| entry_id | string | unique id, e.g. W-001 |
| name | string | guest name |
| phone | string | E.164 number; fictional reserved numbers in samples |
| party_size | integer | seats needed |
| window_start | string | ISO 8601 datetime; earliest acceptable slot |
| window_end | string | ISO 8601 datetime; latest acceptable slot |
| priority | integer | lower is called first |
| consent | boolean | must be true to dial |
| status | string | WAITING, OFFERED, ACCEPTED, DECLINED, NO_ANSWER, EXHAUSTED |

## OUTCOME protocol

Every live call goal begins with self-identification as an automated assistant
(disclosure by design) and instructs the agent to end the call by stating exactly one
of:

- Confirm calls: OUTCOME: CONFIRMED, OUTCOME: CANCELLED, OUTCOME: RESCHEDULED,
  OUTCOME: NO_ANSWER
- Offer calls: OUTCOME: ACCEPTED, OUTCOME: DECLINED, OUTCOME: NO_ANSWER

The client parses the trailing OUTCOME token from the call summary and maps it to the
record status. Unparsable completed calls become ERROR and are escalated to staff.

## Outputs

- `state/runs/<run-id>/audit.jsonl` - append-only decision log
- `state/runs/<run-id>/report.md` - masked staff report
