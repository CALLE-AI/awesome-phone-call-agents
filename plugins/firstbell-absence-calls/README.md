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
| `resolved` | A result came back and at least one required field says something | Nobody, unless it is escalated. See below |
| `undetermined` | A conversation happened and produced nothing usable | A person |
| `failed` | Nobody was reached on any number | A person |

The middle row is the one that is easy to get wrong, and there are two ways to land in it.
The obvious one is `result_status: unavailable` on a call whose status is `completed`. The
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
and returns shaped responses covering every ending the classifier has: two records that
close, one that comes back valid and escalates, one call that connects and yields nothing,
one nobody answers, and one skipped for want of consent. Five attempted, two closed, a
resolution rate of 40 percent, and the escalated row at the top of the queue. So the
routing can be watched working before anything rings.

The eighth shape test runs those shapes through the shipped rule and fails if the demo
closes nothing. It exists because it did: the safeguarding rule landed before these
shapes carried `parent_confirmed_aware`, every completed row escalated, and the recipe
printed a resolution rate of zero while all 26 tests passed.

```
node --test examples/classify.test.mjs examples/workflow-shape.test.mjs   # 35 passing
node --test examples/workflow-v2.test.mjs examples/workflow-safety.test.mjs
node examples/build-workflow.mjs                                         # regenerate the workflow
```

Name both files. `node --test examples/` resolves the directory as a module on node 22.23.2
and fails before it reads a test, which looks exactly like a broken suite and is not one.

The workflow JSON is generated rather than hand-edited. `examples/classify.mjs` holds the
classifier so it can be run by `node --test` with no n8n installed, and
`build-workflow.mjs` inlines it into the `Classify Outcome` node. One of the tests fails if
the shipped workflow and the tested module ever drift apart, because otherwise they are two
things that merely started out the same.

## The parent who did not know

A call can come back schema-valid and complete and still not be finished with. If the parent
did not confirm they already knew their child was absent, this recipe marks the record
`safeguarding`, keeps it out of the closed count, and sorts it to the top of the queue with a
30 minute callback window.

It is a second axis, not a fourth outcome. A safeguarding call is still `resolved`, because
the answer did arrive and it was valid. Making it a fourth value of `resolution` would put a
call in two buckets or in none, and the three outcomes exist to be counted.

The rule fails closed. Anything that is not an explicit `yes`, including a missing field, an
`unknown`, or a value nobody anticipated, escalates. The cost of escalating a call that did
not need it is a phone call, and the cost of the other mistake is a child nobody looked for.

On the eleven real calls behind this work the rule changed no filing, because every call it
flagged was already going to a person for a different reason. It fired on five of the eleven.
An alert rate near half is a staffing question, and it is written down here rather than left
for a school to discover in week two.

The flag follows the rule and not the branch, and for a while it did not. A call where every
required field came back unknown carried the flag in the Python app this recipe is a port of
and did not carry it here, so the same call sorted to the top of one queue and into the
middle of the other and was counted in one safeguarding total and not the other. Nobody
confirmed anything on a call that said nothing, which is the case the flag is for. The row
reached a person either way, so nothing was ever dropped; what was lost was its place in the
queue. `tests/test_classifier_parity.py` in the app now runs this module through node over
ten recipients and compares its verdict with the Python one field by field, because the two
suites in this directory check this module against itself and the app's own no-drift check
is about the workflow JSON against this module. Neither of them was holding the two
languages together.

That fix needed a second one beside it. `summariseWave` computed `closed` as resolved minus
escalated, which balanced only because every escalating row happened to be resolved; the
moment an undetermined row could carry the flag, a wave with one escalation and nothing
closed reported a negative closed count and a negative rate. The two are counted separately
now, `escalated` and `escalatedUnresolved`, and only the first is subtracted.

This module also re-validates the result against the same subset of the schema the app
checks: required present and not null, declared type, enum membership. It had no equivalent
before, so a result carrying a value outside the enum was `resolved` here and `undetermined`
there, and the surface with no check behind it was the one closing records. CALL-E's webhooks
are unsigned, which is the reason the app re-checks a payload it already received, and it is
the same reason here.

## What the shape tests do and do not prove

The other eight tests read the generated workflow the way n8n's importer does. They check the
two collections it loads from, the five fields it draws each node with, that no connection
names a node that is not in the file, that something can start the workflow, that no node is
stranded, and that no credential is baked in. A workflow can be well-formed JSON, pass every
classifier test, and still be refused on load because a node was renamed and one reference
was missed.

Those shape checks alone do not prove importability. On 2026-10-25 the generated
workflow was imported into an isolated n8n 2.44.6 instance and executed from the
CLI with no CALL-E key. It completed all six sample rows: five attempted, one
skipped, two closed, one safeguarding record first in the queue, and a 40 percent
resolution rate. The imported workflow remained inactive with its schedule disabled.
The live Code-node path was also checked by replaying a saved, authorized hotline
request with its original key: n8n received the same completed Call ID and
finished the workflow without creating a replacement Call.

## Install

1. Import `examples/absence-wave.workflow.json`. It arrives inactive.
2. Run it from the **Manual Trigger**. Nothing is dialled while `dryRun` is `true`.
3. For live use, set `CALL_E_API_KEY` in a self-hosted n8n deployment and allow Code
   nodes to read `$env` (`N8N_BLOCK_ENV_ACCESS_IN_NODE=false`). The key is read at
   execution time, never placed in workflow data or an export. Dry runs do not
   access `$env` and work with environment access blocked. See the
   [n8n environment-access setting](https://docs.n8n.io/deploy/host-n8n/configure-n8n/basic-configuration/use-environment-variables/security.md).
4. Replace the placeholder numbers in **Absence Config**. They use the `+91 555` range,
   which cannot be assigned to a subscriber, and **Validate Config** refuses to dial them
   once `dryRun` is off.
5. Set `dryRun` to `false`.

Call only numbers you own or are explicitly authorised to call.

## Scheduling it

Enable the **Every School Morning** node and activate the workflow. It ships disabled, and
it exists so that recurrence is a thing the host does rather than a sentence in a README.
Set the hour to whenever your register closes.

## Calls v2 and fallback numbers

Each request sends one `phone` and a closed, flat `result_schema` to `POST /v2/calls`.
The workflow waits for `result_status` to be `available`, `unavailable`, or
`not_applicable`, even after execution is `completed`. Empty or unavailable results
remain open for a person. Only a completed `no_answer` or `busy` call permits the next
consented number. A refusal, technical failure, ambiguous creation or read failure,
or timeout stops fallback and leaves the record for manual reconciliation.

Each number has its own stable key derived from student, absence date, and number
index. Preserve the original row, number order, request and key on recovery; changing
input under the same key is a conflict, not permission to make a new call. The summary
counts submitted Call resources, including idempotent replays, rather than billed
provider attempts. Retain the returned API `callIds` for lookup; telephone `call_id`
is a separate Billing identifier.

Before importing this version into an existing deployment, drain its v1 executions
and keep their original IDs and v1 readers. Do not resume an old execution midway
with v2 nodes. See the [migration guide](https://docs.heycall-e.com/migration).

## Cancellation, rollback and disabling

Read this before the first live run, because the honest answer is narrower than the word
cancel suggests.

- **To stop new calls:** deactivate the workflow, or disable the **Every School Morning**
  node. No further calls will be placed.
- **Accepted calls:** deactivation does not cancel them. Calls v2 permits cancellation
  only before provider submission; this template does not send cancellation requests.
  Keep the accepted API IDs and reconcile their results.
- **Limits:** the wave caps concurrency at three and shares a four-minute wait budget
  across a row's fallback numbers. A timeout routes the row to a person.
- **Rollback:** the workflow writes no system-of-record data. Restore the previous
  inactive workflow for future runs only after draining accepted calls; keep each ID
  with the interface that created it.

## What this recipe does not claim

- **A local import and dry run are verified, not a school deployment.** The tests use
  synthetic rows and the authorized CALL-E test hotline. No production register,
  real family contact, hosted schedule, or online instance has been switched.
- **The sample rows are fictional.** Six students with unassignable numbers. They mirror
  the example file in the Python app so the two can be compared.
- **It is not a system-of-record integration.** Rows are declared in a Code node. Reading
  them from a real register means replacing one node, and the Python app has a `Protocol`
  for the same job.
