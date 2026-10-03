"""Tests for the wave dispatcher.

These test the product, not the harness. The distinction matters: `test_calle_double.py`
proves the fake models CALL-E faithfully; this file proves our own dispatch logic is
right when driven through that fake.
"""

from __future__ import annotations

import json
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

import pytest

from calle_double import CalleDouble, Outcome, build_client
from dispatch import (
    Cancelled,
    ItemResult,
    DispatchReport,
    Resolution,
    RetryPolicy,
    WaveDispatcher,
    WorkItem,
    default_idempotency_key,
    is_valid,
    mask,
    problems,
)
from dispatch.models import CANCELLED
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
# Every CALL-E error code has to land somewhere, deliberately
# --------------------------------------------------------------------------

def test_a_number_separated_by_commas_is_still_masked():
    """The separator class decides what counts as one number.

    CALL-E quotes the number it rejected, and a vendor that writes the groups with commas
    splits the run into pieces shorter than the seven-digit floor, so every piece is left
    alone and the whole number survives. Spaces, brackets, dots and hyphens were already
    handled; the comma is the one that was missing.
    """
    from dispatch.models import redact

    leaked = redact("invalid_phone: could not ring +91, 555, 000, 0099")
    assert "0099" not in leaked, f"the number survived redaction: {leaked!r}"
    assert "555" not in leaked, f"the number survived redaction: {leaked!r}"


def test_every_calle_error_code_is_classified_into_exactly_one_bucket():
    """An error code this dispatcher has never heard of falls through to a plain
    permanent failure today, silently: nothing says the code was unrecognised.

    This is the gate against that happening again. If a future SDK version adds a
    twenty-fifth error code, this test fails the suite instead of the fallthrough
    quietly mis-handling it in production.
    """
    from calle_double import API_ERROR_CODES
    from dispatch.models import FATAL_ERRORS, PERMANENT_ERRORS, RETRYABLE_ERRORS

    classified = RETRYABLE_ERRORS | PERMANENT_ERRORS | FATAL_ERRORS
    missing = set(API_ERROR_CODES) - classified
    assert not missing, f"unclassified CALL-E error code(s): {sorted(missing)}"

    extra = classified - set(API_ERROR_CODES)
    assert not extra, f"classified code(s) CALL-E does not define: {sorted(extra)}"

    overlap = ((RETRYABLE_ERRORS & PERMANENT_ERRORS)
               | (RETRYABLE_ERRORS & FATAL_ERRORS)
               | (PERMANENT_ERRORS & FATAL_ERRORS))
    assert not overlap, f"code(s) placed in more than one bucket: {sorted(overlap)}"


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


def test_a_second_run_on_the_same_dispatcher_is_refused_rather_than_silently_wrong(double):
    """Nothing resets `_cancel`, `_fatal`, `_dispatched` or `_in_flight` between runs.

    Reusing an instance that was cancelled during its first run would silently report
    every item in a second run as skipped, with nothing to explain why. Reusing one
    that was not cancelled would still publish a `cancelled_after` count left over from
    the first run. Refusing reuse turns a wrong report into a clear error instead.
    """
    double.set_default_outcome(Outcome.answered(GOOD, TALK))
    dispatcher = make(double)
    dispatcher.run([WorkItem(id="a", phones=("+9155500001",))])

    with pytest.raises(RuntimeError, match="already"):
        dispatcher.run([WorkItem(id="b", phones=("+9155500002",))])


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


def test_duplicate_work_item_ids_are_refused_rather_than_silently_reordered(double):
    """Two items sharing an id would also share the default idempotency key, so the
    second `create()` would replay the first item's call and the answer would be
    attributed to the wrong person. `CsvSource` already refuses this on the way in;
    `run()` accepts any `WorkSource`, so the same refusal belongs here too, not just
    in one particular loader.
    """
    double.set_default_outcome(Outcome.answered(GOOD, TALK))
    with pytest.raises(ValueError, match="duplicate"):
        make(double).run([
            WorkItem(id="a", phones=("+9155500001",)),
            WorkItem(id="a", phones=("+9155500002",)),
        ])


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


def test_a_nested_object_property_is_refused_rather_than_ignored():
    """`properties` is a supported keyword, and `problems` does not recurse into it.

    That combination let a schema declare a rule and then have it ignored. A property
    that was itself an object schema passed `assert_supported`, and every rule inside it
    was then unchecked: the nested enum below accepted any string at all and `problems`
    returned an empty list, which reads exactly like "this answer is valid". The whole
    point of re-validating an unsigned webhook's payload is to not do that.
    """
    nested = {
        "type": "object",
        "properties": {
            "detail": {
                "type": "object",
                "properties": {"severity": {"type": "string", "enum": ["low", "high"]}},
            },
        },
    }
    with pytest.raises(UnsupportedSchema) as raised:
        WaveDispatcher(client=None, task_builder=lambda i: "x", result_schema=nested)
    assert "detail" in str(raised.value)


def test_an_array_property_is_refused_because_elements_are_never_checked():
    """There is no `items` support, so a list of anything at all would pass."""
    with pytest.raises(UnsupportedSchema) as raised:
        WaveDispatcher(
            client=None, task_builder=lambda i: "x",
            result_schema={"type": "object", "properties": {"tags": {"type": "array"}}},
        )
    assert "tags" in str(raised.value)


def test_the_schema_this_app_actually_ships_is_still_accepted():
    """The refusal above is narrow on purpose: it must not break the shipped run.

    `RESULT_SCHEMA` is flat, which is why nothing shipped was affected by the gap. If a
    later field is nested, this test and the two above disagree, and the disagreement is
    the point: either flatten the field or teach `problems` to recurse.
    """
    from dispatch.validation import assert_supported
    from firstbell.domain import RESULT_SCHEMA

    assert_supported(RESULT_SCHEMA)


def test_the_exported_is_valid_agrees_with_problems_on_both_answers():
    """`is_valid` is exported and nothing in this app calls it.

    Every classification test above goes through `problems`, so a wrapper that answered
    True for everything passed the entire suite. This is the only thing holding the
    boolean to the list it is supposed to summarise.
    """
    assert is_valid(GOOD, SCHEMA) is True
    assert problems(GOOD, SCHEMA) == []

    rejected = [
        ({}, "the required field is absent"),
        ({"reason": None}, "the required field is present and null"),
        ({"reason": "illness", "returning": "maybe"}, "a value outside the enum"),
        ({"reason": "illness", "day_count": True}, "a boolean where an integer belongs"),
        ("she is unwell", "a string where the object belongs"),
    ]
    for value, why in rejected:
        assert is_valid(value, SCHEMA) is False, why
        assert problems(value, SCHEMA), why


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


# -- the response shapes real calls turned up -------------------------------
#
# Every fixture below is generated, by tools/make_shape_fixtures.py, from the offline
# double. None of them is a recording. The calls that first showed these shapes were made
# against the production API on 2026-09-04, and the linked evidence page publishes their
# recordings and transcripts. Their receipt files are in neither place, because the
# upstream maintainer requires
# that no real-call artifact be committed, and that holds for a call placed to the author's
# own phone on a reserved number, which is what these were.
#
# The reason an authored fixture is worth trusting here is that the double is measured
# against those recordings rather than against anybody's memory of them. See
# tools/double_conformance.py, evidence/api-shape.json, and the gate in
# test_the_double_emits_every_field_the_real_api_returns. Field names, types, the SIP
# vocabulary and the zero-duration failure all come from that comparison.


def _shape(name: str) -> dict:
    """Load a generated fixture as the API would have returned it.

    `_provenance` is removed on the way through. It is in the file so that nobody reading
    `tests/data/` mistakes an authored fixture for a recording, and it is taken out here so
    that what reaches the classifier is exactly a response body and not a response body
    plus a note from us.
    """
    path = Path(__file__).parent / "data" / name
    call = json.loads(path.read_text(encoding="utf-8"))
    assert call.pop("_provenance", None), (
        f"{name} has no _provenance line, so a reader cannot tell whether it was recorded "
        "or generated. Run tools/make_shape_fixtures.py."
    )
    return call


def _task_result_shape() -> dict:
    """The result on the task, nothing on the recipient.

    This is the shape that caught the first defect, and it was a real call that caught it:
    the dispatcher read only `recipients[0].structured_result`, production had populated
    only the task-level field, and completed Tamil calls were being queued for a human.

    The offline suite could not have found it. The double had the same assumption the
    dispatcher did, so both were wrong in the same direction and every test agreed. That is
    fixed in the double now, and mutation 27 is the gate on it.
    """
    return _shape("shape-task-result-only.json")


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
    call = _task_result_shape()
    assert call["recipients"][0]["structured_result"] is None, "fixture no longer models the bug"
    assert call["structured_result"]["reason_category"] == "illness"

    result = make(CalleDouble(), result_schema=LIVE_SCHEMA)._classify(LIVE_ITEM, call)

    assert result.resolution is Resolution.RESOLVED, (
        "a completed Tamil call with a schema-valid task-level result was being sent to a "
        "human because only the per-recipient field was read"
    )
    assert result.structured_result["expected_return"] == "tomorrow"
    assert result.structured_result["parent_confirmed_aware"] == "yes"


def test_a_tamil_conversation_still_yields_english_enum_values():
    """Checks our reader, and deliberately does not check the platform.

    This was called `test_the_agent_really_spoke_the_locale_it_was_given`, and against a
    recorded response that name was fair: the Tamil in the file was Tamil CALL-E had
    produced, so asserting on it was evidence the locale had been honoured. The fixture is
    generated now. The same assertion would show only that this project can write Tamil,
    which nobody doubts, and keeping the old name would have turned a real claim into a
    circular one.

    What is still worth pinning down, and what this pins down, is that nothing on our side
    assumes the conversation and the extracted values share an alphabet. The turns are in
    Tamil, the enum values come back in English, and a reader that had quietly started
    matching against transcript text would fail here.

    The evidence that CALL-E answers in the locale it was given is on the linked evidence
    page, where the recordings are.
    """
    call = _task_result_shape()
    assert call["recipients"][0]["locale"] == "ta-IN"
    turns = call["recipients"][0]["attempts"][0]["transcript_turns"]
    bot = " ".join(t["text"] for t in turns if t["speaker"] == "bot")
    tamil = [c for c in bot if "\u0b80" <= c <= "\u0bff"]
    assert len(tamil) > 50, "the fixture is meant to hold a Tamil conversation"
    assert not any("\u0b80" <= c <= "\u0bff" for c in
                   json.dumps(call["structured_result"], ensure_ascii=False)), (
        "the extracted result should be in the schema's own vocabulary, not the caller's"
    )
    assert call["structured_result"]["reason_category"] == "illness"


def test_a_task_level_result_is_not_attributed_to_one_of_many_recipients():
    """With fan-out the task result belongs to nobody in particular.

    Falling back there would swap a false negative for a false attribution, which is
    worse: one family's answer would be filed against another family's child.
    """
    call = _task_result_shape()
    call["recipients"].append(json.loads(json.dumps(call["recipients"][0])))
    result = make(CalleDouble(), result_schema=LIVE_SCHEMA)._classify(LIVE_ITEM, call)
    assert result.resolution is Resolution.UNDETERMINED
    assert result.structured_result is None


def test_a_recipient_result_still_wins_over_the_task_result():
    call = _task_result_shape()
    call["recipients"][0]["structured_result"] = {
        "reason_category": "transport", "expected_return": "today"}
    result = make(CalleDouble(), result_schema=LIVE_SCHEMA)._classify(LIVE_ITEM, call)
    assert result.structured_result["reason_category"] == "transport"


# -- placed, replayed, or unknown -------------------------------------------

def test_a_replayed_call_is_not_counted_as_a_call_this_run_placed():
    """Running the same wave twice must not report four calls.

    Production proved this the hard way: a second run reused the same idempotency key,
    CALL-E returned the original call unchanged, no phone rang, nothing was billed, and
    the tool still reported the call as placed.
    """
    # The double stamps calls with its own clock, so start it level with ours and let
    # real time pass between the runs. That is the production sequence in miniature.
    double = CalleDouble(latency_seconds=0.004, now=datetime.now(timezone.utc))
    double.set_outcome(IN_A, Outcome.answered(GOOD, TALK))
    items = [WorkItem(id="S-1", phones=(IN_A,), consented=True)]
    key = default_idempotency_key("attendance", "2026-09-14")

    first = make(double, idempotency_key=key).run(items)
    assert first.results[0].placed_by_this_run is True
    assert len(double.dialled) == 1

    time.sleep(1.2)   # longer than the one second of clock slack the check allows
    second = make(double, idempotency_key=key).run(items)
    assert second.results[0].call_id == first.results[0].call_id, "not a replay"
    assert second.results[0].placed_by_this_run is False
    assert len(double.dialled) == 1, "the double dialled again, so this proves nothing"


def test_a_corrected_locale_can_be_called_again_the_same_day():
    """The refusal is right. Being stuck with it until tomorrow was not.

    `default_idempotency_key` keys on `(prefix, student, day)`, and CALL-E fingerprints the
    request body, so correcting a row and re-running it the same day is the same key with a
    different body: `idempotency_conflict`, which is a permanent error, so the row is FAILED
    with no retry and no call. That is the safe direction and it should stay.

    What was missing was any way out. Nothing exposed the prefix, so a family called in a
    language they do not speak could not be reached again until the next day, on the one
    field this project argues decides whether the call was understood at all. The way out is
    a label: it changes the prefix, it is required rather than a bare switch, and it lands in
    the receipt, because a second call to the same family in one morning needs a reason on
    the record.
    """
    double = CalleDouble(latency_seconds=0.004)
    double.set_outcome(IN_A, Outcome.answered(GOOD, TALK))
    day = "2026-09-14"

    wrong = [WorkItem(id="S-1", phones=(IN_A,), locale="en-IN")]
    first = make(double, idempotency_key=default_idempotency_key("attendance", day)).run(wrong)
    assert first.results[0].resolution is Resolution.RESOLVED
    assert len(double.dialled) == 1

    # The office notices the family speaks Tamil and fixes the file.
    corrected = [WorkItem(id="S-1", phones=(IN_A,), locale="ta-IN")]
    second = make(double, idempotency_key=default_idempotency_key("attendance", day)).run(corrected)
    assert second.results[0].resolution is Resolution.FAILED
    assert second.results[0].failure_code == "idempotency_conflict", (
        "this test proves nothing unless the second run really is refused: "
        f"{second.results[0].reason}")
    assert len(double.dialled) == 1, "the double dialled anyway, so there was no conflict"

    # `--again locale-fix` is this, in the CLI. A different prefix, the same day, the same
    # student, and the corrected body is accepted.
    third = make(double, idempotency_key=default_idempotency_key(
        "attendance-locale-fix", day)).run(corrected)
    assert third.results[0].resolution is Resolution.RESOLVED
    assert third.results[0].call_id != first.results[0].call_id, "that was a replay"
    assert len(double.dialled) == 2, "the corrected call was not placed"


def test_the_label_cannot_re_dial_a_previous_days_work():
    """The label goes in the prefix, not in place of the day.

    Putting the correction where the day sits would make one label a key that has never
    been used before, for every row, on every day: a file re-run with `--again` a week
    later would phone every family in it about an absence from last Tuesday.
    """
    double = CalleDouble(latency_seconds=0.004)
    double.set_outcome(IN_A, Outcome.answered(GOOD, TALK))
    items = [WorkItem(id="S-1", phones=(IN_A,))]

    make(double, idempotency_key=default_idempotency_key(
        "attendance-locale-fix", "2026-09-14")).run(items)
    assert len(double.dialled) == 1

    # Same label, same student, a different day: a different key, which is correct, and it
    # is the day that makes it so.
    again = make(double, idempotency_key=default_idempotency_key(
        "attendance-locale-fix", "2026-09-15")).run(items)
    assert again.results[0].resolution is Resolution.RESOLVED
    assert len(double.dialled) == 2


def test_provenance_is_unknown_rather_than_assumed_when_the_timestamp_is_missing(double):
    """An unknown quietly rounded to "placed" is the error this project exists to avoid."""
    dispatcher = make(double)
    dispatcher._run_started_at = datetime.now(timezone.utc)
    assert dispatcher._was_placed_now({"created_at": None}) is None
    assert dispatcher._was_placed_now({"created_at": "not a timestamp"}) is None
    assert dispatcher._was_placed_now({}) is None
    # A naive timestamp is read as UTC rather than discarded.
    assert dispatcher._was_placed_now(
        {"created_at": datetime.now(timezone.utc).replace(tzinfo=None).isoformat()}) is True
    # A service clock hours ahead of ours makes the comparison meaningless, not "fresh".
    from datetime import timedelta
    skewed = (datetime.now(timezone.utc) + timedelta(hours=6)).isoformat()
    assert dispatcher._was_placed_now({"created_at": skewed}) is None


def test_a_service_clock_far_behind_ours_is_unknown_not_a_definite_replay(double):
    """The guard for a clock running far ahead already existed. Nothing matched it on
    the other side, so a service clock running far behind ours read as a definite
    replay: no call placed, no phone rung. Reporting "replayed" is a claim that this
    run made no difference, and a wrong one understates what actually happened just as
    much as a wrong "placed" would overstate it.
    """
    from datetime import timedelta
    dispatcher = make(double)
    dispatcher._run_started_at = datetime.now(timezone.utc)
    skewed = (datetime.now(timezone.utc) - timedelta(hours=6)).isoformat()
    assert dispatcher._was_placed_now({"created_at": skewed}) is None


def test_the_summary_separates_the_three_provenances():
    from firstbell.domain import summarise
    made = ItemResult(item=WorkItem(id="a", phones=(IN_A,)), resolution=Resolution.RESOLVED,
                      attempts_made=2, placed_by_this_run=True)
    replay = ItemResult(item=WorkItem(id="b", phones=(IN_A,)), resolution=Resolution.RESOLVED,
                        attempts_made=1, placed_by_this_run=False)
    dunno = ItemResult(item=WorkItem(id="c", phones=(IN_A,)), resolution=Resolution.FAILED,
                       attempts_made=3, placed_by_this_run=None)
    s = summarise([made, replay, dunno], live=True)
    assert (s.calls_placed, s.calls_replayed, s.calls_unknown_provenance) == (2, 1, 3)
    text = "\n".join(s.lines())
    assert "attempts placed      2" in text
    assert "calls replayed       1" in text
    assert "provenance unknown   3" in text


def test_a_real_failure_is_described_in_words_an_office_can_act_on():
    """`call_failed` on the task, raw SIP `603` on the attempt, and zero duration.

    A real call found this on 2026-09-04, and neither code was one of the two this
    dispatcher had been written against. That is how an invented vocabulary gets found out,
    and it is also why the double now speaks SIP on an attempt: it used to send a symbolic
    name of its own, the dispatcher's SIP table missed it, and the same unanswered call
    produced one message offline and a different one against production. Mutation 29 is
    the gate, and it fails six tests.
    """
    call = _shape("shape-declined-603.json")
    assert call["failure_code"] == "call_failed"
    assert call["recipients"][0]["attempts"][0]["failure_code"] == "603"

    result = make(CalleDouble(), result_schema=LIVE_SCHEMA)._classify(LIVE_ITEM, call)

    assert result.resolution is Resolution.FAILED
    assert result.resolution.needs_a_human
    assert result.failure_code == "call_failed", "the symbolic code is the useful one"
    assert result.reason == "nobody answered after trying 1 number(s)", (
        f"a queue row reading {result.reason!r} makes an administrator look up a SIP code"
    )
    assert "603" not in result.reason
    # started_at == completed_at: nothing rang, so no person refused this call.
    att = call["recipients"][0]["attempts"][0]
    assert att["started_at"] == att["completed_at"]
    for word in ("declined", "rejected", "hung up"):
        assert word not in result.reason, (
            f"{word!r} asserts something about a call the platform mis-reported: it sent "
            "603 Decline and zero duration for a call the operator watched ring out"
        )


def test_every_sip_code_we_claim_to_translate_actually_translates():
    dispatcher = make(CalleDouble())
    for code, expected in dispatcher.SIP_REASONS.items():
        described = dispatcher._describe_failure("call_failed", ("+915550000003",), code)
        assert described.startswith(expected), code
    # An unknown code is reported, not silently prettified into a wrong reason.
    unknown = dispatcher._describe_failure("call_failed", ("+915550000003",), "499")
    assert "did not connect" in unknown


def test_a_row_of_unknowns_is_not_an_answer():
    """Completed, schema-valid, and it learned nothing.

    A real call on 2026-09-04 produced this: the person said they were at work and could
    not talk, and CALL-E returned a result in which every required field was "unknown",
    with its own note saying no reason and no return date had been collected. The first
    version of this dispatcher called that resolved and closed the record, which is a
    school marking a child explained when nobody had explained anything.

    Schema validity is not an answer. That is the rule this holds.
    """
    call = _shape("shape-all-unknown.json")
    assert call["status"] == "completed"
    result = make(CalleDouble(), result_schema=LIVE_SCHEMA)._classify(LIVE_ITEM, call)

    assert result.resolution is Resolution.UNDETERMINED
    assert result.resolution.needs_a_human
    assert "every required field came back unknown" in result.reason
    # The result is kept. It is evidence of what was asked, not of what was learned.
    assert result.structured_result["reason_category"] == "unknown"


def test_one_real_answer_is_enough_to_count_as_answered(double):
    """The rule is "learned nothing", not "learned everything"."""
    partial = {"reason_category": "illness", "expected_return": "unknown"}
    double.set_outcome(IN_A, Outcome.answered(partial, TALK))
    report = make(double, result_schema={"type": "object",
                                         "required": ["reason_category", "expected_return"],
                                         "properties": LIVE_SCHEMA["properties"]}).run(
        [WorkItem(id="S-9", phones=(IN_A,), consented=True)])
    assert report.results[0].resolution is Resolution.RESOLVED


def test_an_optional_field_left_unknown_does_not_condemn_the_call(double):
    full = {"reason_category": "illness", "expected_return": "tomorrow",
            "parent_confirmed_aware": "unknown"}
    double.set_outcome(IN_A, Outcome.answered(full, TALK))
    report = make(double, result_schema=LIVE_SCHEMA).run(
        [WorkItem(id="S-9", phones=(IN_A,), consented=True)])
    assert report.results[0].resolution is Resolution.RESOLVED


def test_the_receipt_carries_the_id_the_vendor_bills_against(double):
    """CALL-E's dashboard is keyed on `provider_call_id`, not on the API's `id`.

    Without it a receipt can only be checked against itself. With it, a reader can take a
    row from this app's output to the vendor's own usage page and see the charge, which is
    the one account of a call this project does not write.

    The value is read from the *last* attempt, because a call that fell back to a second
    number was billed under the attempt that connected.
    """
    dispatcher = make(double)
    result = dispatcher._classify(
        WorkItem(id="S-77", phones=(IN_A,), consented=True),
        {"id": "call_notARealId", "status": "completed",
         "recipients": [{"attempts": [
             {"phone": IN_A, "provider_call_id": "aaaa1111bbbb2222cccc3333dddd4444"},
             {"phone": IN_A, "provider_call_id": "bbbb2222cccc3333dddd4444eeee5555"},
         ]}]})
    assert result.call_id == "call_notARealId"
    assert result.provider_call_id == "bbbb2222cccc3333dddd4444eeee5555"


def test_a_call_with_no_attempts_reports_no_provider_id_rather_than_crashing(double):
    result = make(double)._classify(
        WorkItem(id="S-78", phones=(IN_A,), consented=True),
        {"id": "call_x", "status": "failed", "recipients": [{"attempts": []}]})
    assert result.provider_call_id is None


def test_a_run_that_never_got_an_answer_does_not_claim_it_reached_the_api(double):
    """`reached_production_api` was derived from configuration and named for an outcome.

    A live run whose every attempt dies at the transport layer never exchanges a byte with
    CALL-E, yet the old field still published that production had been reached. That is the
    overstatement `docs/receipt-provenance.md` exists to prevent, in the implementation of
    the rule itself.

    Three states, matching `placed_by_this_run`: True when the API answered anything at all,
    including an error, False when nothing was attempted, None before a run.
    """
    dispatcher = make(double)
    assert dispatcher.api_responded is None, "a dispatcher that has not run knows nothing"

    dispatcher.run([WorkItem(id="S-80", phones=(IN_A,), consented=True)])
    assert dispatcher.api_responded is True, "the double answered, so the API answered"


def test_an_api_error_still_counts_as_the_api_answering(double):
    """A 401 is a response. It proves the host is there and rejected us."""
    double.fail_next_request(code="unauthorized", message="Invalid or missing API key.", status_code=401)
    dispatcher = make(double)
    dispatcher.run([WorkItem(id="S-81", phones=(IN_A,), consented=True)])
    assert dispatcher.api_responded is True


def test_a_run_that_reaches_nothing_says_so(double):
    """The defect this whole field exists for: the network is down and nothing answers.

    Before the fix, `reached_production_api` was computed from the base URL alone, so a run
    that exchanged no bytes with CALL-E still published that it had reached production. The
    only honest answer here is False.
    """
    class NeverAnswers:
        def __getattr__(self, _name):
            raise ConnectionError("connection refused")

    dispatcher = WaveDispatcher(
        NeverAnswers(), task_builder=lambda i: "x", result_schema=SCHEMA,
        poll_interval_seconds=0, sleep=lambda _s: None)
    report = dispatcher.run([WorkItem(id="S-82", phones=(IN_A,), consented=True)])

    assert dispatcher.api_responded is False, "nothing answered, so nothing was reached"
    assert report.results[0].resolution is not Resolution.RESOLVED


def test_a_retry_policy_that_would_place_no_calls_is_refused():
    """Zero attempts is not a cautious setting, it is a silent one.

    `for attempt in range(1, max_attempts + 1)` is empty at zero, so the create loop never
    ran, no call was placed, and every item came back FAILED with an empty reason. A queue
    of blank refusals reads as "we tried and nobody answered" about a run that dialled
    nobody, which is the confusion this whole program exists to remove.
    """
    with pytest.raises(ValueError) as caught:
        RetryPolicy(max_attempts=0)
    assert "no calls" in str(caught.value)


def test_a_timeout_creating_a_call_stops_and_is_never_called_a_failure():
    """A timeout is not an answer.

    `CalleTimeoutError` and `CalleConnectionError` subclass `Exception`, not
    `CalleAPIError`, so they missed the only `except` in the create loop and landed in the
    dispatcher's catch-all as FAILED, which reads as "nobody was reached" about a request
    that may well have arrived. Stop submitting and preserve the same key for manual
    provider reconciliation rather than assuming a repeat is harmless.
    """
    from calle import CalleTimeoutError

    keys = []

    class TimesOut:
        class calls:
            @staticmethod
            def create(**kwargs):
                keys.append(kwargs["idempotency_key"])
                raise CalleTimeoutError("read timed out")

    dispatcher = WaveDispatcher(
        TimesOut(), task_builder=lambda i: "x", result_schema=SCHEMA,
        poll_interval_seconds=0, sleep=lambda _s: None,
        retry=RetryPolicy(max_attempts=3))
    report = dispatcher.run([WorkItem(id="S-91", phones=(IN_A,), consented=True)])
    result = report.results[0]

    assert len(keys) == 1, "a timeout must stop automatic submission"
    assert result.possibly_placed_key == keys[0]
    assert result.resolution is Resolution.UNDETERMINED, (
        f"a call that may have been placed was reported {result.resolution.value}")
    assert dispatcher.api_responded is False, "nothing answered, so nothing was reached"


# --- What a run took off the desk -------------------------------------------------
#
# The claim these tests defend: this run is cheaper than a person below some price per
# call. That claim is only honest if the arithmetic charges for every attempt the run
# billed and credits only the attempts behind records it actually closed. Each test below
# was made to fail once before it was kept.


def _ledger():
    """Three closed records costing four attempts, two open ones costing three."""
    from dispatch import ItemResult, Resolution, WorkItem
    def r(name, resolution, attempts):
        return ItemResult(item=WorkItem(id=name, phones=(IN_A,)), resolution=resolution,
                          attempts_made=attempts, placed_by_this_run=True)
    return [
        r("closed-1", Resolution.RESOLVED, 1),
        r("closed-2", Resolution.RESOLVED, 1),
        r("closed-3", Resolution.RESOLVED, 2),
        r("open-1", Resolution.UNDETERMINED, 1),
        r("open-2", Resolution.FAILED, 2),
    ]


def test_the_attempt_ledger_balances():
    """Every attempt billed is either removed from the desk or still on it."""
    from firstbell.domain import StaffCost, summarise
    s = summarise(_ledger(), live=True, staff=StaffCost.us_school_office())
    assert s.calls_placed == 7
    assert s.attempts_resolved + s.attempts_open == s.calls_placed


def test_break_even_charges_every_attempt_and_credits_only_the_closed_ones():
    from firstbell.domain import StaffCost, summarise
    staff = StaffCost.us_school_office()
    s = summarise(_ledger(), live=True, staff=staff)
    assert s.break_even_per_call_minute == (4 / 7) * (staff.hourly / 60.0)


def test_an_open_attempt_is_never_counted_as_a_saving():
    """Crediting the three open attempts would inflate the ceiling by 75 percent.

    This is the mutation that matters. A pipeline that treats "we called them" as "the
    work is done" is the exact failure this app exists to refuse, and it would show up
    here as a bigger, better-looking number.
    """
    from firstbell.domain import StaffCost, summarise
    staff = StaffCost.us_school_office()
    honest = summarise(_ledger(), live=True, staff=staff).break_even_per_call_minute
    if_all_credited = (7 / 7) * (staff.hourly / 60.0)
    assert honest < if_all_credited
    assert honest == (4 / 7) * (staff.hourly / 60.0)


def test_a_run_that_placed_no_calls_reports_no_ceiling_rather_than_zero():
    """Third outcome. A replayed run billed nothing, so the ratio has no denominator."""
    from dispatch import ItemResult, Resolution, WorkItem
    from firstbell.domain import StaffCost, summarise
    replayed = ItemResult(item=WorkItem(id="a", phones=(IN_A,)),
                          resolution=Resolution.RESOLVED, attempts_made=2,
                          placed_by_this_run=False)
    s = summarise([replayed], live=True, staff=StaffCost.us_school_office())
    assert s.calls_placed == 0
    assert s.break_even_per_call_minute is None
    assert "staff time avoided   not computed" in "\n".join(s.lines())


def test_no_staff_cost_means_the_block_is_absent_not_zero():
    from firstbell.domain import summarise
    s = summarise(_ledger(), live=True, staff=None)
    assert s.break_even_per_call_minute is None
    assert "not computed" in "\n".join(s.lines())


def test_a_wage_without_a_source_is_refused():
    from firstbell.domain import StaffCost
    with pytest.raises(ValueError, match="source"):
        StaffCost(annual=50_000.0, currency="$", hours_per_year=2_080,
                  occupation="Clerk", industry="Schools", source="   ",
                  source_url="", year=2026)


def test_a_funding_rate_without_a_source_is_refused():
    """The other money class, which had this rule and nothing exercising it.

    `FundingRate` and `StaffCost` both refuse a figure asserted with no provenance, and both
    spell the check as a loop over required field names. Only the wage was tested. Removing
    `source` from this one failed no test at all, which is how a rule stops being a rule.
    """
    from firstbell.domain import FundingRate
    for blank in ("", "   "):
        with pytest.raises(ValueError, match="source"):
            FundingRate(amount=12.0, currency="$", jurisdiction="Texas", source=blank,
                        source_url="https://example.gov/rate", year=2026)


def test_a_wage_that_is_not_positive_is_refused():
    from firstbell.domain import StaffCost
    with pytest.raises(ValueError):
        StaffCost(annual=0.0, currency="$", hours_per_year=2_080, occupation="Clerk",
                  industry="Schools", source="s", source_url="", year=2026)
    with pytest.raises(ValueError):
        StaffCost(annual=1.0, currency="$", hours_per_year=0, occupation="Clerk",
                  industry="Schools", source="s", source_url="", year=2026)


def test_the_default_wage_prints_where_it_came_from():
    """A number in judge-facing output has to carry its provenance to the same screen."""
    from firstbell.domain import StaffCost, summarise
    staff = StaffCost.us_school_office()
    assert staff.annual == 48_980.0
    assert staff.hours_per_year == 2_080
    text = "\n".join(summarise(_ledger(), live=True, staff=staff).lines())
    assert "Bureau of Labor Statistics" in text
    assert "bls.gov" in text
    assert "Educational services" in text


def test_the_citation_wraps_instead_of_running_off_the_terminal():
    """One exemption, and it is deliberately narrow: a line that is only a URL.

    A wrapped URL cannot be opened, so it is allowed to overrun. The exemption is
    written as "the whole line is a single http token" rather than "long lines are fine",
    so it cannot quietly start covering ordinary prose.
    """
    from firstbell.domain import StaffCost, summarise
    lines = summarise(_ledger(), live=True, staff=StaffCost.us_school_office()).lines()
    assert lines, "expected a summary"
    bare_url = [ln for ln in lines if ln.strip().startswith("http")
                and " " not in ln.strip()]
    assert len(bare_url) == 1, "expected exactly one URL line to exempt"
    for line in lines:
        if line in bare_url:
            continue
        assert len(line) <= 96, line


def test_the_source_url_is_never_split_across_lines():
    """The regression this guards: textwrap broke the BLS URL mid-path."""
    from firstbell.domain import StaffCost, summarise
    staff = StaffCost.us_school_office()
    lines = summarise(_ledger(), live=True, staff=staff).lines()
    whole = [ln.strip() for ln in lines if ln.strip().startswith("http")]
    assert whole == [staff.source_url]

# -- what the run says happened, when it cannot tell ------------------------
#
# Both of these were found by a code review that reproduced them, and both live in the
# reporting path rather than the calling path, which is why the rest of the suite missed
# them. A wrong number in a receipt and a placed call reported as never placed are the two
# ways this app can lie about what it did.

def test_a_vendors_error_message_cannot_leak_the_number_it_rejected(double):
    """Numbers are masked on the way out. This is the way in.

    CALL-E's `invalid_phone` quotes the number it refused, and the reason string built from
    that message is printed to stdout and written to the receipt. Every masking test in
    this suite uses a number that validates, so none of them ever reaches this path.
    """
    double.fail_next_request("invalid_phone", "'0412345678' is not E.164.")
    report = make(double).run([WorkItem(id="s1", phones=("+915550000001",))])

    reason = report.results[0].reason
    assert "0412345678" not in reason, (
        f"the rejected number survived into the reason: {reason!r}. This string reaches "
        "stdout and the receipt."
    )
    # The useful half has to survive, or the fix is just deletion.
    assert "invalid_phone" in reason, reason
    assert "E.164" in reason, (
        f"masking ate the diagnosis as well as the number: {reason!r}"
    )


def test_a_long_digit_run_in_any_error_is_masked_whatever_it_is(double):
    """The rule has no exceptions, which is the reason it can be relied on.

    A vendor is free to put a number anywhere in a message, in any format. Rather than
    guess which fields quote input, every phone-shaped digit run in text this app did not
    write is masked.
    """
    double.fail_next_request("invalid_request", "recipient 09 8765 4321 was refused")
    report = make(double).run([WorkItem(id="s1", phones=("+915550000001",))])
    reason = report.results[0].reason
    for fragment in ("09 8765 4321", "0987654321", "8765"):
        assert fragment not in reason, f"{fragment!r} survived in {reason!r}"


def test_a_call_that_was_placed_is_never_reported_as_one_that_was_not(double):
    """A transient read failure after creation used to lose the call entirely.

    `Resolution.FAILED` means, in its own docstring, that the call did not happen. One
    network error while polling produced exactly that verdict for a call that had been
    created and would be billed, with `call_id` dropped on the floor. The id is the only
    way anybody could go and find out what really happened.
    """
    double.set_default_outcome(Outcome.answered(GOOD, TALK))
    dispatcher = make(double, retry=RetryPolicy(max_attempts=2, base_delay_seconds=0))

    real_get = dispatcher._client.calls.get

    def always_fails(call_id):
        raise ConnectionError("connection reset by peer")

    dispatcher._client.calls.get = always_fails
    try:
        report = dispatcher.run([WorkItem(id="s1", phones=("+915550000001",))])
    finally:
        dispatcher._client.calls.get = real_get

    result = report.results[0]
    assert result.resolution is Resolution.UNDETERMINED, (
        f"got {result.resolution.name}: a call that was created and could not be read "
        "back is unknown, not absent"
    )
    assert result.resolution.needs_a_human
    assert result.call_id, "the id of a placed call was lost, so nobody can look it up"
    assert "could not be read back" in result.reason, result.reason
    assert result.call_id in report.not_recallable, (
        "a call this run placed and cannot account for belongs in not_recallable, which "
        "is the list the summary already prints"
    )


def test_one_failed_read_does_not_condemn_a_call_that_answers_on_the_next(double):
    """The retry has to actually retry, or the fix is only a better error message."""
    double.set_default_outcome(Outcome.answered(GOOD, TALK))
    dispatcher = make(double, retry=RetryPolicy(max_attempts=3, base_delay_seconds=0))

    real_get = dispatcher._client.calls.get
    failures = {"left": 1}

    def fails_once(call_id):
        if failures["left"]:
            failures["left"] -= 1
            raise ConnectionError("connection reset by peer")
        return real_get(call_id)

    dispatcher._client.calls.get = fails_once
    try:
        report = dispatcher.run([WorkItem(id="s1", phones=("+915550000001",))])
    finally:
        dispatcher._client.calls.get = real_get

    assert failures["left"] == 0, "the injected failure never fired"
    assert report.results[0].resolution is Resolution.RESOLVED, report.results[0].reason
    assert report.not_recallable == [], "a call that completed is not unaccounted for"


def test_a_fatal_code_on_a_read_stops_the_run_rather_than_retrying_it():
    """A call this run placed, reported missing, stops the run on the first read.

    `not_found` is in `FATAL_ERRORS` for a reason that only applies to a read: creation
    returning it would be a goal problem and this app passes no goal. For a fortnight the
    only consultation of that set was in `_create_with_retries`, so a 404 mid-poll went
    through `except Exception`, spent the retry budget, raised `PollFailed`, and the run
    dispatched the rest of the batch. A platform engineer served exactly that and got
    `undetermined, not_recallable=['c9'], fatal=None`.

    Three things are asserted, and the first is the one that matters: one read attempt, not
    three. Retrying a code that means the platform has lost a call, or that this client is
    pointed at the wrong environment, spends the budget in front of a decision a person has
    to make, and the calls queued behind it are what it costs.
    """
    class Calls:
        def __init__(self):
            self.reads = 0

        def create(self, **kwargs):
            return {"id": "c9", "status": "queued", "created_at": "2026-09-08T00:00:00Z"}

        def get(self, call_id):
            self.reads += 1
            err = Exception("Call not found.")
            err.code = "not_found"
            raise err

    class Client:
        def __init__(self):
            self.calls = Calls()

    client = Client()
    items = [WorkItem(id=f"S-{n}", phones=("+15550100201",), consented=True)
             for n in range(4)]
    dispatcher = WaveDispatcher(
        client, task_builder=lambda item: "task", result_schema={"type": "object"},
        concurrency=1,
        retry=RetryPolicy(max_attempts=3, base_delay_seconds=0.0, max_delay_seconds=0.0),
        sleep=lambda seconds: None,
    )
    report = dispatcher.run(items)

    assert client.calls.reads == 1, (
        f"the read was attempted {client.calls.reads} time(s). A fatal code is not a "
        "transient one, so the retry budget should not be spent on it"
    )
    assert report.fatal_error == "not_found", (
        f"the run reports fatal_error={report.fatal_error!r} after a call it placed came "
        "back not_found, so nothing tells a person to look"
    )
    assert [r.resolution.value for r in report.results][1:] == ["skipped"] * 3, (
        "the run kept dispatching after the platform lost a call it had already placed: "
        f"{[r.resolution.value for r in report.results]}"
    )
    assert "c9" in report.not_recallable, (
        "the call that was placed and then lost is not named in not_recallable, so the "
        "run cannot say what it left in flight"
    )


def test_an_interrupt_stops_dialling_and_keeps_what_happened():
    """Ctrl-C during a wave used to telephone everybody anyway, then lose the receipt.

    Every future was submitted up front, so the `with ThreadPoolExecutor` block's own exit
    ran `shutdown(wait=True)` with no `cancel_futures`, and the queue drained to the end.
    A probe interrupting after 2 of 8 creates watched all 8 reach the transport and then got
    no report at all, because the exception left `run` before it could return one. The
    dispatcher already had `cancel()`, `report.cancelled` and `report.cancelled_after`, and
    nothing in the shipped path reached any of them.

    An operator pressing Ctrl-C means stop telephoning these families. It does not mean
    forget which ones you already telephoned, so the report comes back with a row for every
    item and the caller can still write its receipt.
    """
    calls = []

    class Calls:
        def create(self, **kwargs):
            calls.append(kwargs)
            time.sleep(0.05)
            if len(calls) == 3:
                raise KeyboardInterrupt
            return {"id": f"c{len(calls)}", "status": "completed",
                    "created_at": "2026-09-08T00:00:00Z",
                    "result": dict(GOOD), "transcript": list(TALK)}

        def get(self, call_id):
            return {"id": call_id, "status": "completed", "result": dict(GOOD),
                    "transcript": list(TALK)}

    class Client:
        def __init__(self):
            self.calls = Calls()

    items = [WorkItem(id=f"S-{n}", phones=("+15550000201",), consented=True)
             for n in range(8)]
    dispatcher = WaveDispatcher(
        Client(), task_builder=lambda item: "task", result_schema=SCHEMA,
        concurrency=1, poll_interval_seconds=0, sleep=lambda seconds: None)

    report = dispatcher.run(items)

    assert report.cancelled is True, (
        "the interrupt was swallowed without saying so, and a receipt that does not record "
        "having been interrupted reads as a complete run")
    assert len(calls) < len(items), (
        f"{len(calls)} of {len(items)} calls were placed after an interrupt, so pressing "
        "Ctrl-C telephoned the families it was pressed to stop calling")
    assert len(report.results) == len(items), (
        "some rows have no result at all, so the receipt cannot say what happened to them")
    assert report.cancelled_after == len([r for r in report.results
                                          if r.reason != CANCELLED]), (
        "cancelled_after has to be the number of rows this run actually got through")
    assert [r.item.id for r in report.results] == [i.id for i in items], (
        "the report reordered the rows, so a clerk reading it top down is not reading the "
        "order the work came in")


def test_an_interrupt_stops_a_handler_that_is_between_attempts():
    """The other half of stopping, and the half the test above cannot see.

    The interrupt handler stops the wave twice over. `cancel()` sets a flag every worker
    reads before it dials again, and `shutdown(cancel_futures=True)` drops whatever the
    pool has not started. At a concurrency of one no worker is ever between attempts, so
    taking the flag out changes nothing the test above can observe, and a mutation that
    took it out killed nothing. Two stops and one of them unpinned.

    The case where only the flag helps is an item whose first attempt timed out. A timeout
    is not an answer, so that item is sitting in a backoff holding a request that may
    already have started a telephone ringing, and the next thing it will do is dial again.
    An operator pressing Ctrl-C during that backoff means do not dial again. With the flag
    the item comes back undetermined and carrying its idempotency key, which is a row a
    person picks up and can safely retry tomorrow. Without it the item waits the backoff
    out and telephones the family after the operator has stopped the run.

    The two items go in with the interrupting one first, because results are collected in
    submission order and the collecting loop blocks on each in turn. Behind the second one
    the interrupt would not be seen until the backoff it is supposed to cut short had
    already finished.
    """
    from calle import CalleTimeoutError

    attempts: dict[str, int] = {}
    running: list[WaveDispatcher] = []
    in_backoff = threading.Event()

    class Calls:
        def create(self, **kwargs):
            who = kwargs["metadata"]["work_item"]
            attempts[who] = attempts.get(who, 0) + 1
            if who == "S-interrupt":
                # Not before the other item has dialled once and timed out. An interrupt
                # landing earlier than that is the case the test above holds, and it comes
                # back cancelled before dialling, which proves nothing about the backoff.
                if not in_backoff.wait(5):
                    raise RuntimeError("the other item never reached its backoff")
                raise KeyboardInterrupt
            if attempts[who] == 1:
                in_backoff.set()
                raise CalleTimeoutError("read timed out")
            return {"id": f"c-{who}", "status": "completed",
                    "created_at": "2026-09-08T00:00:00Z",
                    "result": dict(GOOD), "transcript": list(TALK)}

        def get(self, call_id):
            return {"id": call_id, "status": "completed", "result": dict(GOOD),
                    "transcript": list(TALK)}

    class Client:
        def __init__(self):
            self.calls = Calls()

    def sleep(seconds):
        """The backoff, returning the moment the operator's interrupt lands.

        Bounded rather than open. A mutation that never sets the flag has to end this test
        with a failure and not hang it, so the wait gives up after two seconds and the
        assertions below then see the second attempt it allowed.
        """
        for _ in range(200):
            if running and running[0].cancelled:
                return
            time.sleep(0.01)

    items = [WorkItem(id="S-interrupt", phones=("+15550000301",), consented=True),
             WorkItem(id="S-slow", phones=("+15550000302",), consented=True)]
    dispatcher = WaveDispatcher(
        Client(), task_builder=lambda item: "task", result_schema=SCHEMA,
        concurrency=2, poll_interval_seconds=0, sleep=sleep)
    running.append(dispatcher)

    report = dispatcher.run(items)

    assert report.cancelled is True, "the interrupt was swallowed without saying so"
    assert attempts.get("S-slow") == 1, (
        f"the item in a backoff dialled {attempts.get('S-slow')} times. One is the whole "
        "point: the first attempt timed out, and anything after it went out after the "
        "operator had pressed Ctrl-C to stop telephoning these families. None would mean "
        "it never dialled at all, which is a different case and not this one")

    slow = [one for one in report.results if one.item.id == "S-slow"]
    assert len(slow) == 1, f"S-slow has {len(slow)} rows in the report and needs one"
    assert slow[0].resolution is Resolution.UNDETERMINED, (
        "an item whose attempt timed out and was then cancelled came back as "
        f"{slow[0].resolution}, and a timeout is not an answer: {slow[0].reason}")
    assert "automatic submission stopped" in (slow[0].reason or ""), (
        "the row must explain that submission stopped and reconciliation is required")
    assert slow[0].possibly_placed_key, (
        "the row carries no idempotency key, so a person picking it up tomorrow cannot "
        "retry it without risking a second call to the same house")


def test_a_stopped_run_says_so_in_words_and_in_the_exit_code(tmp_path, monkeypatch, capsys):
    """The two surfaces an operator actually reads.

    `report.cancelled` reached `--json` and `--receipt` and no printed line, so somebody who
    pressed Ctrl-C read a summary that looked like a finished morning, and the exit code was
    0, which is what a cron job wrapping this checks. Exit 4 because 1 is a fatal error and
    2 is a refusal before anything was dialled: an interrupted wave is neither, and the
    difference matters to whoever has to work out what still needs calling.
    """
    import socket

    from calle_double.server import serve
    from firstbell.cli import main

    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]

    real = WaveDispatcher.run

    def stopped(self, items):
        report = real(self, items)
        report.cancelled = True
        report.cancelled_after = 1
        return report

    monkeypatch.setattr(WaveDispatcher, "run", stopped)
    server = serve(port=port)
    try:
        monkeypatch.setenv("CALLE_API_KEY", "iams_test_anything")
        monkeypatch.setenv("CALLE_BASE_URL", f"http://127.0.0.1:{port}")
        code = main(["--work-file", "examples/absences.csv", "--live", "--yes-i-mean-it",
                     "--limit", "2"])
    finally:
        server.shutdown()

    printed = capsys.readouterr().out
    assert code == 4, f"a stopped run exited {code}, which a cron job reads as a good morning"
    assert "was stopped after" in printed, (
        "nothing on the human-readable output says the run did not finish, and every total "
        "printed under it counts only the rows that ran")
    assert "still owed a call" in printed, (
        "the output has to say the untouched rows are still work, because that is the only "
        "thing the operator has to do next")


def test_a_final_body_without_an_id_still_carries_the_one_this_run_placed():
    """The row said no call was placed, beside a receipt naming the call that was.

    `_classify` read the call id out of the poll response. `_handle` has had the id the
    create returned in scope the whole time, and hands it to the not-recallable list on
    every other undetermined path. A proxy or an off-spec body that answers a poll without
    `id` produced a queue row carrying no id at all, next to a receipt naming the call. A
    clerk reading that row does not ring the family back, and the id on the receipt is the
    only trace that somebody's telephone rang.

    Every response recorded in `evidence/api-shape.json` carries `.id` as a string, so this
    needs a mangled body to fire. It is filed anyway because the whole design of `_handle`
    is that an id, once a call has been placed, does not get lost, and this was the one
    path that could lose it.
    """
    shape = _task_result_shape()
    assert shape.get("id"), "the fixture no longer carries an id, so nothing is removed here"
    without = {key: value for key, value in shape.items() if key != "id"}

    placed = []

    class Calls:
        def create(self, **kwargs):
            placed.append(kwargs)
            return {"id": "call_9", "status": "queued",
                    "created_at": "2026-09-08T00:00:00Z"}

        def get(self, call_id):
            return dict(without)

    class Client:
        def __init__(self):
            self.calls = Calls()

    dispatcher = WaveDispatcher(
        Client(), task_builder=lambda item: "task", result_schema=LIVE_SCHEMA,
        concurrency=1, poll_interval_seconds=0, sleep=lambda seconds: None)
    report = dispatcher.run([LIVE_ITEM])

    assert len(report.results) == 1, "one row in, one row out"
    assert report.results[0].call_id == "call_9", (
        "the row carries "
        f"{report.results[0].call_id!r} for a call this run placed as call_9. The id came "
        "from the poll body rather than from the create that returned it, so a body "
        "answering without one loses the only handle a person has on a call that rang")
