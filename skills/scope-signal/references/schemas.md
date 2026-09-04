# Input And Output Schemas

## Preview Input

The script accepts a closed JSON object. Unknown fields are errors.

```json
{
  "schema_version": "2.0",
  "request_id": "northstar-site",
  "freelancer_name": "Northstar Studio",
  "contact": {
    "name": "Jordan Lee",
    "organization": "Example Works",
    "phone_e164": "+12025550123"
  },
  "authorization": {
    "authorization_type": "explicit_request",
    "authorized_by": "Jordan Lee",
    "authorized_at": "2026-09-01T03:00:00Z",
    "purpose": "Verify the project brief for human review.",
    "source": "contact_written_consent"
  },
  "project_summary": "Design and build a five-page marketing website.",
  "known_context": ["Proposal requested after written discovery."],
  "language": "English",
  "region": "US"
}
```

`schema_version` is `2.0`. IDs use lowercase letters, digits, and internal hyphens. Text is bounded and scanned for credentials and sensitive numeric strings. `phone_e164` is `+` plus 8–15 digits. Authorization is a closed object: type is `explicit_request` or `explicit_consent`; source is `direct_user_request`, `contact_written_consent`, `contact_verbal_consent`, or `signed_project_agreement`; the timestamp must include a timezone, be no more than 90 days old, and not be future-dated; and purpose must exactly equal `Verify the project brief for human review.` Public listings, scraped sources, assumed or implied consent, and unrelated contact are rejected. Language and region are explicit and never inferred from the number.

The input deliberately has no accept, bid, counteroffer, or payment-authority field. Scope Signal only verifies facts.

## Preview Output

The strict preview contains:

- `schema_version`, `mode: "preview"`, and `call_placed: false`;
- request ID and masked contact;
- `approval_digest` and `idempotency_key` derived from canonical frozen content;
- `approval_required: true` and all live gates;
- the exact CALL-E `task` and `result_schema`;
- `provider_workflow: ["plan_call", "run_call", "get_call_run"]`;
- side-effect and retry statements.

The approval digest and idempotency key bind the full normalized authorization, recipient, request, task, result schema, project summary, context, contact identity/organization, language, region, and execution safety controls (`approval_required`, one-attempt limit, no automatic retries, no recurrence, exact provider workflow, and approval instruction). Preview includes only the masked phone and a safe authorization summary. The full phone exists only in the validated input and an explicitly requested handoff file.

Create that handoff only with `handoff --input INPUT --approved-digest DIGEST --output FILE`. Exact digest approval is mandatory. The file is created or replaced with mode `0600`; stdout reports only that it was written and that no call was placed.

## Completed-Call Fixture

```json
{
  "schema_version": "2.0",
  "approval_digest": "sha256:...",
  "idempotency_key": "scope-signal:...",
  "status": "COMPLETED",
  "run_id": "run-fictional-go",
  "transcript": [
    {"speaker": "agent", "text": "..."},
    {"speaker": "callee", "text": "..."}
  ],
  "result": {
    "contact_identity": {"value": "Jordan Lee", "quote": "I am Jordan Lee."},
    "contact_role": {"value": "Operations Director", "quote": "I am the Operations Director."}
  }
}
```

`result` must contain exactly the twelve required fact fields plus `unresolved_risks`. Each has string `value` and `quote`. Use `"unknown"` and an empty quote when not established. A quote is usable only when substantive and present as one exact span in exactly one `callee` turn. The reconciler derives values with field-specific parsers and rejects provider-value contradictions, duplicate quote reuse, agent speech, summaries, and unsupported values.

## Reconciled Output

The output contains `mode: "reconciled"`, masked contact, terminal status, every field with `verified`, conservatively derived `value`, exact `quote`, and `reason`, then a brief with recommendation, deterministic reasons, verified facts, unresolved facts, unresolved risks, and `final_decision_owner: "human"`. Phone numbers, email addresses, and account-like long numbers are redacted from all evidence and brief text. No full transcript is emitted.
