# FieldLine

A demo-first lone-worker check-in workflow built on [CALL-E](https://docs.heycall-e.com/).
The offline simulation demonstrates scheduled check-ins, a silent duress phrase,
retries, an escalation ladder and an incident brief. Live mode is an experimental,
human-supervised calling aid, not a safety service or emergency response system.
Do not rely on it as the only way to monitor a worker or request help.

## Quickstart: no calls, accounts or keys

Requires Python >=3.12 and [uv](https://docs.astral.sh/uv/).

```bash
uv sync
uv run fieldline demo --fast
uv run fieldline demo --scenario duress --fast
uv run fieldline demo --scenario safe --fast
uv run fieldline report
uv run pytest -q
```

Demo calls, people, transcripts and numbers are fictional. Demo mode never uses the
network. `FIELDLINE_DEMO` defaults to true even if a key is present.

## Live setup and explicit authorization

```bash
uv sync --extra live
cp .env.example .env
```

Create your own credential through the [CALL-E dashboard](https://dashboard.heycall-e.com/account/api-keys).
Keep `CALLE_API_KEY` private in the ignored local `.env`, and set
`FIELDLINE_DEMO=false` only when ready. Credentials can go only to
`https://api.heycall-e.com`; other origins, URL credentials, paths, queries and
fragments are rejected. HTTP redirects, connection retries and environment proxies
are disabled. The SDK version is pinned to the one covered by offline transport tests.
Never paste keys into plans, terminal commands, logs or source control.

Prepare a private YAML plan based on `examples/trip.yaml`. Use the intended local
calendar date, times and consenting recipients. Every number must be ASCII E.164:
`+`, a nonzero first digit, then a total of 8–15 digits. Never enter emergency-service
numbers. The final contact is a person responsible for deciding any emergency action.

For each operation, repeat `--authorize-phone` for each intended destination.
The set must exactly match the worker for `checkin-now`, or the worker and all
escalation contacts for `start`. Plan inclusion alone does not authorize a call.
The following variables stand for numbers you have independently verified and
whose recipients have authorized the calls; do not use the example's fictional numbers.

```bash
uv run fieldline checkin-now private-trip.yaml --authorize-phone "$WORKER_PHONE"
uv run fieldline start private-trip.yaml \
  --authorize-phone "$WORKER_PHONE" \
  --authorize-phone "$BUDDY_PHONE" \
  --authorize-phone "$COORDINATOR_PHONE"
uv run fieldline end
```

Before calls, review the masked destination list and type `LIVE`. This confirms
recipient consent and authorizes sending the plan, duress phrase and calling
instructions to CALL-E. There is no `--yes` bypass. No live test call is needed to
validate this contribution; all automated tests use fakes or in-memory HTTP.

## Supported dates and scheduling

- Times are local to the machine running FieldLine, without timezone conversion.
  Confirm its clock and timezone yourself before using live mode.
- Only same-day plans are supported: canonical `YYYY-MM-DD` and `HH:MM`, start
  strictly before end, and unique increasing check-ins within that window.
  Cross-midnight plans are rejected rather than rolled into another day.
- `start` must run on the plan date, no later than the first check-in instant.
  It may wait before the window starts. An old plan never runs on a new date.
- `checkin-now` is allowed only within the plan's date and start/end window.
- Date/window checks repeat immediately before every call. Retries and escalation
  delays that exceed the end or cross midnight stop for human review. No wrapped
  wall-clock arithmetic can authorize an immediate next-day retry.
- Grace is 0–1440 minutes, retry interval 1–1440 minutes, and maximum retries 0–10;
  all must be integers. Large intervals still cannot extend the plan window.
- This local process must remain running. There is no hidden recurring scheduler,
  background service, recovery daemon or automatic restart.

## Live outcome boundaries

An exception, timeout, connection error, redirect or nonterminal/unusable provider
response leaves the outcome unknown. FieldLine stops all automatic calls immediately,
including retries and ladder progression. It does not turn uncertainty into
`NO_ANSWER`. The same dispatcher cannot be reused after uncertainty.

Only a completed response with an explicit no-answer disposition bound to the single
intended phone, consistent no-answer attempts, and no generated result/transcript can
advance the configured missed-check-in path. Retries are new intended calls after a
confirmed no-answer; they are not retries of an ambiguous submission.

All other live results stop for human review. Generated `safe`, assistance, duress,
stand-down and handoff fields cannot close monitoring, contact another person,
resume a schedule or transfer coordination. They are not proof of recipient identity
or safety. The full automatic safety cascade is a fictional demo only.

When the CLI stops with `review_required` or `unknown_outcome` (nonzero exit), a
responsible person must check the intended recipient and actual evidence privately
in CALL-E, verify the worker's situation independently and choose the next action.
There is deliberately no automatic resume/approval API. Do not rerun a plan merely
to clear uncertainty: a submitted call may still exist, and restarting is not
reconciliation. The local report records the stop without claiming safety or handoff.

## Cancellation and privacy

`fieldline end` writes a cancellation marker under `FIELDLINE_HOME` (default
`.fieldline`). It is checked during waits and before every possible call, including
retries and each escalation rung. Cancellation cannot recall a call already submitted,
and a blocking provider call may finish before cancellation is observed. It does not
cancel provider-side work. A new run refuses an existing marker: review the prior run,
then remove the local marker yourself only when a fresh run is intended.

Live transcripts, provider summaries, generated fields, evidence and exception text
are neither printed nor copied into local incident briefs. Phone-shaped text is masked
in displayed plan text, timeline entries and briefs as well as destination fields.
Demo reports may contain only the fictional transcript data. Provider retention still
applies to the data sent to CALL-E; local masking is not deletion at the provider.
Keep private YAML plans, `.env`, and `.fieldline` out of source control and restrict
access to them. Incident briefs remain local; FieldLine does not send them to contacts.

## Architecture

- `schemas.py`: plan validation, live date/window gates and phone masking
- `calle_client.py`: scripted demo or authorized, fail-closed live SDK transport
- `engine.py`: scheduling, cancellation, live human-review boundaries and reports
- `protocol.py`: deterministic classification used by the fictional demo and the
  restricted, confirmed-no-answer live path
- `prompts.py`: check-in and escalation call instructions
- `report.py` / `render.py`: local privacy-filtered output
- `tests/`: offline schema, scheduling, transport, human-review and demo regressions

The original demo was built with AI coding assistance during the hackathon. Its
fictional transcripts are hand-written simulation data. No production safety or
live-call reliability claim is made.

## License

MIT — see [LICENSE](LICENSE).
