# capacity-backfill-cascade flow

## Phases

```text
reservations.jsonl      waitlist.jsonl
        |                     |
  [confirm phase]             |
  call PENDING_CONFIRM        |
  consent=true records        |
        |                     |
  OUTCOME per booking         |
        |                     |
  CANCELLED slots ------> [cascade phase]
                          match: consent, WAITING,
                          party size within tolerance,
                          slot inside entry window,
                          sort by priority ascending
                                |
                          call until ACCEPTED
                                |
  [writeback] stores + audit + masked report
```

## Decision table

| Situation | Action |
| --- | --- |
| consent=false | skip, audit SKIPPED_NO_CONSENT |
| target already dialled this run | skip, audit SKIPPED_DUPLICATE |
| outside call window | skip, audit SKIPPED_OUT_OF_WINDOW |
| budget exhausted | stop before dialing, write back state |
| booking CANCELLED | start cascade for that slot |
| waitlist ACCEPTED | mark slot RECOVERED, stop cascade for the slot |
| waitlist DECLINED | try the next candidate |
| NO_ANSWER after retries | escalate in the staff report |
| operator cancels the run | audit CANCELLED_BY_OPERATOR, refuse further dials |
