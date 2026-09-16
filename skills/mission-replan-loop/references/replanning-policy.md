# Replanning policy

| # | Rule |
|---|---|
| R1 | New evidence may invalidate an assumption. |
| R2 | A mandatory constraint violation invalidates the strategy. |
| R3 | Uncertain evidence never satisfies a hard constraint. |
| R4 | A replan must materially differ from the strategy that failed. |
| R5 | A failed strategy stays in history; it is never overwritten. |
| R6 | A proposed next operation must pass host policy before execution. |
| R7 | An execution failure never invalidates a strategy. The target was not asked. |
| R8 | An execution failure stops the loop: the next target fails identically. |
| R9 | A `lte` time constraint is bounded by the present as well as the requirement. |
| R7 | No safe viable alternative → escalate. |

## Valid replan triggers

`CONSTRAINT_VIOLATED` · `ASSUMPTION_INVALIDATED` · `TARGET_UNAVAILABLE` · `CALL_FAILURE` ·
`CRITICAL_EVIDENCE_CHANGED` · `TIME_WINDOW_CHANGED`

Not a valid trigger: *"the model thinks another option looks better."* Every trigger must
be inspectable.

## Anti-loop guards

```yaml
limits:
  max_replans: 3
  max_retries_per_operation: 2
  reject_duplicate_strategy: true
```

Exhausted → `escalation: { required: true, reason: "Adaptive loop limit reached." }`

## Time awareness

Every replan receives the current time, the deadline and the remaining window. A strategy
that was viable thirty minutes ago may no longer be.


## Recipient failure or execution failure

The budgets above assume the contact was reached and did not help. They do not
apply when the platform could not place the call.

```
call did not yield evidence
├── recipient failure  no answer, busy, declined, voicemail
│   └── spend a retry, then invalidate and move to the next target
└── execution failure  unsupported destination, malformed request, auth error
    └── spend nothing. The strategy stands as `not_evaluated`; escalate.
```

Walking the candidate list on an execution failure costs the whole budget and
produces a conclusion — *"no candidate could be reached"* — that is false in the
only way that matters: it describes the carriers, and the fault was yours.
