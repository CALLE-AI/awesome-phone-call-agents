# firstbell-absence-calls

An n8n workflow that calls the families whose absence notification went unanswered, each
in that family's own language, and refuses to report a call as closed when nothing was
actually learned from it.

It is the no-code form of [`apps/python/firstbell`](../../apps/python/firstbell/), which
carries the same rules with a test suite and receipts from real calls.

## What it is for

A child does not arrive. The school sends an SMS or a recorded robocall, which tells a
parent something and brings no answer back, so the office still works a list by hand. The
calls that take longest are the ones where the family does not speak the school's
administrative language.

This recipe places those calls as a wave. Each row carries its own `locale`, so the
language is a property of the family rather than of the deployment.

## Three outcomes, not two

Most of the design is one decision: a call has three endings and only one of them closes a
record.

| Outcome | What happened | Who owns it next |
| --- | --- | --- |
| `resolved` | A result came back and at least one required field says something | Nobody. The record is closed |
| `undetermined` | A conversation happened and produced nothing usable | A person |
| `failed` | Nobody was reached on any number | A person |

The middle row is the one that is easy to get wrong, and there are two ways to land in it.
The obvious one is `structured_result: null` on a call whose status is `completed`. The
second is subtler and was found by placing a real call rather than by reading the API: the
person said they could not talk, and CALL-E returned a schema-valid result with every
required field set to `"unknown"`, alongside its own note saying no reason and no return
date were collected. A well-designed enum offers `"unknown"` instead of forcing a guess, so
that response is correct. It is also worth nothing.

A pipeline with two buckets has to file both of those somewhere, and filing them with the
successes is how a dashboard reports full coverage for a child nobody heard about.

`Wave Summary` prints the queue of cases needing a person after the counts rather than
folding them into a rate, so the output cannot be read as though those cases were closed.

## Dry run first

`dryRun` is `true` on import. The first end-to-end run places no calls, needs no API key,
and returns shaped responses that include both of the awkward outcomes above, so the
routing can be seen working before anything rings.

```
node --test examples/classify.test.mjs     # 14 passing
node examples/build-workflow.mjs           # regenerate the workflow
```

The workflow JSON is generated rather than hand-edited. `examples/classify.mjs` holds the
classifier so it can be run by `node --test` with no n8n installed, and
`build-workflow.mjs` inlines it into the `Classify Outcome` node. One of the tests fails if
the shipped workflow and the tested module ever drift apart, because otherwise they are two
things that merely started out the same.

## Install

1. Import `examples/absence-wave.workflow.json`. It arrives inactive.
2. Run it from the **Manual Trigger**. Nothing is dialled while `dryRun` is `true`.
3. Set `CALL_E_API_KEY` in your n8n deployment's environment or secret store. It is read
   at execution time and never written into workflow data, so it does not travel in an
   export.
4. Replace the placeholder numbers in **Absence Config**. They use the `+91 555` range,
   which cannot be assigned to a subscriber, and **Validate Config** refuses to dial them
   once `dryRun` is off.
5. Set `dryRun` to `false`.

Call only numbers you own or are explicitly authorised to call.

## Scheduling it

Enable the **Every School Morning** node and activate the workflow. It ships disabled, and
it exists so that recurrence is a thing the host does rather than a sentence in a README.
Set the hour to whenever your register closes.

## Cancellation, rollback and disabling

Read this before the first live run, because the honest answer is narrower than the word
cancel suggests.

- **To stop new calls:** deactivate the workflow, or disable the **Every School Morning**
  node. No further calls will be placed.
- **What cannot be undone:** the CALL-E API has no cancel endpoint. A call already accepted
  by the API will run to completion even after you deactivate the workflow. Cancellation
  can only mean stop dispatching, never stop the calls.
- **Which is why concurrency is capped at three.** With no cancel endpoint, the concurrency
  cap is the only thing that limits how many calls are in flight at the moment you stop.
  Raising it raises the number of calls you cannot recall.
- **Rollback:** there is no state to roll back. The workflow writes nothing to a system of
  record; it returns a summary and a queue. Re-running is safe because the
  `Idempotency-Key` is derived from student and date, so a repeat within the same day
  returns the original call rather than placing a second one.

## What this recipe does not claim

- **It has not been imported into a running n8n instance.** The classifier is tested on
  node. The workflow's importability is not verified, and `manifest.json` says so under
  `verification.not_verified`.
- **The sample rows are fictional.** Six students with unassignable numbers. They mirror
  the example file in the Python app so the two can be compared.
- **It is not a system-of-record integration.** Rows are declared in a Code node. Reading
  them from a real register means replacing one node, and the Python app has a `Protocol`
  for the same job.
