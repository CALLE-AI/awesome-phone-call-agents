# Two-Call Pattern Reference

This skill introduces the first multi-call state-passing pattern in the awesome-phone-call-agents repo. Other builders can copy this pattern for any domain.

## Core Idea

Call 2 is not independent. It uses the `structured_result` of Call 1 as its input context.

```
Call 1 -> structured_result -> validates exit gates -> feeds into Call 2 task text
```

## Pattern Components

### 1. Exit Gates

Before dispatching Call 2, the orchestrator checks:
- Did Call 1 reach `outcome: "completed"`?
- Is the minimum required data present? (in this skill: `policy_number_confirmed`)

If either check fails -> human review queue, not Call 2.

### 2. Context Injection

Call 2's task text is a function, not a string. It receives the full `ChainContext`, which includes Call 1's structured result. This lets the agent reference specific facts from the first call (policy number, incident description) without the operator having to re-supply them.

### 3. Dependency Declaration

Each `CallStep` has an optional `dependsOn` field (step ID string). The `ClaimChain` class enforces this automatically — no boilerplate needed in the task builder.

## Adapting This Pattern

To use this for a different domain (mortgage, healthcare, logistics):
1. Copy `ClaimChain.ts` from the app — it is fully domain-agnostic
2. Write your own task builder functions (see `call1-loss-report.ts`)
3. Define your own result schemas in JSON Schema draft-07
4. Register steps in order with `chain.addStep()`
5. Keep `dryRun = true` as the default in all demos

## Key Constraint

The orchestrator never assumes Call 1 succeeded. Every call result is verified before it gates the next step. Silence is not consent. Voicemail is not completed. An ambiguous outcome is never retried automatically — it always routes to a human.

## Sequence

```
Operator
  |
  v
ClaimChain.execute(phone, caller, dryRun)
  |
  +-- Step: loss_report
  |     task = buildLossReportStep().taskText(ctx)
  |     -> caller(phone, task, schema) -> { callId, outcome, structured_result }
  |     -> validates exit gates
  |
  +-- Step: coverage_verify  (dependsOn: "loss_report")
        task = buildCoverageVerifyStep().taskText(ctx)
              ctx.results["loss_report"] is available here
        -> caller(phone, task, schema) -> { callId, outcome, structured_result }
  |
  v
ChainResult { completed, steps, humanReviewRequired, humanReviewReason }
```
