"""Live safety boundaries, with in-memory fake calls and no provider access."""
from dataclasses import replace
from datetime import datetime
from unittest.mock import Mock

import pytest

from fieldline.calle_client import UnknownCallOutcome
from fieldline.demo_data import demo_trip_plan
from fieldline.engine import DemoWaiter, HumanReviewRequired, LiveWaiter, TripEngine
from fieldline.render import QuietRenderer
from fieldline.report import CallRecord, build_incident_brief


def no_answer(phone):
    return {"status": "completed", "recipients": [{"phones": [phone], "status": "no_answer", "attempts": [{"phone": phone, "status": "no_answer"}]}]}


def engine(tmp_path, monkeypatch, results, plan=None, waiter=None):
    monkeypatch.setattr("fieldline.engine.validate_live_window", lambda *a, **k: None)
    dispatcher = Mock(streams_transcript=False)
    dispatcher.create_and_wait.side_effect = results
    eng = TripEngine(plan or demo_trip_plan(), dispatcher, QuietRenderer(), tmp_path,
                     demo=False, waiter=waiter or DemoWaiter(fast=True))
    return eng, dispatcher


def test_unknown_checkin_halts_without_retry(tmp_path, monkeypatch):
    eng, dispatcher = engine(tmp_path, monkeypatch, [UnknownCallOutcome("private token")])
    result = eng.run()
    assert result.status == "unknown_outcome"
    assert dispatcher.create_and_wait.call_count == 1
    assert "private token" not in result.report_path.read_text()


@pytest.mark.parametrize("sr", [{"duress_phrase_detected": True}, {"checkin_status": "safe"}, {"checkin_status": "emergency"}, {"checkin_status": "unclear"}])
def test_generated_checkin_never_drives_live_decision(tmp_path, monkeypatch, sr):
    result_call = no_answer(demo_trip_plan().worker.phone)
    result_call.update(structured_result=sr, summary="PRIVATE transcript 202-555-0111", evidence=["secret evidence"])
    eng, dispatcher = engine(tmp_path, monkeypatch, [result_call])
    result = eng.run()
    assert result.status == "review_required"
    assert dispatcher.create_and_wait.call_count == 1
    assert "PRIVATE" not in result.report_path.read_text()
    assert "secret evidence" not in result.report_path.read_text()


@pytest.mark.parametrize("sr", [{"contact_reached": True, "heard_from_worker_since_checkin": True}, {"contact_reached": True, "assuming_coordination": True}, {"contact_reached": False}])
def test_generated_escalation_never_resumes_hands_off_or_advances(tmp_path, monkeypatch, sr):
    plan = replace(demo_trip_plan(), max_retries=0)
    call = no_answer(plan.escalation[0].phone)
    call["structured_result"] = sr
    eng, dispatcher = engine(tmp_path, monkeypatch, [no_answer(plan.worker.phone), call], plan=plan)
    result = eng.run()
    assert result.status == "review_required"
    assert dispatcher.create_and_wait.call_count == 2


def test_unknown_escalation_never_advances_ladder(tmp_path, monkeypatch):
    plan = replace(demo_trip_plan(), max_retries=0)
    eng, dispatcher = engine(tmp_path, monkeypatch, [no_answer(plan.worker.phone), UnknownCallOutcome()], plan=plan)
    assert eng.run().status == "unknown_outcome"
    assert dispatcher.create_and_wait.call_count == 2


def test_wrong_recipient_no_answer_needs_review(tmp_path, monkeypatch):
    eng, dispatcher = engine(tmp_path, monkeypatch, [no_answer("+15555550199")])
    assert eng.run().status == "review_required"
    assert dispatcher.create_and_wait.call_count == 1


def test_cancel_before_first_call(tmp_path, monkeypatch):
    (tmp_path / "cancel").touch()
    eng, dispatcher = engine(tmp_path, monkeypatch, [])
    assert eng.run().status == "canceled"
    dispatcher.create_and_wait.assert_not_called()


@pytest.mark.parametrize("cancel_after", [1, 2])
def test_cancel_between_every_call(tmp_path, monkeypatch, cancel_after):
    plan = replace(demo_trip_plan(), max_retries=0)
    count = 0
    def dispatch(**kwargs):
        nonlocal count
        count += 1
        if count == cancel_after:
            (tmp_path / "cancel").touch()
        return no_answer(kwargs["recipient"]["phone"])
    eng, dispatcher = engine(tmp_path, monkeypatch, [], plan=plan)
    dispatcher.create_and_wait.side_effect = dispatch
    assert eng.run().status == "canceled"
    assert count == cancel_after


def test_retry_wait_cancellation_is_not_closed_safe(tmp_path, monkeypatch):
    waiter = Mock()
    waiter.wait_until.side_effect = [True, False]
    eng, dispatcher = engine(tmp_path, monkeypatch, [no_answer(demo_trip_plan().worker.phone)], waiter=waiter)
    assert eng.run().status == "canceled"
    assert dispatcher.create_and_wait.call_count == 1


def test_live_brief_omits_all_provider_text(tmp_path):
    plan = demo_trip_plan()
    call = {"summary": "PRIVATE", "structured_result": {"notes": "PRIVATE"}, "evidence": ["PRIVATE"], "recipients": [{"attempts": [{"transcript_turns": [{"text": "PRIVATE"}]}]}]}
    text = build_incident_brief(plan, [], [CallRecord("14:00", "check-in call", "worker", plan.worker.phone, call)], "review", False)
    assert "PRIVATE" not in text
    assert plan.worker.phone not in text


def test_waiter_uses_plan_date_and_rejects_midnight_wrap(tmp_path):
    plan = replace(demo_trip_plan(), date="2026-09-30", start="23:00", end="23:59", checkins=["23:58"])
    waiter = LiveWaiter(tmp_path / "cancel", plan, now=lambda: datetime(2026, 9, 30, 23, 58))
    assert waiter.wait_until("23:58", "checkin")
    with pytest.raises(HumanReviewRequired):
        waiter.wait_until("00:03", "retry")
    tomorrow = LiveWaiter(tmp_path / "cancel", plan, now=lambda: datetime(2026, 10, 1, 23, 58))
    with pytest.raises(HumanReviewRequired):
        tomorrow.wait_until("23:58", "checkin")


def test_waiter_waits_and_honors_cancellation(tmp_path):
    plan = replace(demo_trip_plan(), date="2026-09-30")
    clock = Mock(side_effect=[datetime(2026, 9, 30, 13), datetime(2026, 9, 30, 14)])
    sleep = Mock()
    waiter = LiveWaiter(tmp_path / "cancel", plan, now=clock, sleep=sleep)
    assert waiter.wait_until("14:00", "checkin")
    sleep.assert_called_once()
    (tmp_path / "cancel").touch()
    assert not waiter.wait_until("14:00", "checkin")


@pytest.mark.parametrize("field", ["retry_after_minutes", "grace_minutes"])
def test_full_day_offset_cannot_redial_immediately(tmp_path, monkeypatch, field):
    plan = replace(demo_trip_plan(), **{field: 1440})
    if field == "grace_minutes":
        plan = replace(plan, max_retries=0)
    eng, dispatcher = engine(tmp_path, monkeypatch, [no_answer(plan.worker.phone)], plan=plan)
    assert eng.run().status == "review_required"
    assert dispatcher.create_and_wait.call_count == 1
