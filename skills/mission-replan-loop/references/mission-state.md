# Minimal mission state

Keep the reusable schema small. Do not reproduce a full product domain model.

```yaml
mission:     { id, objective, deadline }
constraints: []          # key, operator, value, mandatory
strategy:    { id, type, target, status }
evidence:    []          # fact, value, source_call, target, confidence, status
history:     { strategies: [] }   # failed strategies are never deleted
operations:  []
```

## Evidence policy

Each fact records: `value`, `type`, `source_call`, `target`, `timestamp`, `confidence`,
`status`. A strategy-changing event must always be able to answer:

> Which phone interaction caused this?

## Strategy status

| Status | Meaning |
|---|---|
| `valid` | the current strategy can continue |
| `invalid` | validated evidence violates a mandatory constraint |
| `uncertain` | evidence is ambiguous or insufficient → clarify |
| `infeasible` | no permitted viable strategy remains → escalate |
