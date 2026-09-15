import copy

import pytest

from leadpulse.results import decide
from leadpulse.schema import RESULT_SCHEMA, unsupported_keywords
from leadpulse.scoring import SCORE_WEIGHTS, score_lead
from leadpulse.task import build_task


def test_schema_uses_only_supported_keywords():
    assert unsupported_keywords(RESULT_SCHEMA) == []


def test_schema_is_closed_and_every_field_required():
    assert RESULT_SCHEMA["additionalProperties"] is False
    assert set(RESULT_SCHEMA["required"]) == set(RESULT_SCHEMA["properties"])


def test_every_enum_has_unknown_and_every_scored_value_exists():
    for name, prop in RESULT_SCHEMA["properties"].items():
        if "enum" in prop:
            assert "unknown" in prop["enum"], name
    for field, table in SCORE_WEIGHTS.items():
        assert set(table) == set(RESULT_SCHEMA["properties"][field]["enum"]), field


def test_weights_top_out_at_100():
    assert sum(max(t.values()) for t in SCORE_WEIGHTS.values()) == 100


def test_task_discloses_ai_and_uses_the_business_questions(business, form):
    task = build_task(business, form)
    assert "virtual assistant for Acme Renovations" in task
    assert "If asked whether you are an AI, say yes." in task
    for q in business["qualification_questions"]:
        assert q in task
    assert "Kitchen remodel" in task


def test_task_never_contains_contact_details(business, form):
    task = build_task(business, form)
    assert "555" not in task
    assert form["email"] not in task
    assert "consent" not in task.lower()


def test_example_scores_89_hot_and_books(completed_call):
    d = decide(completed_call)
    assert d["outcome"] == "qualified"
    assert d["score"] == 89
    assert d["hot_lead"] is True
    assert d["send_booking_link"] is True
    assert sum(d["score_breakdown"].values()) == 89


def test_unreached_lead_gets_no_score(completed_call):
    call = copy.deepcopy(completed_call)
    call["structured_result"]["reached_lead"] = "no"
    d = decide(call)
    assert d["outcome"] == "no_answer"
    assert d["score"] is None
    assert d["send_booking_link"] is False
    assert score_lead(call["structured_result"]) is None


def test_booking_link_needs_interest_and_explicit_yes(completed_call):
    call = copy.deepcopy(completed_call)
    call["structured_result"]["interest_level"] = "low"
    assert decide(call)["send_booking_link"] is False
    call["structured_result"].update(interest_level="strong", wants_booking_link="unknown")
    assert decide(call)["send_booking_link"] is False


def test_weak_lead_is_not_qualified(completed_call):
    call = copy.deepcopy(completed_call)
    call["structured_result"].update(
        interest_level="low", timeline_urgency="just_researching", budget_clarity="none_given"
    )
    d = decide(call)
    assert d["outcome"] == "not_qualified"
    assert d["score"] < 50


def test_completed_without_result_is_validation_failure(completed_call):
    call = copy.deepcopy(completed_call)
    call["structured_result"] = None
    assert decide(call)["outcome"] == "result_validation_failed"


@pytest.mark.parametrize("status", ["failed", "canceled"])
def test_failure_code_is_reported_raw_never_mapped_to_no_answer(completed_call, status):
    call = copy.deepcopy(completed_call)
    call["status"] = status
    call["recipients"][0]["attempts"][0].update(failure_code="carrier_busy", failure_message="line busy")
    d = decide(call)
    assert d["outcome"] == "failed"
    assert d["reason"] == "carrier_busy: line busy"
    assert d["score"] is None


def test_non_terminal_call_is_in_progress(completed_call):
    call = copy.deepcopy(completed_call)
    call["status"] = "in_progress"
    assert decide(call)["outcome"] == "in_progress"
