# CALL-E feedback from building firstbell

Sixteen findings from building an absence-calling app on CALL-E and placing twelve real
calls with it, to Indian mobile numbers, in English and Tamil, on 4 September 2026. Four
came after that day: one off the billing surface, one from a household with two absent
children, and three from auditing our own retry and error handling against your SDK, which
is where the last three came from and why they are the most specific ones here.

They are collected here because they were scattered. Until now they lived in a code comment,
a `docs/` file and three README bullets, which is a bad place for the one thing in this
contribution that is about your platform rather than about our app.

Most of them can be checked without an account, because they are statements about your
published SDK, your reference and your own schema, and each one names the file and the line.
The ones that rest on our call records say so in the finding, and we will hand those records
over. This paragraph used to put a number on that split and the number was wrong twice, and the
second time it was out by four, so there is no number on it now.

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

Anchor: `README.md:924-936` ("The escape hatch is instructed, not enforced") and
limitation 3 at `README.md:1366-1372` ("Platform-side call termination").

## 2. Webhook deliveries are unsigned, and your SDK is where we found out

**Severity: second only to finding 1, and the only one here that is a security defect
rather than a gap.** `verify` and `unwrap` are both deprecated. `unwrap`'s docstring says
"current CALL-E webhooks are unsigned" and that it "must not be used to parse current
deliveries" (`calle/webhooks.py:23-24`); `verify`'s says CALL-E "no longer sends timestamp or
signature headers" and that the method "remains available for integrations that use their own
compatible signing layer" (`calle/webhooks.py:13-15`). So a receiver has no way to tell a
delivery from your platform apart from one posted by anybody who has learned the URL, and the
one method whose docstring leaves a door open leaves it open onto a signing layer you no
longer take part in.

For this application that is not abstract. A forged `call.completed` carrying a fabricated
`structured_result` closes a record about a child nobody has heard from, and it closes it
with a note saying a parent confirmed they knew. The receiving school sees a resolved case.
Nobody goes looking.

We re-validate every payload against the same subset of the schema we validate a polled
result against, which is why this app does not trust a delivery it already received
(`dispatch/validation.py`). That catches a malformed forgery. It cannot catch a well-formed
one, because the thing missing is authentication and no amount of schema checking is
authentication.

**What we would use:** an HMAC signature header over the raw body with a documented signing
secret, a timestamp in the signed material so a captured delivery cannot be replayed later,
and `verify` undeprecated. Until then, say in the webhooks reference that deliveries are
unsigned, in the reference itself rather than only in a deprecated method's docstring. A
developer who never opens the SDK source will not find it, and the ones building on
webhooks are the ones who need to know.

Anchor: `calle_double/server.py` (the double delivers unsigned on purpose, matching you)
and `dispatch/validation.py` (why a received payload is re-checked).

## 3. `structured_result` is returned in two places, and callers guess wrong

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

## 4. Attempts carry a numeric SIP code, task level carries a symbolic name

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

## 5. One call gave three incompatible accounts of itself

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

## 6. No sandbox, no dry run, no test key

There is no test credential, no dry-run flag and no sandbox host in the OpenAPI spec, either
SDK, the guides, or this integrations repository.

The consequence is visible in your own repository: every runnable app here ships a hand
written fake, each one a separate guess at your behaviour. Ours is `calle_double/`, and
finding 4 above is what a wrong guess costs. We wrote a conformance harness to compare the
double against recorded real responses, and it found twenty-six checks that agreed with each
other and with the same wrong model.

**What we would use:** a test key that returns recorded responses, or a published set of
response fixtures. Fixtures alone would do. The expensive part is not the network, it is not
knowing what the shapes are.

## 7. `canceled` is a status with no way to reach it

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

## 8. `locale` is undersold in your own schema

Your schema calls `locale` a "BCP 47 locale hint for the conversation", on the `locale`
attribute of `CallTaskRecipientRequest` in `calle/generated/models/`. The word hint sets a
low expectation. We ran eight matched-pair live calls, the same four
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

## 9. India is an international line, and the caller ID says Oakland

Calls to Indian mobiles arrived showing a `+1` caller ID attributed to Oakland, California.

Your README describes International numbers as "primarily intended for testing", so this is
documented and we are not claiming to have been misled. We are naming the consequence. A
parent who is not expecting a call has no reason to answer an unknown American number about
their child, and a school has every reason not to send one. For us this is a procurement
blocker sitting in front of the code, and it is the first thing we would tell anyone piloting
this in India.

**What we would use:** local presence numbers for IN, or a clear statement of which regions can
carry a recognisable caller ID today, so integrators cost the problem before they build.

## 10. A Goal fixes the callee's language, so a multilingual caller cannot use Goals

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

## 11. A structured result has one subject, so one answer cannot close two records

Two absent children in one household share a telephone. This is common enough that a
district's export shows it on any given morning, and it is the first thing an attendance
officer asks about a batch caller: does it ring me twice.

One call reaches the guardian, one extraction comes back, and the result shape has a single
subject. One `reason_category`, one `expected_return`, one `parent_confirmed_aware`. There
is no honest way to close the second child's record on that result, because the call was
not asked about the second child, and an extraction cannot produce an answer nobody gave.
Reading the one answer across both records writes a sentence into a safeguarding file that
no parent said.

So this app groups by telephone number, dials once, and holds the sibling with a reason
that names the row being called (`dispatch/households.py`). That is correct and it is also
a person's morning: somebody has to open the held row and ring back about the other child,
having already spoken to that family today.

**What we would use:** either a task that carries several subjects and returns a result per
subject, so one conversation can close two records the agent actually asked about, or one
sentence in the reference saying a call has one subject. The sentence costs you nothing and
would have saved us an afternoon of trying to work out whether we were missing an API. The
capability is the better answer for schools, clinics and anywhere a household is the unit
rather than the person, and it is a bigger change than we would ask for casually.

This is a design consequence rather than a bug, and it is here because it is the single
platform-shaped constraint that changed what our product does.

## 12. Granted credits did not reach the balance, and the dashboard kept warning about it

The hackathon credit email arrived at 11:47 on 7 September 2026. At 18:40 the same day the
dashboard read Available Credits $0.35 with a Low Balance warning, and the usage page showed
the $1.00 top-up of 3 September as the only credit transaction. Nothing distinguished
"granted and not yet applied" from "not granted" from "applied somewhere this page does not
read".

The consequence is a decision, not an inconvenience. Testing a wave of calls against a
balance that may or may not exist means either spending to find out, or not testing. We did
not test the wave.

**What we would use:** the grant as a transaction row the moment it is applied, even if
that is later than the email, and a balance that distinguishes granted credit from
purchased. A pending row saying "credit applied, awaiting settlement" would have answered
it completely.

While we are on that surface: there is no published price per call anywhere in the
documentation, so we priced our own account instead. Thirteen billed events at $0.05 each,
$0.65 over the month to 7 September across thirteen billed events. The panel showed us ten
call rows and every duration on them fell between 35 seconds and 1 minute 50, all under two
minutes, which means we cannot tell a flat price per call from a per-minute price rounded up
to a two-minute minimum, and that distinction decides whether a district
can afford a wave of long calls. `evidence/observed-price.json` records what we saw and the
three things it cannot settle. Publishing the rate and the rounding rule would let anybody
building on you write a number down instead of a range.

## 13. A rate limit cannot say when to come back, because the SDK drops the header

**Severity: small, cheap to fix, and it costs you load.** `calle/errors.py` has a dedicated
`CalleRateLimitError`, raised for 429 and nothing else, so somebody meant a rate limit to be
handled differently from other errors. Then:

```python
# calle/errors.py
def api_error_from_response(status_code: int, payload: object) -> CalleAPIError:
    ...
    if status_code == 429:
        return CalleRateLimitError(code=code, message=message,
                                   status_code=status_code, details=details)
```

The function is handed a status code and a decoded body. The response headers are not a
parameter, so nothing in that function can see a `Retry-After` even if you send one, and
`CalleAPIError.__init__` has no field to hold it. Reproducing this needs no account and no
key: it is the constructor signature in the installed package, and
`generated/api/calls/create_call.py:87` shows the headers are on the response object one
layer up and are dropped on the way here.

So an integrator hitting a 429 has to invent a backoff. Ours doubles from one second and
caps at thirty (`dispatch/scheduler.py`, `RetryPolicy.delay_for`), chosen with no
information, which means on a real rate limit we either come back too early and take
another 429 off you or wait longer than you needed us to. Both are your capacity.

**What we would use:** `retry_after_seconds` on `CalleRateLimitError`, read from the header
on the response you already have in hand, and `headers` passed into
`api_error_from_response`. Two parameters. If the platform does not currently send
`Retry-After` on a 429, the useful half of this is sending it; the SDK change is what makes
it reachable.

Anchor: `dispatch/scheduler.py` (`RetryPolicy` and the `RETRYABLE_ERRORS` branch, which
treats `rate_limit_exceeded` with the same blind backoff as everything else because there is
nothing better to use).

## 14. `_request` decodes JSON before it knows there is any, so a proxy page raises the wrong error

**Severity: small, two lines, and it turns your outage into our crash.** In both
`calle/calls.py` and `calle/goals.py:133-134`, which are the same two lines twice:

```python
if response.status_code >= 400:
    raise api_error_from_response(response.status_code, response.json())
```

`response.json()` runs on any status at or above 400, before anything has checked that the
body is JSON. A 502 from a proxy in front of your API is an HTML page, and `.json()` on it
raises `json.JSONDecodeError` out of the SDK: not `CalleAPIError`, not
`CalleConnectionError`, not any class in `calle.errors`. An integrator catching your
exception hierarchy does not catch it, and a 502 is the one class of failure a retry exists
to absorb.

We catch it at `dispatch/scheduler.py` in the same `except` as `CalleTimeoutError` and
`CalleConnectionError`, with a comment explaining why a JSON decode error is in there, and
it took a real bad-gateway response to find. Checkable with no account: point a client at
any host that returns an HTML error page.

**What we would use:** decode inside a `try`, and on failure raise `CalleConnectionError`
with the status code and the first part of the body. The status code is the useful half and
it is already in hand. Fix both copies: a maintainer who patches the file we cite and ships
is still shipping this on every goal run, which is why we say where the second one is.

## 15. A timeout waiting for a call and a timeout on the socket are the same exception class

**Severity: small, and it decides whether an integrator dares retry.** Both of these are in
`calle/calls.py`:

```python
except httpx.TimeoutException as exc:
    raise CalleTimeoutError("CALL-E API request timed out.") from exc
```

```python
raise CalleTimeoutError(f"Timed out waiting for CALL-E call {call_id}.")
```

The first means the request never got an answer, so nobody knows whether a call was placed.
The second means the call is running and has not finished inside `timeout_seconds`, which is
not an error about the request at all. They are the same class, so the only way to tell them
apart is to match on the message text.

The difference is the whole decision. On the first, retrying without an idempotency key can
place a second telephone call to a family. On the second, retrying is wrong in a different
way: the call is alive and the right move is to keep polling. We stopped using
`wait_for_result` and wrote our own poll over `calls.get` (`dispatch/scheduler.py`,
`_await_terminal`) partly for this.

**What we would use:** a distinct class for the wait, `CalleResultTimeout` or similar,
subclassing `CalleTimeoutError` so nobody's existing `except` breaks. One class, no
signature change.

## 16. `create_and_wait` raises `KeyError` on a response body without an id

**Severity: smallest of these, and it is the one that loses a placed call.** In
`calle/calls.py`, and again at `calle/goals.py:120` as `str(run["id"])`:

```python
call = self.create(**kwargs)
return self.wait_for_result(
    str(call["id"]),
    ...
```

`call["id"]` on a 200 whose body carries no `id`. The subscript raises `KeyError`, which is
not in `calle.errors` either, and by then the call may already be placed and billed: the
create returned 200. The caller gets a `KeyError` and no identifier, so there is nothing to
poll, nothing to reconcile against billing, and nothing to tell an office about a telephone
that may be ringing.

We hit the same shape on our own create path and defend against it at
`dispatch/scheduler.py` with a comment that reads "This used to be `call["id"]`": a missing
id gives the third resolution, undetermined, with a reason saying the call was created and
its outcome could not be read back, rather than failed. It cannot enter the run's
not-recallable list, because that list is keyed on call ids and this response carried none,
which is its own argument for returning one.

**What we would use:** raise `CalleConnectionError` naming the missing field, so the
exception says the response was unusable rather than dying on a dictionary lookup. Or
better, return the body and let the caller decide, since it is the caller who knows whether
a possibly-placed call is a problem.

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
  finding 8 and the reason this app is worth building at all.

## How to reproduce

Most need no account and no key:

```bash
cd apps/python/firstbell
python -m pytest tests/ -q
python -m firstbell --work-file examples/absences.csv
```

Findings 5 and 9 are observations from live calls and cannot be reproduced from this
repository. The call identifiers behind them travel with the submission.
