"""Tests for the wave dispatcher.

These test the product, not the harness. The distinction matters: `test_calle_double.py`
proves the fake models CALL-E faithfully; this file proves our own dispatch logic is
right when driven through that fake.
"""

from __future__ import annotations

import json
import threading
from pathlib import Path

import pytest

from calle_double import CalleDouble, Outcome, build_client
from dispatch import (
    Cancelled,
    DispatchReport,
    Resolution,
    RetryPolicy,
    WaveDispatcher,
    WorkItem,
    default_idempotency_key,
    mask,
)
from dispatch.validation import UnsupportedSchema
from tests.fixtures import IN_A, IN_FALLBACK

SCHEMA = {
    "type": "object",
    "required": ["reason"],
    "properties": {
        "reason": {"type": "string"},
        "returning": {"type": "string", "enum": ["yes", "no", "unknown"]},
        "day_count": {"type": "integer"},
    },
}

GOOD = {"reason": "illness", "returning": "yes"}
TALK = [("bot", "Calling about this morning."), ("user", "She is unwell.")]


def make(double: CalleDouble, **kwargs) -> WaveDispatcher:
    kwargs.setdefault("task_builder", lambda i: f"Ask about {i.id}.")
    kwargs.setdefault("result_schema", SCHEMA)
    kwargs.setdefault("poll_interval_seconds", 0)
    kwargs.setdefault("sleep", lambda _s: None)
    return WaveDispatcher(build_client(double), **kwargs)


@pytest.fixture
def double() -> CalleDouble:
    return CalleDouble(latency_seconds=0.004)


# --------------------------------------------------------------------------
# The three outcomes, which is the whole point
# --------------------------------------------------------------------------

def test_each_terminal_shape_lands_in_the_right_bucket(double):
    double.set_outcome("+9155500001", Outcome.answered(GOOD, TALK))
    double.set_outcome("+9155500002", Outcome.no_answer())
    double.set_outcome("+9155500003", Outcome.ambiguous([("user", "let me check")]))

    report = make(double).run([
        WorkItem(id="a", phones=("+9155500001",)),
        WorkItem(id="b", phones=("+9155500002",)),
        WorkItem(id="c", phones=("+9155500003",)),
    ])

    got = {r.item.id: r.resolution for r in report.results}
    assert got == {
        "a": Resolution.RESOLVED,
        "b": Resolution.FAILED,
        "c": Resolution.UNDETERMINED,
    }
    assert [r.item.id for r in report.needs_human] == ["b", "c"]


def test_a_completed_call_with_an_invalid_result_is_undetermined_not_resolved(double):
    """CALL-E returned something. It does not satisfy our schema. That is not an answer.

    This is the trust-boundary check. Webhooks are unsigned, so nothing that arrives is
    trusted on the strength of one hop, and a shape that fails validation never counts as
    a resolution.
    """
    double.set_outcome("+9155500001", Outcome.answered({"returning": "yes"}, TALK))
    report = make(double).run([WorkItem(id="a", phones=("+9155500001",))])

    result = report.results[0]
    assert result.resolution is Resolution.UNDETERMINED
    assert "missing required field 'reason'" in result.reason
    assert result.structured_result == {"returning": "yes"}


def test_an_out_of_enum_value_is_caught(double):
    double.set_outcome("+9155500001",
                       Outcome.answered({"reason": "ill", "returning": "maybe"}, TALK))
    report = make(double).run([WorkItem(id="a", phones=("+9155500001",))])
    assert report.results[0].resolution is Resolution.UNDETERMINED
    assert "not one of" in report.results[0].reason


def test_a_boolean_does_not_satisfy_an_integer_field(double):
    double.set_outcome("+9155500001",
                       Outcome.answered({"reason": "ill", "day_count": True}, TALK))
    report = make(double).run([WorkItem(id="a", phones=("+9155500001",))])
    assert report.results[0].resolution is Resolution.UNDETERMINED
    assert "boolean" in report.results[0].reason


# --------------------------------------------------------------------------
# The consent gate
# --------------------------------------------------------------------------

def test_a_person_without_consent_is_never_dialled(double):
    double.set_default_outcome(Outcome.answered(GOOD, TALK))
    report = make(double).run([
        WorkItem(id="yes", phones=("+9155500001",)),
        WorkItem(id="no", phones=("+9155500002",), consented=False),
    ])

    by_id = {r.item.id: r for r in report.results}
    assert by_id["no"].resolution is Resolution.SKIPPED
    assert "consent" in by_id["no"].reason
    assert double.dialled == ["+9155500001"], "an unconsented number was dialled"


def test_a_run_of_only_unconsented_people_dials_nothing(double):
    report = make(double).run([
        WorkItem(id="a", phones=("+9155500001",), consented=False),
        WorkItem(id="b", phones=("+9155500002",), consented=False),
    ])
    assert double.dialled == []
    assert report.counts()["skipped"] == 2


# --------------------------------------------------------------------------
# The fallback chain
# --------------------------------------------------------------------------

def test_it_walks_to_the_second_number_and_reports_which_were_tried(double):
    double.set_outcome(IN_A, Outcome.answered(GOOD, TALK, answers_on=1))
    report = make(double).run([
        WorkItem(id="a", phones=(IN_A, IN_FALLBACK)),
    ])

    result = report.results[0]
    assert result.resolution is Resolution.RESOLVED
    assert result.attempts_made == 2
    assert result.numbers_tried == (IN_A, IN_FALLBACK)
    assert result.masked_numbers == ("+91********01", "+91********09")


def test_exhausting_the_chain_reports_how_many_were_tried(double):
    double.set_outcome("+9155500001", Outcome.no_answer())
    report = make(double).run([
        WorkItem(id="a", phones=("+9155500001", "+9155500002", "+9155500003")),
    ])
    assert report.results[0].resolution is Resolution.FAILED
    assert "nobody answered after trying 3 number(s)" == report.results[0].reason


# --------------------------------------------------------------------------
# Cancellation, which the platform does not offer
# --------------------------------------------------------------------------

def test_cancel_stops_new_dispatch_and_names_what_could_not_be_recalled(double):
    """Cancelling cannot stop a call already accepted. It must say so, not pretend."""
    double.set_default_outcome(Outcome.answered(GOOD, TALK))
    items = [WorkItem(id=f"s{i}", phones=(f"+9155500000{i:02d}",)) for i in range(1, 31)]

    dispatcher = make(double, concurrency=2)
    stop = threading.Timer(0.05, dispatcher.cancel)
    stop.start()
    report = dispatcher.run(items)
    stop.cancel()

    assert report.cancelled is True
    assert report.counts()["skipped"] > 0, "cancel did not stop any dispatch"
    assert len(double.dialled) < len(items), "cancel dialled everyone anyway"
    # Every number dialled belongs to an item; nothing was dialled twice.
    assert len(double.dialled) == len(set(double.dialled))
    assert report.cancelled_after == len(double.dialled)


def test_cancelling_before_the_run_dispatches_nothing(double):
    double.set_default_outcome(Outcome.answered(GOOD, TALK))
    dispatcher = make(double)
    dispatcher.cancel()
    report = dispatcher.run([WorkItem(id="a", phones=("+9155500001",))])

    assert double.dialled == []
    assert report.results[0].resolution is Resolution.SKIPPED


# --------------------------------------------------------------------------
# Idempotency and retries
# --------------------------------------------------------------------------

def test_a_retry_reuses_the_same_key_and_does_not_double_dial(double):
    """The docs warn against a fresh key per retry. That is how one blip becomes two calls."""
    double.set_outcome("+9155500001", Outcome.answered(GOOD, TALK))
    double.fail_next_request("rate_limit_exceeded", "slow down", status_code=429)

    dispatcher = make(double, retry=RetryPolicy(max_attempts=3, base_delay_seconds=0),
                      idempotency_key=default_idempotency_key("absence", "2026-09-05"))
    report = dispatcher.run([WorkItem(id="s42", phones=("+9155500001",))])

    assert report.results[0].resolution is Resolution.RESOLVED
    assert double.dialled == ["+9155500001"], "the retry placed a second real call"


def test_a_permanent_error_is_not_retried(double):
    double.fail_next_request("invalid_phone", "not E.164")
    dispatcher = make(double, retry=RetryPolicy(max_attempts=5, base_delay_seconds=0))
    report = dispatcher.run([WorkItem(id="a", phones=("+9155500001",))])

    assert report.results[0].resolution is Resolution.FAILED
    assert report.results[0].failure_code == "invalid_phone"
    assert double.dialled == []


def test_insufficient_balance_stops_the_whole_run(double):
    """Running out of credit mid-batch must halt, not grind through 200 failures."""
    double.set_default_outcome(Outcome.answered(GOOD, TALK))
    double.fail_next_request("insufficient_balance", "no credit")

    items = [WorkItem(id=f"s{i}", phones=(f"+9155500000{i:02d}",)) for i in range(1, 21)]
    report = make(double, concurrency=1).run(items)

    assert report.fatal_error == "insufficient_balance"
    assert len(double.dialled) < len(items)
    assert report.counts()["skipped"] > 0


# --------------------------------------------------------------------------
# The concurrency cap is the only brake that exists
# --------------------------------------------------------------------------

@pytest.mark.parametrize("cap", [1, 2, 5])
def test_the_cap_is_never_exceeded(double, cap):
    double.set_default_outcome(Outcome.answered(GOOD, TALK))
    items = [WorkItem(id=f"s{i}", phones=(f"+9155500000{i:05d}",)) for i in range(30)]

    report = make(double, concurrency=cap).run(items)

    assert double.peak_in_flight <= cap, (
        f"cap {cap} exceeded: peak was {double.peak_in_flight}"
    )
    assert report.counts()["resolved"] == 30


def test_results_come_back_in_input_order_regardless_of_completion_order(double):
    double.set_default_outcome(Outcome.answered(GOOD, TALK))
    items = [WorkItem(id=f"s{i}", phones=(f"+9155500000{i:05d}",)) for i in range(12)]
    report = make(double, concurrency=6).run(items)
    assert [r.item.id for r in report.results] == [i.id for i in items]


# --------------------------------------------------------------------------
# Guards
# --------------------------------------------------------------------------

def test_a_schema_using_unimplemented_keywords_is_refused_up_front():
    """A validator that silently ignores a rule it does not understand is worse than none."""
    with pytest.raises(UnsupportedSchema):
        WaveDispatcher(
            client=None, task_builder=lambda i: "x",
            result_schema={"type": "object", "oneOf": [{"required": ["a"]}]},
        )


def test_a_work_item_must_have_an_id_and_a_number():
    with pytest.raises(ValueError):
        WorkItem(id="", phones=("+9155500001",))
    with pytest.raises(ValueError):
        WorkItem(id="a", phones=())


def test_concurrency_below_one_is_refused():
    with pytest.raises(ValueError):
        WaveDispatcher(client=None, task_builder=lambda i: "x",
                       result_schema=SCHEMA, concurrency=0)


def test_masking_never_leaks_the_middle_of_a_number():
    number = "+915550625542"                      # fictional: +91 555 is unassignable
    assert mask(number) == "+91********42"
    assert "5550625" not in mask(number)
    assert len(mask(number)) == len(number)       # masking must not change the length
    assert mask("+123") == "****"


# --------------------------------------------------------------------------
# Where the work list comes from
# --------------------------------------------------------------------------

def _write(tmp_path, text: str):
    path = tmp_path / "work.csv"
    path.write_text(text, encoding="utf-8")
    return path


def test_csv_source_reads_the_fallback_chain_and_consent(tmp_path):
    from dispatch import CsvSource

    path = _write(tmp_path, (
        "id,phones,locale,region,consent,student_name\n"
        "s1,\"+9155500001,+9155500002\",ta-IN,IN,yes,Anitha\n"
        "s2,+9155500003,en-IN,IN,no,Ravi\n"
    ))
    items = list(CsvSource(path).items())

    assert [i.id for i in items] == ["s1", "s2"]
    assert items[0].phones == ("+9155500001", "+9155500002")
    assert items[0].locale == "ta-IN"
    assert items[0].consented is True
    assert items[0].context == {"student_name": "Anitha"}
    assert items[1].consented is False


def test_a_missing_consent_column_is_refused_rather_than_assumed(tmp_path):
    from dispatch import CsvSource, SourceError

    path = _write(tmp_path, "id,phones\ns1,+9155500001\n")
    with pytest.raises(SourceError) as caught:
        list(CsvSource(path).items())
    assert "consent" in str(caught.value)


def test_duplicate_ids_are_refused_because_they_share_an_idempotency_key(tmp_path):
    from dispatch import CsvSource, SourceError

    path = _write(tmp_path, (
        "id,phones,consent\n"
        "s1,+9155500001,yes\n"
        "s1,+9155500002,yes\n"
    ))
    with pytest.raises(SourceError) as caught:
        list(CsvSource(path).items())
    assert "duplicate id" in str(caught.value)


def test_a_row_with_no_number_is_refused(tmp_path):
    from dispatch import CsvSource, SourceError

    path = _write(tmp_path, "id,phones,consent\ns1,,yes\n")
    with pytest.raises(SourceError):
        list(CsvSource(path).items())


def test_any_work_source_substitutes_for_the_csv_one(double):
    """The adapter is a Protocol, and the dispatcher depends on the Protocol only."""
    from dispatch import MemorySource, WorkSource

    source = MemorySource([WorkItem(id="a", phones=("+9155500001",))])
    assert isinstance(source, WorkSource)

    double.set_default_outcome(Outcome.answered(GOOD, TALK))
    report = make(double).run(source.items())
    assert report.counts()["resolved"] == 1


# -- built from a real production response ----------------------------------

def _live_call() -> dict:
    """A real CALL-E response, captured 2026-09-04, with the number replaced.

    The call was placed to the author's own phone, by the author, and the conversation
    was scripted for a demonstration, so publishing it is a deliberate act rather than a
    leak of somebody's private call. The `provider_call_id` and the phone number are the
    only edited fields.

    It is here because it caught a defect no synthetic fixture would have: the recipient's
    `structured_result` is null while the task's is fully populated.
    """
    path = Path(__file__).parent / "data" / "live-call-single-recipient.json"
    return json.loads(path.read_text(encoding="utf-8"))


LIVE_SCHEMA = {
    "type": "object",
    "required": ["reason_category", "expected_return"],
    "properties": {
        "reason_category": {"type": "string",
                            "enum": ["illness", "transport", "other", "unknown"]},
        "expected_return": {"type": "string",
                            "enum": ["today", "tomorrow", "later_this_week", "unknown"]},
        "parent_confirmed_aware": {"type": "string", "enum": ["yes", "no", "unknown"]},
        "free_text_note": {"type": "string"},
    },
}
LIVE_ITEM = WorkItem(id="S-2002", phones=("+915550000002",), locale="ta-IN", region="IN")


def test_a_real_response_puts_the_answer_where_our_first_version_did_not_look():
    call = _live_call()
    assert call["recipients"][0]["structured_result"] is None, "fixture no longer models the bug"
    assert call["structured_result"]["reason_category"] == "illness"

    result = make(CalleDouble(), result_schema=LIVE_SCHEMA)._classify(LIVE_ITEM, call)

    assert result.resolution is Resolution.RESOLVED, (
        "a completed Tamil call with a schema-valid task-level result was being sent to a "
        "human because only the per-recipient field was read"
    )
    assert result.structured_result["expected_return"] == "tomorrow"
    assert result.structured_result["parent_confirmed_aware"] == "yes"


def test_the_agent_really_spoke_the_locale_it_was_given():
    """The whole product claim, asserted against a real response rather than a promise."""
    call = _live_call()
    assert call["recipients"][0]["locale"] == "ta-IN"
    turns = call["recipients"][0]["attempts"][0]["transcript_turns"]
    bot = " ".join(t["text"] for t in turns if t["speaker"] == "bot")
    tamil = [c for c in bot if "\u0b80" <= c <= "\u0bff"]
    assert len(tamil) > 50, "the agent did not answer in Tamil, so locale was not honoured"
    # The extraction still produced English enum values from a Tamil conversation.
    assert call["structured_result"]["reason_category"] == "illness"


def test_a_task_level_result_is_not_attributed_to_one_of_many_recipients():
    """With fan-out the task result belongs to nobody in particular.

    Falling back there would swap a false negative for a false attribution, which is
    worse: one family's answer would be filed against another family's child.
    """
    call = _live_call()
    call["recipients"].append(json.loads(json.dumps(call["recipients"][0])))
    result = make(CalleDouble(), result_schema=LIVE_SCHEMA)._classify(LIVE_ITEM, call)
    assert result.resolution is Resolution.UNDETERMINED
    assert result.structured_result is None


def test_a_recipient_result_still_wins_over_the_task_result():
    call = _live_call()
    call["recipients"][0]["structured_result"] = {
        "reason_category": "transport", "expected_return": "today"}
    result = make(CalleDouble(), result_schema=LIVE_SCHEMA)._classify(LIVE_ITEM, call)
    assert result.structured_result["reason_category"] == "transport"
