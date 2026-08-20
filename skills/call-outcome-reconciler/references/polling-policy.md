# Polling Policy

Polling always terminates. Two budgets run concurrently and whichever trips
first ends polling, so there is no code path that waits indefinitely.

## Budgets

| Budget | Default | Flag |
| --- | --- | --- |
| Wall clock | 900 seconds | `--max-seconds` |
| Observations | 60 | `--max-observations` |

Both are enforced. A call that stays non-terminal until a budget trips resolves
to `unresolved` with reason `polling_budget_exhausted`, carrying the last raw
payload and the full observation history.

## Backoff

Exponential with jitter: 2s, 4s, 8s, 16s, 32s, then capped at 60s. Jitter is
±10% of the current delay, which spreads retries when many reconciliations run
at once. A delay is never allowed to overrun the remaining wall-clock budget.

| Flag | Default | Purpose |
| --- | --- | --- |
| `--initial-backoff` | 2.0 | First delay between polls. |
| `--max-backoff` | 60.0 | Delay ceiling. |

The clock, the sleep function, and the jitter source are all injected, which is
why the test suite drives a five-day stuck call to exhaustion in microseconds
and gets a deterministic result.

## Choosing a budget

The default 15 minutes suits an interactive workflow. It is deliberately shorter
than the worst observed upstream hang: a call has been reported stuck in
progress for five days with no terminal webhook. A budget is not a prediction of
how long a call takes — it is a promise about when this layer will answer.

For a workflow that can afford to wait, raise `--max-seconds`. For one that
cannot, lower it and treat `unresolved` as "ask again later" rather than as a
failure. Either way the record is durable and the raw state is preserved, so a
later reconciliation of the same call reference is always possible.

## Transport errors

A failed status read is retried within budget and recorded in
`evidence.notes`. Transport errors never produce a semantic outcome on their
own. If every observation was a transport error, the outcome is `unresolved`
and the record says so explicitly.

## Timeouts

A request that times out with no recoverable state ends polling immediately with
reason `plan_timeout`, rather than being retried until the budget runs out. The
distinction matters: an exhausted budget means the call never reached a terminal
state, while a timeout means this layer could not read the state at all.

## Credentials

Authentication is re-checked before every poll cycle, because a token can expire
mid-poll. Two cases are treated differently on purpose:

* **Missing credentials at the start** are a configuration error. Reconciliation
  stops with a credential message and a non-zero exit code. It does not emit an
  `unresolved` record, because a setup mistake must not look like an ambiguous
  call outcome.
* **Credentials lost mid-poll** leave real observations already collected. Those
  are worth keeping, so the record is emitted with the loss recorded as
  evidence.

## Stopping and resuming

Polling runs in the foreground and stops when interrupted. Nothing is scheduled,
nothing runs in the background, and there is no job to cancel afterwards.

Reconciling the same call reference again later is always safe: it produces a
new record from fresh observations without side effects. That is the supported
way to revisit a call that was left `unresolved` because a terminal state had
not arrived yet.
