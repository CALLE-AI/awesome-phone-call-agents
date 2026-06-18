# Execution Modes

Use this reference when selecting the generated skill's approval and execution behavior.

## Modes

| Execution mode | Behavior | Best fit |
| --- | --- | --- |
| `dry-run-then-batch-approval` | Preview every eligible candidate and compiled call goal, then process the approved list serially after one explicit approval. | Default for most generated skills. |
| `per-call-approval` | Preview one candidate and compiled call goal at a time, then let the user approve, modify, or skip each call before planning and running it. | Higher-control workflows, sensitive edge cases, or early pilots. |
| `approved-direct-execution` | After a concrete processing request, validate candidates, run the runtime gate, compile call goals, inspect each provider plan, and serially run eligible one-off calls without another approval step. | Stable `fully-bound` or verified `parameterized-bound` workflows. |

## Selection Rules

Ask the user to choose the generated skill's execution mode after the binding level is known. If the user does not choose, use `dry-run-then-batch-approval`.

If source onboarding cannot support either binding level, do not choose an execution mode yet; complete the source and writeback contract first.

Use `approved-direct-execution` only when:

- binding level is `fully-bound` or `parameterized-bound`
- a concrete runtime request is required
- the runtime gate must pass before real calls
- provider plan inspection is mandatory for every candidate
- the request is one-off and not provider-side recurrence

## Runtime Request Standard

Accept concrete requests such as:

```text
Process all June 20 submissions.
Process yesterday's callable leads for campaign cmp_123.
Process appointments on 2026-06-20 from /path/to/appointments.csv.
```

Reject or clarify broad requests such as:

```text
Run the campaign.
Call everyone.
Process the leads.
```

When a request is insufficient, ask for the missing date window, source instance, campaign scope, CSV path, output path, or other runtime parameter.

## Direct Execution Guardrails

Generated skills that support `approved-direct-execution` must require:

- concrete runtime scope
- compatible binding level
- source access runtime gate
- required fields runtime gate
- consent or outreach basis runtime gate
- E.164 validation for every ready candidate
- trusted dedupe key or dedupe state
- verified writeback target or ready session-table fallback
- available MCP provider route, auth, and compatible tools
- inspected provider plan before each call run
- one-off provider request with no provider-side recurrence
