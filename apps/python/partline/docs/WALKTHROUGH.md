# Three-minute product walkthrough

## 0:00 to 0:25, the problem

Show the fictional Line 4 outage request. Explain that three approved suppliers have to be called before the shipping cutoff and a wrong alternate can prolong downtime.

## 0:25 to 0:55, preview and safety

Run:

```bash
partline preview fixtures/example-request.json
```

Point out masked numbers, the three-call side effect, the exact task, the no-purchase boundary and the request-bound approval token. State that no call has happened.

## 0:55 to 1:40, CALL-E execution

After replacing the fictional numbers with owned test numbers and obtaining approval, show the live command. Explain the single multi-recipient CALL-E task, structured recipient schema and stable idempotency key. Show CALL-E adapting when a supplier offers an alternate or asks for clarification.

## 1:40 to 2:30, evidence-backed comparison

Open the local evidence console:

```bash
partline web
```

Show that the exact match ranks first. The alternate requires human follow-up and the email-only response remains unresolved. Inspect the masked call plan, then record a local buyer review to reinforce that evidence and purchase authority are separate.

## 2:30 to 3:00, impact

Close with the product boundary: PartLine compresses repetitive phone research into one reviewable workflow, but the buyer still approves engineering substitutions and every commercial commitment.

## Recording checklist

- Use owned or explicitly authorized test numbers.
- Never expose an API key, full phone number or raw transcript.
- Include one real CALL-E call in the final recording.
- Keep the fixture-labelled comparison for repeatability.
- Show the repository and tests briefly.
