# Example Preview And Reconciled Brief

For the fictional GO fixture, preview emits a masked recipient such as `+12*****0123`, `call_placed: false`, the exact task and result schema, a stable `sha256:` approval digest, and a `scope-signal:` idempotency key. It states that exact preview approval is still required before any external `run_call`.

After fixture reconciliation, the deterministic human-review brief has this shape:

```json
{
  "recommendation": "GO",
  "reasons": ["All required facts have explicit callee transcript evidence, funding is secured, and no unresolved risks were stated."],
  "verified_facts": ["contact_identity: Jordan Lee", "contact_role: Operations Director"],
  "unresolved_facts": [],
  "unresolved_risks": "NONE",
  "final_decision_owner": "human",
  "decision_notice": "GO describes evidence completeness only. A human must accept or reject the project."
}
```

The actual fixture output contains all fields in deterministic order. It never says that the freelancer accepted the project.
