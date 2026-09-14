---
name: kol-ivr-route
description: Verify healthcare claim-status phone call results against transcript evidence and an independent IVR route receipt before any downstream use.
---

# Kol IVR Route

Use this skill when a user wants to chase a healthcare claim by phone, audit a CALL-E payer call, or decide whether a structured claim-status result is safe to use.

## Workflow

1. Confirm that the destination is an owned test fixture or that the user is authorised to call it. Do not collect or expose PHI in a demo.
2. Preview the exact destination, claim reference, intended department, question, expected charge, and whether the route is explore or replay.
3. Default to the no-call fixture path. Place a live call only after the user gives an exact authorised destination and understands that a submitted call cannot be cancelled through the public Developer API.
4. Ask CALL-E for strict structured output, but treat that output as a claim to verify, not as evidence by itself.
5. Require all of the following before `autoAccept=true`:
   - a completed payer-side response;
   - the requested claim reference repeated by the payer;
   - the claim-specific question present in the agent transcript;
   - an exact payer quote establishing the intended department;
   - exact payer quotes grounding status and every returned amount, date, and denial code;
   - a route receipt independent of the model result; and
   - agreement between reported and independently observed keypresses.
6. Quarantine a cached route when its prompts, destination, or receipt disagree. Explore on the next run; do not silently repair and auto-accept in the same call.
7. Label suggested next actions as operator policy unless the payer explicitly said them. Never present an inference as a quote.
8. Return `verified`, `needs_review`, `contradicted`, or `unreachable`, the failed checks, exact supporting spans, and the provenance of each field.

## Implementation

Use [`../../apps/typescript/kol/`](../../apps/typescript/kol/) for the runnable implementation.

```bash
cd apps/typescript/kol
npm install
npm run validate
npm run demo
```

Read [references/safety.md](references/safety.md) before a live call and [references/examples.md](references/examples.md) when interpreting the verdict.
