# Lead Qualification Examples

From the `skills/lead-qualification-call` directory, run the fictional fixture:

```bash
node scripts/validate-lead-input.mjs assets/sample-lead-request.json
node scripts/preview-lead-call.mjs assets/sample-lead-request.json
```

Expect `VALID`, then a `DRY-RUN PREVIEW` with a masked destination, the goal text,
and an illustrative result shape for human review. These commands use local data
only; they do not contact CALL-E, place a call, or update a CRM.

Before any live planning, follow the explicit one-call authorization and opt-out
checks in `SKILL.md` and [the safety notes](safety-notes.md). The displayed result
shape is an example, not an executable JSON Schema or a qualification decision.
