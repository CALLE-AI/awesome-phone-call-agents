"""Rules that had stopped being rules, found by deleting every guard and seeing who cared.

`FundingRate.__post_init__` required a `source` and no test failed when the requirement was
removed. The requirement was still in the code and still in the documentation, and it had
quietly become a sentence. Nothing distinguishes that from a rule anybody relies on until
somebody tries deleting it.

So it was done mechanically for all of them. Every `if` in `firstbell/`, `dispatch/` and
`calle_double/` whose body only raises or short-circuits, and every `assert`, was
neutralised one at a time and the whole suite run against the result. A guard whose removal
costs nothing is not protecting anything.

Each test below names the guard it exists for, by file and line as the file stood when this
was written, and the failure that guard is the only thing preventing. Each was then checked
the same way it was found: the guard was deleted again, and the named test had to fail.

Four of the sweep's findings are deliberately not tested, because no input can tell them
from the code around them, and a test written for one of those would be a test that passes
whatever the code does:

  * the two `assert` statements in `ImpactSummary.lines` narrow a type inside a branch
    that has already established the value is not None;
  * `run`'s `if not callable_items: return report` short-circuits to the same report the
    loop below it would produce for an empty list;
  * `_handle`'s cancel check reads the same expression `_create_with_retries` reads a
    moment later, so deleting either alone changes nothing;
  * `_create_with_retries`'s `if err.code in PERMANENT_ERRORS` returns the same result the
    line below it returns, because `PERMANENT_ERRORS` and `RETRYABLE_ERRORS` are disjoint.
    That one was not assumed: it was deleted, and `test_an_error_that_retrying_cannot_fix_
    does_not_redial` still passed, which is what redundant means here.

They are recorded rather than dropped, because "nothing noticed" and "nothing could" are
different answers and only one of them is a defect.
"""
from __future__ import annotations

import pytest

from calle_double import CalleDouble, build_client
from dispatch import (
    Cancelled,
    CsvSource,
    ItemResult,
    Resolution,
    RetryPolicy,
    SourceError,
    UnsupportedSchema,
    WaveDispatcher,
    WorkItem,
    problems,
)
from firstbell.domain import FundingRate
from tests.fixtures import IN_A

WORK = "examples/absences.csv"

SCHEMA = {
    "type": "object",
    "required": ["reason"],
    "properties": {"reason": {"type": "string"}},
}


def dispatcher(client=None, **kwargs) -> WaveDispatcher:
    kwargs.setdefault("task_builder", lambda i: f"Ask about {i.id}.")
    kwargs.setdefault("result_schema", SCHEMA)
    kwargs.setdefault("poll_interval_seconds", 0)
    kwargs.setdefault("sleep", lambda _s: None)
    if client is None:
        client = build_client(CalleDouble(latency_seconds=0.0))
    return WaveDispatcher(client, **kwargs)


# ---------------------------------------------------------------------------
# firstbell/cli.py:62 -- RunMode.reached_production
# ---------------------------------------------------------------------------

def test_an_offline_run_pointed_at_production_has_still_reached_nothing():
    """`if not self.live or not self.base_url` had no test that needed the first half.

    `CALLE_BASE_URL` is read from the environment whether or not `--live` was passed, so a
    machine configured for a live run that then runs the default offline command holds
    exactly this combination: production in the URL, nothing dialled. Deleting the `live`
    half of the guard makes that run write `reached_production_api: true` into a receipt,
    which is a claim that a phone rang. The suite did not notice, because every case it
    covered was either offline with no URL or live with one.

    `urlparse(None)` is why: it returns an empty hostname rather than raising, so the
    offline-with-no-URL case answers False through the fallthrough as well and the guard
    looks redundant from inside the tests that existed.
    """
    from firstbell.cli import PRODUCTION_HOST, RunMode

    configured_but_offline = RunMode(live=False, base_url=f"https://{PRODUCTION_HOST}")
    assert configured_but_offline.reached_production is False
    assert configured_but_offline.label == "offline"
    assert "No phone will ring" not in configured_but_offline.banner()

    # The other half, kept beside it so the pair is legible.
    assert RunMode(live=True, base_url=f"https://{PRODUCTION_HOST}").reached_production


# ---------------------------------------------------------------------------
# firstbell/domain.py:85 -- FundingRate.__post_init__
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("amount", [0.0, -1.0, -0.01])
def test_a_funding_rate_that_is_not_positive_is_refused(amount):
    """The sibling of the `source` requirement, and it had gone the same way.

    Every test that built a `FundingRate` built a valid one. A rate of zero would print
    `$0.00 recovered` beside a real citation, and a negative one would print a recovery
    that runs backwards, both under a heading a judge reads as measured.
    """
    with pytest.raises(ValueError, match="positive"):
        FundingRate(amount=amount, currency="$", jurisdiction="Example",
                    source="Example Dept", source_url="https://example.org/x", year=2026)


# ---------------------------------------------------------------------------
# firstbell/cli.py:157 -- _staff_from
# ---------------------------------------------------------------------------

def test_no_staff_cost_removes_the_wage_and_everything_derived_from_it(capsys):
    """`--no-staff-cost` was a flag no test ever passed.

    The flag exists so that a reader who does not accept the national wage figure can see
    the run without it. With the guard removed the flag is accepted and silently ignored,
    so the output still carries a break-even derived from a wage the reader just declined,
    still cites the Bureau of Labor Statistics for it, and still exits zero. A flag that
    reports success and does nothing is worse than one that errors.
    """
    from firstbell.cli import main

    assert main(["--work-file", WORK, "--no-staff-cost"]) == 0
    out = capsys.readouterr().out
    assert "staff time avoided   not computed" in out
    assert "break-even" not in out, "a wage was still used after it was declined"
    assert "Bureau of Labor Statistics" not in out, "the declined source was still cited"


# ---------------------------------------------------------------------------
# dispatch/scheduler.py:423 -- WaveDispatcher._classify
# ---------------------------------------------------------------------------

def test_a_call_that_never_reached_a_terminal_status_is_not_reported_as_answered():
    """The timeout branch was the first thing `_classify` does and nothing exercised it.

    The dangerous shape is not a timeout with nothing in it. It is a timeout carrying a
    schema-valid result: the poll gave up while the call was still running, and a partial
    result was already attached. Without the guard that row is classified `resolved` with
    the reason "schema-valid answer received", so a record about a child is closed on a
    call that never finished. The suite had no case where `_timed_out` was set at all, so
    removing the branch failed nothing.
    """
    item = WorkItem(id="S-90", phones=(IN_A,), consented=True)
    timed_out = {
        "id": "call_x",
        "status": "in_progress",
        "_timed_out": True,
        "recipients": [{"structured_result": {"reason": "illness"},
                        "attempts": [{"phone": IN_A}]}],
    }
    result = dispatcher()._classify(item, timed_out)
    assert result.resolution is Resolution.UNDETERMINED
    assert "terminal status" in result.reason

    # Without the timeout flag the very same response is an answer, which is what makes
    # the assertion above about the flag rather than about the shape of the payload.
    answered = {k: v for k, v in timed_out.items() if k != "_timed_out"}
    answered["status"] = "completed"
    assert dispatcher()._classify(item, answered).resolution is Resolution.RESOLVED


# ---------------------------------------------------------------------------
# dispatch/scheduler.py:578, 584, 586 -- WaveDispatcher._describe_failure
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("code, detail, expected", [
    # The attempt-level SIP code, preferred when it is one this app has words for.
    (None, "486", "the line was busy"),
    ("call_failed", "603", "nobody answered"),
    # The task-level code looked up in the same table. Untested until now: every case the
    # suite had put the SIP code in `detail`, so this branch was never the one that ran.
    ("486", None, "the line was busy"),
    ("480", None, "the phone was switched off or out of coverage"),
    # The symbolic task-level codes.
    ("call_failed", None, "the call did not connect"),
    ("no_answer", None, "nobody answered"),
    ("declined", None, "the call was declined"),
    # A code this app has never seen. It must be quoted rather than swallowed, because a
    # new vendor code silently reported as "the call failed" is a change nobody can see.
    ("quota_exceeded", None, "the call failed with quota_exceeded"),
    # No code at all.
    (None, None, "the call failed"),
])
def test_every_sentence_an_administrator_can_be_shown_is_reachable(code, detail, expected):
    """Six of the nine branches were dead as far as the suite was concerned.

    This is the text an office administrator reads next to a child's name in a queue of
    unresolved absences, so a wrong branch here is not a cosmetic defect. Removing the
    `declined` branch, the unknown-code branch or the task-level table lookup failed
    nothing at all, which means the strings were never checked against the codes.
    """
    sentence = WaveDispatcher._describe_failure(code, (), detail)
    assert sentence == expected

    # The suffix is part of the sentence and belongs to the same branch.
    with_numbers = WaveDispatcher._describe_failure(code, (IN_A, IN_A), detail)
    assert with_numbers == f"{expected} after trying 2 number(s)"


def test_a_raw_sip_code_never_reaches_an_administrator_untranslated():
    """The rule the table exists for, stated once rather than per code."""
    for sip in WaveDispatcher.SIP_REASONS:
        assert sip not in WaveDispatcher._describe_failure(sip, ())
        assert sip not in WaveDispatcher._describe_failure(None, (), sip)


# ---------------------------------------------------------------------------
# dispatch/scheduler.py:317 -- WaveDispatcher._create_with_retries
# ---------------------------------------------------------------------------

class RefusesToBeCalled:
    """A client that fails the test rather than the call if anything reaches it."""

    class calls:
        @staticmethod
        def create(**_kwargs):
            raise AssertionError("a cancelled run must not create a call")

        @staticmethod
        def retrieve(**_kwargs):
            raise AssertionError("a cancelled run must not poll for a call")


def test_a_cancelled_run_places_no_further_call():
    """Cancel is the stop button, and nothing checked that it stops anything.

    A run is cancelled because somebody wants the phones to stop ringing. The guard is
    read inside the retry loop, so it is also what stops a retry re-dialling a number
    after the cancel arrived. With it removed, a cancelled run creates the call and only
    discovers the cancellation afterwards, by which time the phone has rung.

    The client here raises rather than records, so the assertion is that the create was
    never reached and not merely that the count came out right.
    """
    run = dispatcher(client=RefusesToBeCalled())
    run.cancel()
    assert run.cancelled

    item = WorkItem(id="S-91", phones=(IN_A,), consented=True)
    with pytest.raises(Cancelled):
        run._create_with_retries(item)
    with pytest.raises(Cancelled):
        run._handle(item)


# ---------------------------------------------------------------------------
# dispatch/scheduler.py:480 -- WaveDispatcher._learned_nothing
# ---------------------------------------------------------------------------

def test_a_schema_with_no_required_fields_does_not_make_every_answer_worthless():
    """`if not required or not self._uninformative: return False` had no test.

    `all([])` is True, so with the guard removed a schema that declares no required fields
    makes every result "every required field came back unknown", and a run where every
    call was answered reports every one of them as undetermined. Nothing in the suite used
    a schema without `required`, and `dispatch/validation.py` allows one.
    """
    open_schema = {"type": "object", "properties": {"reason": {"type": "string"}}}
    run = dispatcher(result_schema=open_schema)
    assert run._learned_nothing({"reason": "unknown"}) is False
    assert run._learned_nothing({}) is False

    # The rule itself still holds where a schema does say what it requires.
    assert dispatcher()._learned_nothing({"reason": "unknown"}) is True
    assert dispatcher()._learned_nothing({"reason": "illness"}) is False


# ---------------------------------------------------------------------------
# dispatch/scheduler.py:401 -- WaveDispatcher._await_terminal
# ---------------------------------------------------------------------------

class NeverFinishes:
    """A call that is always still running. What the deadline exists for.

    The read cap is not decoration. Delete the deadline and this loop has no other way
    out, so the test would hang rather than fail, and a hanging test in a suite is the
    exact failure that cost this project two hours. The cap turns that into a fast, named
    failure while leaving the pass path untouched: with the deadline in place the poll
    gives up after one read and never comes near it.
    """

    LIMIT = 200

    def __init__(self):
        self.reads = 0

    @property
    def calls(self):
        return self

    def get(self, _call_id):
        self.reads += 1
        if self.reads > self.LIMIT:
            raise RuntimeError("the poll never gave up on a call that never finished")
        return {"id": "call_slow", "status": "in_progress", "recipients": []}


def test_a_call_that_never_finishes_stops_being_polled():
    """The poll's deadline, which nothing in the suite had ever reached.

    Every offline test finishes, so the loop always left through the terminal-status
    branch and the deadline below it was never the way out. Delete it and the poll runs
    forever against a call that never terminates, which is a hung run rather than a failed
    test: the same shape that made this suite spin past two minutes when a crashed harness
    left the terminal check disabled.

    The timeout is zero, so this asserts the deadline is honoured without waiting for one.
    """
    slow = NeverFinishes()
    run = dispatcher(client=slow, call_timeout_seconds=0.0)
    final = run._await_terminal("call_slow")
    assert final["_timed_out"] is True
    assert final["status"] == "failed", "a call that never finished is not a completed one"
    assert 1 <= slow.reads < NeverFinishes.LIMIT, (
        f"the poll read the call {slow.reads} times before giving up")


# ---------------------------------------------------------------------------
# dispatch/scheduler.py:345 -- WaveDispatcher._create_with_retries
# ---------------------------------------------------------------------------

class FailsWith:
    """A client that raises a chosen API error and counts how often it was asked."""

    def __init__(self, code: str):
        self.code = code
        self.attempts = 0

    @property
    def calls(self):
        return self

    def create(self, **_kwargs):
        from calle import CalleAPIError

        self.attempts += 1
        raise CalleAPIError(code=self.code, message="refused", status_code=400)


@pytest.mark.parametrize("code", ["invalid_phone", "quota_exceeded"])
def test_an_error_that_retrying_cannot_fix_does_not_redial(code):
    """A number is dialled again only when trying again could plausibly work.

    `invalid_phone` is permanent and `quota_exceeded` is simply unknown to this app;
    neither is in `RETRYABLE_ERRORS`. With the guard removed both are retried to the full
    budget, so a rejected number is sent three times instead of once. The count of create
    calls is the assertion, because the returned result is `failed` either way and a test
    that only read the result would pass while the phone rang twice more.
    """
    client = FailsWith(code)
    run = dispatcher(client=client)
    result = run._create_with_retries(WorkItem(id="S-92", phones=(IN_A,), consented=True))
    assert isinstance(result, ItemResult)
    assert result.resolution is Resolution.FAILED
    assert client.attempts == 1, f"the request was sent {client.attempts} times, not once"


def test_a_retryable_error_is_retried_to_the_budget_and_no_further():
    """The other side of the same guard, so it is asserted in both directions."""
    client = FailsWith("rate_limit_exceeded")
    run = dispatcher(client=client, retry=RetryPolicy(max_attempts=3, base_delay_seconds=0.0))
    run._create_with_retries(WorkItem(id="S-93", phones=(IN_A,), consented=True))
    assert client.attempts == 3


# ---------------------------------------------------------------------------
# dispatch/sources.py:70, 77, 90 -- CsvSource.items
# ---------------------------------------------------------------------------

def write_csv(tmp_path, body: str):
    path = tmp_path / "work.csv"
    path.write_text(body, encoding="utf-8", newline="")
    return path


def test_a_work_file_that_is_not_there_says_so(tmp_path):
    """The first thing the tool does with an argument a human typed.

    Without it, `open` raises `FileNotFoundError` out of the middle of a generator and the
    command dies with a traceback instead of a sentence naming the path.
    """
    with pytest.raises(SourceError, match="No such work file"):
        list(CsvSource(tmp_path / "absent.csv").items())


def test_a_work_file_missing_a_required_column_names_the_column(tmp_path):
    """`id` and `phones` are what a row has to have to be a call.

    Removing the check does not produce an error somewhere else: every row silently gets
    an empty id, and the run either dials nothing or collapses every row onto one
    idempotency key. Neither says which column was missing.
    """
    path = write_csv(tmp_path, "id,consent\nS-1,yes\n")
    with pytest.raises(SourceError, match="phones"):
        list(CsvSource(path).items())


def test_a_row_with_no_id_is_refused_rather_than_dialled(tmp_path):
    """An id is what an idempotency key is built from.

    A blank one is not a naming problem. Every blank-id row shares the same key, so the
    second is replayed as the first and a real absence is closed with another child's
    answer. The message names the line so the file can be fixed.
    """
    path = write_csv(tmp_path, f"id,phones,consent\nS-1,{IN_A},yes\n,{IN_A},yes\n")
    with pytest.raises(SourceError, match="line 3: empty id"):
        list(CsvSource(path).items())


# ---------------------------------------------------------------------------
# dispatch/validation.py:49, 53, 58, 64 -- assert_supported and problems
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("schema, why", [
    ({"type": "array", "properties": {}}, "a top-level schema that is not an object"),
    ({"type": "object", "patternProperties": {}}, "a keyword this checker never wrote"),
    ({"type": "object", "properties": {"a": {"allOf": []}}},
     "a keyword inside a property"),
    ({"type": "object", "properties": {"a": {"type": "decimal"}}},
     "a property type that does not exist"),
])
def test_a_schema_this_checker_cannot_enforce_is_refused_at_construction(schema, why):
    """`assert_supported` is the promise that a schema means what it looks like it means.

    Three of its four branches were never taken by a test. That matters more than an
    ordinary untested branch: a keyword it silently ignores is a constraint the caller
    believes is being enforced on the model's answer and which nothing is enforcing. The
    dispatcher would then report `resolved` on a result nobody checked properly.
    """
    with pytest.raises(UnsupportedSchema):
        dispatcher(result_schema=schema)


@pytest.mark.parametrize("value", ["a string", 7, None, ["a", "list"], True])
def test_a_result_that_is_not_an_object_is_a_problem_not_a_crash(value):
    """CALL-E's `structured_result` is whatever the response carried.

    A model that answers with a bare string, or a null, reaches `problems` unmodified.
    Without the type check the function walks a non-dict with `.get` and raises
    `AttributeError` inside `_classify`, which the dispatcher turns into a failed item:
    "the call failed" about a call that was answered.
    """
    found = problems(value, SCHEMA)
    assert found and "expected an object" in found[0]
def test_a_call_still_running_at_the_deadline_keeps_its_id_in_the_report():
    """The one list that exists for a call this run placed and cannot account for.

    `_await_terminal` returns a synthetic dict at its deadline rather than raising, so
    `_handle` discarded the id from `_in_flight` and only then classified it. The
    resolution was right, undetermined, and `report.not_recallable` came back empty, so a
    reader was told the call had not finished and given nothing to reconcile against a
    bill. This is the most certain case that list has: the call is not merely unreadable,
    it is still live.
    """
    reads = {"n": 0}

    class calls:
        @staticmethod
        def create(**kwargs):
            return {"id": "call_live", "status": "queued"}

        @staticmethod
        def get(call_id):
            reads["n"] += 1
            # Never terminal, which is what a call that is still ringing looks like.
            return {"id": call_id, "status": "in_progress", "recipients": [{}]}

    class Client:
        pass

    Client.calls = calls
    run = dispatcher(client=Client(), call_timeout_seconds=0.0)
    report = run.run([WorkItem(id="S-7", phones=(IN_A,), consented=True)])
    result = report.results[0]

    assert result.resolution is Resolution.UNDETERMINED, (
        f"a call that never finished came back {result.resolution.value}")
    assert result.call_id == "call_live"
    assert report.not_recallable == ["call_live"], (
        f"the call is still live and not_recallable is {report.not_recallable}. Its id is "
        f"the only thing a reader can take to a bill")
def test_a_cancel_during_a_create_backoff_does_not_say_nothing_was_dispatched():
    """The reason string is affirmative, so being wrong in it is worse than being silent.

    `run()` turns `Cancelled` into SKIPPED with "cancelled before dispatch". The retry loop
    raised it at the top of every attempt, including the attempt after a request had gone
    out and nothing had come back, so a POST that may have been accepted and billed was
    reported as never sent. A platform engineer reading the loop found it and named the
    likeliest trigger: a sibling item taking `insufficient_balance`, which cancels the run
    while every slow item is mid-backoff.

    The cancel arrives through the `sleep` seam, which is already a constructor parameter.
    That makes this a unit test rather than a race: the cancel lands at exactly the instant
    the defect needs and at no other.
    """
    from calle import CalleTimeoutError

    sent = {"n": 0}
    holder = {}

    class calls:
        @staticmethod
        def create(**kwargs):
            sent["n"] += 1
            raise CalleTimeoutError("CALL-E API request timed out.")

        @staticmethod
        def get(call_id):
            raise AssertionError("creation never succeeded; nothing to poll")

    class Client:
        pass

    Client.calls = calls
    run = dispatcher(client=Client(), retry=RetryPolicy(max_attempts=3),
                     sleep=lambda _s: holder["run"].cancel())
    holder["run"] = run
    report = run.run([WorkItem(id="S-8", phones=(IN_A,), consented=True)])
    result = report.results[0]

    assert sent["n"] == 1, f"the fixture sent {sent['n']} request(s), not one"
    assert result.resolution is not Resolution.SKIPPED, (
        "a request went out and was never answered, and the run reported "
        f"{result.resolution.value} with the reason {result.reason!r}, which states that "
        "nothing was dispatched")
    assert result.resolution is Resolution.UNDETERMINED, result.resolution
    assert "may already have been placed" in result.reason, result.reason
    assert "S-8" in result.reason, (
        "the reason has to carry the idempotency key, because a request with no call id "
        "cannot enter not_recallable and the key is the only handle for reconciling it")
def test_a_request_that_may_have_landed_without_an_id_reaches_the_summary_line():
    """A zero next to "not recallable" on a run that may have placed a call.

    `summary()` was `if cancelled: ... elif not_recallable: ...`, and the comment inside that
    `elif` records the last time a fact reached the surface only inside a branch somebody
    else's condition owned. On the cancel path, `cancelled` is true and `not_recallable` is
    empty, because that list holds call ids and this request never returned one, so the
    reader was handed "0 already in flight and not recallable" about a request that had gone
    out unanswered.

    A platform engineer picked the shape of the fix: the key rides on the row and the list is
    derived from the rows, so a fourth path appears in it without anyone registering it, and
    the line says what to do rather than only that something happened. Their reasoning for
    the sentence: because CALL-E honours idempotency keys, the resolution is to send the
    identical request again under the same key, which replays the original rather than
    ringing a second telephone.
    """
    from calle import CalleTimeoutError

    class calls:
        @staticmethod
        def create(**kwargs):
            raise CalleTimeoutError("CALL-E API request timed out.")

        @staticmethod
        def get(call_id):
            raise AssertionError("creation never succeeded; nothing to poll")

    class Client:
        pass

    Client.calls = calls
    holder = {}
    run = dispatcher(client=Client(), retry=RetryPolicy(max_attempts=3),
                     idempotency_key=lambda item: f"attendance:{item.id}:2026-09-08",
                     sleep=lambda _s: holder["run"].cancel())
    holder["run"] = run
    report = run.run([WorkItem(id="S-9", phones=(IN_A,), consented=True)])
    result = report.results[0]

    assert result.possibly_placed_key == "attendance:S-9:2026-09-08", (
        f"the row carries {result.possibly_placed_key!r}, and without the key there is "
        f"nothing to replay the request under")
    assert [r.item.id for r in report.placed_without_id] == ["S-9"], (
        f"the derived list is {[r.item.id for r in report.placed_without_id]}")
    assert report.not_recallable == [], (
        "not_recallable holds call ids and this request returned none, which is the whole "
        "reason the second list exists")

    line = report.summary()
    assert "may have been placed and returned no id" in line, line
    assert "attendance:S-9:2026-09-08" in line, (
        f"the summary names no key, so a reader has nothing to replay: {line}")
    assert "S-9" in line, f"the summary names no item, so nobody can act on it: {line}"
    assert "0 already in flight and not recallable" in line, (
        "the cancelled clause is still expected to print its own zero, honestly, because "
        "no call with an id was in flight. What must not happen is that being the only "
        f"thing the line says: {line}")
