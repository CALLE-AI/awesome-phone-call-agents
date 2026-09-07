# CALL-E feedback from building firstbell

Eight findings from building an absence-calling app on CALL-E and placing twelve real calls
with it, to Indian mobile numbers, in English and Tamil, on 4 September 2026.

They are collected here because they were scattered. Until now they lived in a code comment,
a `docs/` file and three README bullets, which is a bad place for the one thing in this
contribution that is about your platform rather than about our app. Six are reproducible from
this repository with no account. Two need our call records, and we will hand those over.

Ordered by what we think they cost you, not by when we found them.

## 1. No way to end a call, and no upper bound on one

**Severity: this is the one to fix.** There is no `end_call` tool, no `max_turns`, and no
maximum duration anywhere in the API.

On a live call about a child who might be missing, the agent correctly said a member of staff
would call back within thirty minutes. Then it paused and started its opening disclosure
again, from the top, to a parent who had already answered everything. The parent had to hang
up on it. Nothing on our side could stop that, because the instruction to end the call is a
sentence in a prompt and a prompt is not a lever.

We treat this as the blocker on the whole category. An absence call is a safeguarding call,
and a safeguarding call that will not end is worse than one that never happened.

We are not the only ones who needed this. `consent-gate` extracts an `end_call_requested`
field from the finished call and branches on it
(`apps/python/consent-gate/consent_gate/__main__.py:124-145`, "end_call_requested"). That is a record of someone
having asked the call to stop, read after it stopped. It is the closest thing to a
termination control available, and it arrives too late by construction.

**What we would use:** an `end_call` tool the agent can invoke, plus a `max_duration_seconds`
and `max_turns` on the task as a backstop the agent cannot talk its way past. The backstop
matters more than the tool. A tool the agent forgets to call has the same failure mode we hit.

Anchor: `README.md:442-450` ("The escape hatch is instructed, not enforced") and
limitation 3 at `README.md:750-754` ("Platform-side call termination").

## 2. `structured_result` is returned in two places, and callers guess wrong

A single-recipient call came back with the per-recipient `structured_result` null and the
task-level one fully populated. Read the per-recipient field alone and a completed call looks
like it learned nothing.

The obvious fix is to fall back to the task-level field, and that is the trap. On a fan-out to
several recipients the task-level result belongs to no one recipient, so a caller that falls
back without checking how many recipients there were can attribute one family's answer to
another family.

The clearest evidence that this is under-specified is that three apps in this repository read
the same two fields three different ways. `appointment-confirm` refuses the fallback unless
there is exactly one recipient
(`apps/python/appointment-confirm/appointment_confirm/dispositions.py:54-61`,
"Expected exactly one recipient result"). `accessline`
takes `recipients[0]` and falls back with no recipient-count check
(`apps/python/accessline/accessline/calle_rest.py:366-371`,
"structured = call_task.get"), which is safe for a
single-recipient caller and would need a guard if it ever fanned out. We allow it only for a
single recipient. None of us is being careless. We each read the same reference and reached a
different conclusion about which field is authoritative.

**What we would use:** say in the reference which field is authoritative for one recipient and
which for many, and whether the per-recipient field being null on a completed single-recipient
call is expected or a defect. If it is expected, one sentence prevents this. If it is not,
three apps here are working around it.

Anchor: `dispatch/scheduler.py`, the single-recipient condition on the fallback.

## 3. Attempts carry a numeric SIP code, task level carries a symbolic name

We built our test double to emit symbolic failure names at attempt level, because that is what
the task-level vocabulary uses and nothing said otherwise. A real call contradicted it: the
attempt carried `603`, not a name. Our double had been confidently wrong for a fortnight and
twenty-six of our own tests agreed with it.

That is a documentation defect rather than an API one. A careful reader built the wrong model
from what you published, and only a live call corrected it.

**What we would use:** the attempt schema stating the code is numeric SIP, with the symbolic
vocabulary marked as task level only, and a short table mapping the codes you actually emit.
We wrote that table ourselves because a queue row reading "the call failed with 603" is not
something a school secretary can act on.

## 4. One call gave three incompatible accounts of itself

The platform returned SIP `603 Decline`, a `failure_message` naming the user as having hung
up, and an attempt whose `started_at` and `completed_at` were the same second, which says the
call never connected at all. The operator was holding the handset, watched it ring out in
full, and touched nothing.

We report this as a shape, not a diagnosis. It is one call with one human observer, and we are
not claiming to know which of the three fields is the wrong one. What we can say is that three
fields on one call cannot all be true, and that our dispatcher now refuses to report anything
beyond what all three agree on, which is that nobody answered.

**What we would use:** resolve it against your own billing record. We hold the identifier and
will send it with the submission rather than publish it here. It is a real call to a real
number, and this repository asks contributors to keep those out of what they commit.

## 5. No sandbox, no dry run, no test key

There is no test credential, no dry-run flag and no sandbox host in the OpenAPI spec, either
SDK, the guides, or this integrations repository.

The consequence is visible in your own repository: every runnable app here ships a hand
written fake, each one a separate guess at your behaviour. Ours is `calle_double/`, and
finding 3 above is what a wrong guess costs. We wrote a conformance harness to compare the
double against recorded real responses, and it found twenty-six checks that agreed with each
other and with the same wrong model.

**What we would use:** a test key that returns recorded responses, or a published set of
response fixtures. Fixtures alone would do. The expensive part is not the network, it is not
knowing what the shapes are.

## 6. `canceled` is a status with no way to reach it

The call status enum includes `canceled`. There is no cancel endpoint. Nothing in the 76 apps
in this repository calls one, because there is nothing to call: every hit on `cancel` across
`apps/` is a reference to the status value.

For us this is not cosmetic. Our only brake on a run that is going wrong is the concurrency
cap, because once a call is placed we cannot recall it. That makes a wave of calls to families
an operation with no stop button, which is a hard thing to hand to a school office.

We looked hard enough to write a test about it. `tests/test_double_guards.py:211-218` ("v1/calls/x/cancel") posts to
`/v1/calls/x/cancel` and asserts a 404, because our double must not invent a route the real
API does not serve.

**What we would use:** `POST /v1/calls/{id}/cancel`, or a note in the reference saying the
state is reachable only by your side, so integrators stop looking for the endpoint.

## 7. `locale` is undersold in your own schema

Your schema calls `locale` a "BCP 47 hint". We ran eight matched-pair live calls, the same four
scenarios in en-IN and ta-IN, and extraction was faithful to the transcript twelve times out of
twelve in both languages.

The two errors we did see were both speech recognition, not extraction: "high fever" came back
as "5 fevers" and "family emergency" as "family annual". Neither corrupted the structured
result. That is the useful part, and it gave us an operating rule: treat `transcript_turns[]`
as a display artefact and the structured result as the data. They fail independently.

**What we would use:** that paragraph, in your docs. "Hint" reads like best effort, and what we
measured was better than best effort. We are reporting a feature you are underselling.

The measurement and its three comparisons that did not match are in
`docs/locale-is-not-only-a-hint.md`.

## 8. India is an international line, and the caller ID says Oakland

Calls to Indian mobiles arrived showing a `+1` caller ID attributed to Oakland, California.

Your README describes International numbers as "primarily intended for testing", so this is
documented and we are not claiming to have been misled. We are naming the consequence. A
parent who is not expecting a call has no reason to answer an unknown American number about
their child, and a school has every reason not to send one. For us this is a procurement
blocker sitting in front of the code, and it is the first thing we would tell anyone piloting
this in India.

**What we would use:** local presence numbers for IN, or a clear statement of which regions can
carry a recognisable caller ID today, so integrators cost the problem before they build.

## 9. A Goal fixes the callee's language, so a multilingual caller cannot use Goals

We did not use the Goals resource. This is why, and it is a design consequence rather than an
omission.

`CreateGoalRunRequest` in `calle-ai==0.7.0` documents itself as closed: "target wrappers,
per-Run region/locale/display-name hints, task text, schemas, RunSpec selectors, provider
settings, and unknown fields are not accepted. Region, callee locale, and runtime profile come
from the published Goal." A run therefore carries a phone number and a variable map, and
nothing else.

Our whole design is that the language is a property of the family and not of the deployment.
It is one column in the work file a school already exports, and a district calling in English,
Tamil and Spanish runs one command. Against Goals that becomes one authored Goal per language,
and the SDK has no `create_goal`: `generated/api/goals/` holds `get_goal` and `list_goals`
only, so a district cannot provision them from the integration that needs them.

Then the part that stops it being a workaround. `Goal` exposes `object`, `id`, `title`,
`description`, `status` and `published_run_spec`, and `GoalPublishedRunSpec` exposes `id`,
`version`, `input_schema` and `result_schema`. The locale that governs the call appears in
none of them. A client holding three Goals cannot ask which one speaks Tamil. It has to infer
it from the human-readable `title` or `description`, which means a naming convention nobody
can validate, in the one field a dashboard user is free to rewrite. For a call about a child
that is not a risk we would take.

**What we would use:** `locale` and `region` as read-only fields on `GoalPublishedRunSpec`,
beside the two schemas that are already there. That is a documentation-and-serialisation
change rather than a new capability, and it is the difference between choosing a Goal and
guessing one. A `create_goal` on the API would matter separately, for provisioning.

We are not asking for per-run locale back. Pinning it to the published contract is a
defensible choice and probably the right one: it is what makes a Goal an interface. The gap is
that the pinned value is not readable.

`calle_double` answers `GET /v1/goals` with an empty list so that a client which enumerates
Goals does not crash, and deliberately goes no further. There is no recorded production
response for the resource in this repository, so anything richer would be a guess presented
as a conformance record. `evidence/api-shape.json` covers the call surface only, and says so.

## What worked

Not everything here is a complaint, and three of these decisions saved us real time.

- **Idempotency keys are honoured properly.** We key on `attendance:{student}:{date}`, replayed
  a whole wave, and no call was placed twice. Nothing collapsed into a single call either,
  which is the failure we were watching for.
- **The webhook taxonomy already draws the distinction our whole app is built on.**
  `call.result_validation_failed` separates "the call completed" from "the call produced a
  usable answer", which is exactly the middle outcome we needed and did not expect to find
  named. Our code still polls, so we are getting the benefit of your taxonomy without using
  the mechanism, and closing that is our next change rather than a request.
- **Structured extraction held up in a second language on a real telephone line**, which is
  finding 7 and the reason this app is worth building at all.

## How to reproduce

Six of the eight need no account and no key:

```bash
cd apps/python/firstbell
python -m pytest tests/ -q
python -m firstbell --work-file examples/absences.csv
```

Findings 4 and 8 are observations from live calls and cannot be reproduced from this
repository. The call identifiers behind them travel with the submission.
