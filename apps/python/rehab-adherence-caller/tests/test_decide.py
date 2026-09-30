"""The trajectory state machine. These tests are the contribution's regressions."""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path

import pytest

from rehab_adherence.decide import decide, interpret
from rehab_adherence.model import CourseFile

TODAY = date(2026, 8, 11)
EXAMPLE = Path(__file__).resolve().parent.parent / "examples" / "course.example.json"


@pytest.fixture(scope="module")
def course_file() -> CourseFile:
    return CourseFile.parse(json.loads(EXAMPLE.read_text(encoding="utf-8")))


def decision_for(course_file: CourseFile, patient_id: str):
    patient = next(p for p in course_file.patients if p.id == patient_id)
    return decide(patient, course_file.course, course_file.policy, TODAY)


# --- the load-bearing property -------------------------------------------------


def test_same_single_miss_produces_different_actions(course_file: CourseFile) -> None:
    """Ivy and Omar both missed exactly one session, most recently, on the same
    date. History is the only difference, and it must change the action.

    If this test ever passes trivially, the application is a reminder bot.
    """
    ivy = decision_for(course_file, "p_ivy")
    omar = decision_for(course_file, "p_omar")

    assert ivy.signals.consecutive_missed == omar.signals.consecutive_missed == 1
    assert ivy.trajectory == "first_slip"
    assert omar.trajectory == "early_slip"
    assert ivy.action == "call_light_rebook"
    assert omar.action == "call_blocker_and_rebook"
    assert ivy.action != omar.action


def test_light_rebook_does_not_interrogate(course_file: CourseFile) -> None:
    from rehab_adherence.goal import build_task

    ivy = next(p for p in course_file.patients if p.id == "p_ivy")
    task = build_task(course_file.clinic, course_file.course, ivy, decision_for(course_file, "p_ivy"))
    assert "Do not ask why they missed it." in task


# --- each state ----------------------------------------------------------------


@pytest.mark.parametrize(
    ("patient_id", "trajectory", "action"),
    [
        ("p_ivy", "first_slip", "call_light_rebook"),
        ("p_omar", "early_slip", "call_blocker_and_rebook"),
        ("p_rosa", "disengaging", "call_blocker_and_rebook"),
        ("p_tam", "broken_promise", "escalate_to_clinician"),
        ("p_wu", "lapsed", "call_final_reengagement"),
        ("p_kai", "stopped_improved", "call_confirm_discharge"),
        ("p_lena", "disengaging", "call_blocker_and_rebook"),
        ("p_dev", "on_track", "no_action"),
        ("p_sam", "refused", "stop_contact"),
    ],
)
def test_trajectories(course_file: CourseFile, patient_id: str, trajectory: str, action: str) -> None:
    decision = decision_for(course_file, patient_id)
    assert (decision.trajectory, decision.action) == (trajectory, action)


def test_broken_promise_is_never_called_again(course_file: CourseFile) -> None:
    """Said yes, did not come. Repeating the identical call is the wrong answer."""
    tam = decision_for(course_file, "p_tam")
    assert tam.action == "escalate_to_clinician"
    assert tam.will_call is False


def test_refusal_is_permanent(course_file: CourseFile) -> None:
    sam = decision_for(course_file, "p_sam")
    assert sam.action == "stop_contact"
    assert sam.will_call is False


def test_cancellation_with_notice_is_not_a_miss(course_file: CourseFile) -> None:
    """Cancelling with notice is engagement. It must break a run of misses rather
    than extend it, or the machine punishes the patients who communicate."""
    from rehab_adherence.model import Patient

    patient = Patient.parse(
        {
            "id": "p_polite",
            "first_name": "Polite",
            "phone_e164": "+15550101010",
            "consent_to_automated_contact": True,
            "sessions": [
                {"date": "2026-07-28", "status": "attended"},
                {"date": "2026-08-04", "status": "missed"},
                {"date": "2026-08-06", "status": "cancelled_with_notice"},
            ],
        },
        0,
    )
    decision = decide(patient, course_file.course, course_file.policy, TODAY)
    assert decision.signals.consecutive_missed == 0
    assert decision.trajectory != "disengaging"


# --- the gate ------------------------------------------------------------------


def test_missing_consent_blocks_the_call(course_file: CourseFile) -> None:
    lena = decision_for(course_file, "p_lena")
    assert "consent_missing" in lena.blockers
    assert lena.will_call is False


def test_cooldown_blocks_a_second_call_too_soon(course_file: CourseFile) -> None:
    kai = decision_for(course_file, "p_kai")
    assert kai.will_call is True, "7 days since last call equals the minimum, so it is allowed"

    same_but_sooner = decide(
        next(p for p in course_file.patients if p.id == "p_kai"),
        course_file.course,
        course_file.policy,
        date(2026, 8, 9),
    )
    assert "cooldown_active" in same_but_sooner.blockers


def test_attempts_exhausted_blocks(course_file: CourseFile) -> None:
    from rehab_adherence.model import Patient

    patient = Patient.parse(
        {
            "id": "p_many",
            "first_name": "Many",
            "phone_e164": "+15550101011",
            "consent_to_automated_contact": True,
            "sessions": [
                {"date": "2026-07-14", "status": "attended"},
                {"date": "2026-07-16", "status": "attended"},
                {"date": "2026-07-21", "status": "attended"},
                {"date": "2026-07-28", "status": "attended"},
                {"date": "2026-08-06", "status": "missed"},
            ],
            "contact_log": [
                {"date": "2026-07-01", "outcome": "no_answer"},
                {"date": "2026-07-09", "outcome": "no_answer"},
                {"date": "2026-07-17", "outcome": "undecided"},
            ],
        },
        0,
    )
    decision = decide(patient, course_file.course, course_file.policy, TODAY)
    assert "attempts_exhausted" in decision.blockers


def test_non_calling_actions_have_no_blockers(course_file: CourseFile) -> None:
    """A blocker on a call that was never going to happen is noise."""
    assert decision_for(course_file, "p_dev").blockers == ()
    assert decision_for(course_file, "p_sam").blockers == ()


# --- interpreting a result -----------------------------------------------------


def test_symptom_escalates_even_when_a_slot_was_accepted(course_file: CourseFile) -> None:
    """The medical boundary is enforced in code, not in the prompt alone."""
    reading = interpret(
        "COMPLETED",
        {
            "reached_patient": "yes",
            "continued_after_ai_disclosure": "yes",
            "attendance_intent": "will_attend",
            "chosen_slot_id": "s1",
            "barrier": "none",
            "symptom_volunteered": "yes",
            "evidence_summary": "Mentioned a health concern in passing.",
        },
        course_file.course,
    )
    assert reading.outcome == "symptom_reported"
    assert reading.escalate_to_clinician is True
    assert reading.promised_date is None, "a symptom must never be rebooked by this application"


def test_voicemail_is_not_a_refusal(course_file: CourseFile) -> None:
    assert interpret("VOICEMAIL", None, course_file.course).outcome == "voicemail"


def test_silence_is_never_agreement(course_file: CourseFile) -> None:
    """No structured result must not become a booking."""
    reading = interpret("COMPLETED", None, course_file.course)
    assert reading.outcome == "undecided"
    assert reading.promised_date is None


def test_will_attend_without_an_identifiable_slot_is_not_a_booking(course_file: CourseFile) -> None:
    reading = interpret(
        "COMPLETED",
        {
            "reached_patient": "yes",
            "continued_after_ai_disclosure": "yes",
            "attendance_intent": "will_attend",
            "chosen_slot_id": "unknown",
            "barrier": "none",
            "symptom_volunteered": "no",
            "evidence_summary": "Agreed to come but did not settle on a time.",
        },
        course_file.course,
    )
    assert reading.outcome == "undecided"
    assert reading.promised_date is None


def test_declining_after_disclosure_ends_contact(course_file: CourseFile) -> None:
    reading = interpret(
        "COMPLETED",
        {
            "reached_patient": "yes",
            "continued_after_ai_disclosure": "no",
            "attendance_intent": "unknown",
            "chosen_slot_id": "unknown",
            "barrier": "unknown",
            "symptom_volunteered": "no",
            "evidence_summary": "Did not want to speak to an automated caller.",
        },
        course_file.course,
    )
    assert reading.outcome == "refused_contact"


def test_booking_records_the_promised_date(course_file: CourseFile) -> None:
    reading = interpret(
        "COMPLETED",
        {
            "reached_patient": "yes",
            "continued_after_ai_disclosure": "yes",
            "attendance_intent": "will_attend",
            "chosen_slot_id": "s2",
            "barrier": "none",
            "symptom_volunteered": "no",
            "evidence_summary": "Took the Tuesday morning slot.",
        },
        course_file.course,
    )
    assert reading.outcome == "promised_return"
    assert reading.promised_date == date(2026, 8, 18)
