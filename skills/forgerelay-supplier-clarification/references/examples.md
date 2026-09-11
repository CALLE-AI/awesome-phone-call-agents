# Examples

All phone numbers and organizations in these examples are fictional.

## Valid Dry Run

Input:

```json
{
  "requestId": "RFQ-DEMO-1042",
  "supplierLabel": "Northstar Prototype Works",
  "phoneNumber": "+15550101234",
  "outreachBasis": {
    "type": "inbound-follow-up-request",
    "reference": "Fictional inbound quote Q-DEMO-1042 requested a clarification call."
  },
  "callerIdentity": "ForgeRelay on behalf of Example Manufacturing",
  "questions": [
    {
      "id": "material-grade",
      "category": "material-specification",
      "prompt": "Can you confirm whether the quoted material is 6061-T6 aluminum?",
      "required": true
    },
    {
      "id": "drawing-revision",
      "category": "drawing-revision",
      "prompt": "Which drawing revision did you use for the quote?",
      "required": true
    }
  ],
  "allowedContext": [
    "Request id RFQ-DEMO-1042",
    "Part label BRACKET-DEMO",
    "The currently approved drawing revision is B"
  ],
  "resultTarget": "skills/forgerelay-supplier-clarification/assets/results/RFQ-DEMO-1042.csv"
}
```

The first validation returns `pending-safety-review` with the exact prompts, basis, allowed context, caller identity, result path, `safetyReviewHash`, and idempotency key. After a reviewer inspects that preview and adds the matching `safetyReview` object, the expected preview is:

```text
status: dry-run
request: RFQ-DEMO-1042
supplier: Northstar Prototype Works
destination: +1*******1234
questions: material-grade, drawing-revision
result target: .../skills/forgerelay-supplier-clarification/assets/results/RFQ-DEMO-1042.csv
real call placed: no
```

After the user approves this exact preview, the agent may prepare one CALL-E plan. Approval does not authorize a retry or a call to a different number.

## Reject Missing Outreach Basis

Reject the task when `outreachBasis` is missing, is not structured, has an unsupported type, or says only that the number appeared on a public website.

```text
status: blocked
blocker: recipient outreach basis is not documented
real call placed: no
```

## Reject Commercial Commitment

Reject or remove this question:

```text
Can you agree to a fixed price of USD 2,000 and guarantee delivery next Friday?
```

It asks the agent to negotiate and create commercial commitments. A safe alternative is:

```text
Which price and estimated lead time were stated in your submitted quote?
```

The result must be recorded as a supplier statement for human review, not as an accepted term. A commercial-action prompt is blocked deterministically; other free text remains pending until its exact content hash is reviewed.

## Reject A Prose Result Target

Reject `"resultTarget": "ForgeRelay clarification record"`. The target must be a writable, new local `.csv` path, and the validator never creates or overwrites it.

## Recipient Requests A Human

If the recipient asks to speak with a human:

```json
{
  "requestId": "RFQ-DEMO-1042",
  "status": "partial",
  "answered": [],
  "unresolvedQuestionIds": [
    "material-grade",
    "drawing-revision"
  ],
  "recipientRequestedHumanFollowUp": true,
  "notes": [
    "Recipient requested a human follow-up."
  ]
}
```

End the call. Do not place another call automatically.
