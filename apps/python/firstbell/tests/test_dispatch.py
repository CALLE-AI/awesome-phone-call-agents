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


# -- the response shapes real calls turned up -------------------------------
#
# Every fixture below is generated, by tools/make_shape_fixtures.py, from the offline
# double. None of them is a recording. The recordings that first showed these shapes were
# made against the production API on 2026-09-04 and are published as receipts on the linked
# evidence page; they are not in this repository, because the upstream maintainer requires
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
    assert "calls placed         2" in text
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
        {"id": "call_removed_11", "status": "completed",
         "recipients": [{"attempts": [
             {"phone": IN_A, "provider_call_id": "aaaa1111bbbb2222cccc3333dddd4444"},
             {"phone": IN_A, "provider_call_id": "bbbb2222cccc3333dddd4444eeee5555"},
         ]}]})
    assert result.call_id == "call_removed_11"
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
