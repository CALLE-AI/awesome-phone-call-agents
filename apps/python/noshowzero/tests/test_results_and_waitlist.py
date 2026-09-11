import copy

import pytest

from noshowzero.results import decide, decide_offer, decide_reminder, extract_duration_seconds, extract_transcript
from noshowzero.waitlist import pick_candidate


def _with_result(call, **result):
    c = copy.deepcopy(call)
    c["structured_result"] = {**c["structured_result"], **result}
    return c


# ── reminder decisions ───────────────────────────────────────────────────────

def test_reschedule_releases_the_slot(reminder_call):
    d = decide_reminder(reminder_call)
    assert d["outcome"] == "wants_reschedule" and d["appointment_status"] == "rescheduled"
    assert d["release_slot"] is True and d["reschedule_preference"] == "next Tuesday morning"
    assert d["appointment_id"] == "appt-1042" and d["reminder_window"] == "24h"


def test_confirmation_keeps_the_slot(reminder_call):
    d = decide_reminder(_with_result(reminder_call, outcome="confirmed", reschedule_preference=""))
    assert d["appointment_status"] == "confirmed" and d["reminder_status"] == "confirmed"
    assert d["release_slot"] is False and d["reschedule_preference"] is None


def test_cancellation_releases_the_slot(reminder_call):
    d = decide_reminder(_with_result(reminder_call, outcome="cancelled", reschedule_preference=""))
    assert d["appointment_status"] == "cancelled" and d["release_slot"] is True


def test_only_the_patient_can_change_the_appointment(reminder_call):
    d = decide_reminder(_with_result(reminder_call, reached_patient="no", outcome="cancelled"))
    assert d["outcome"] == "unclear" and d["appointment_status"] is None and d["release_slot"] is False


@pytest.mark.parametrize("outcome,status", [("voicemail", "voicemail"), ("no_answer", "no_answer")])
def test_voicemail_and_no_answer_change_nothing(reminder_call, outcome, status):
    d = decide_reminder(_with_result(reminder_call, reached_patient="no", outcome=outcome))
    assert d["outcome"] == outcome and d["reminder_status"] == status and d["release_slot"] is False


def test_unknown_outcome_is_unclear(reminder_call):
    assert decide_reminder(_with_result(reminder_call, outcome="unknown"))["outcome"] == "unclear"


def test_failed_call_keeps_raw_reason_and_is_not_guessed_into_no_answer(reminder_call):
    c = copy.deepcopy(reminder_call) | {"status": "failed", "structured_result": None}
    c["recipients"][0]["attempts"][0].update(failure_code="busy", failure_message="line busy")
    d = decide_reminder(c)
    assert d["outcome"] == "failed" and d["reason"] == "busy: line busy" and d["release_slot"] is False


def test_missing_result_is_a_validation_failure(reminder_call):
    c = copy.deepcopy(reminder_call) | {"structured_result": None}
    assert decide_reminder(c)["outcome"] == "result_validation_failed"


def test_in_progress_is_not_decided(reminder_call):
    assert decide_reminder(reminder_call | {"status": "in_progress"})["outcome"] == "in_progress"


# ── offer decisions ──────────────────────────────────────────────────────────

def test_accepted_offer_books_the_slot(offer_call):
    d = decide_offer(offer_call)
    assert d["outcome"] == "accepted" and d["book"] is True and d["entry_status"] == "booked"
    assert d["offer_next"] is False and d["slot_id"] == "appt-1042" and d["entry_id"] == "wl-204"


def test_declined_offer_moves_on(offer_call):
    d = decide_offer(_with_result(offer_call, accepted="no"))
    assert d["outcome"] == "declined" and d["entry_status"] == "waiting" and d["offer_next"] is True


def test_removal_request_is_honored(offer_call):
    d = decide_offer(_with_result(offer_call, accepted="no", remove_from_waitlist="yes"))
    assert d["entry_status"] == "removed" and d["offer_next"] is True


def test_undecided_offer_stops_the_cascade(offer_call):
    d = decide_offer(_with_result(offer_call, accepted="unknown"))
    assert d["outcome"] == "needs_review" and d["offer_next"] is False and d["book"] is False


def test_missing_offer_result_stops_the_cascade(offer_call):
    d = decide_offer(copy.deepcopy(offer_call) | {"structured_result": None})
    assert d["outcome"] == "needs_review" and d["offer_next"] is False


def test_unreached_offer_moves_on(offer_call):
    d = decide_offer(_with_result(offer_call, reached_patient="no", accepted="unknown"))
    assert d["outcome"] == "no_answer" and d["offer_next"] is True


def test_decide_dispatches_on_metadata_kind(reminder_call, offer_call):
    assert decide(reminder_call)["kind"] == "reminder" and decide(offer_call)["kind"] == "waitlist_offer"
    with pytest.raises(ValueError):
        decide(reminder_call | {"metadata": {"kind": "something_else"}})


def test_transcript_and_duration(reminder_call):
    transcript = extract_transcript(reminder_call, patient="Daniel")
    assert transcript.splitlines()[1] == "Daniel: Yeah, speaking."
    assert extract_duration_seconds(reminder_call) == 42


# ── waitlist matching ────────────────────────────────────────────────────────

SLOT = {"slot_id": "appt-1042", "slot_at": "2026-09-11T20:30:00Z", "service_type": "Dental Cleaning",
        "timezone": "America/New_York"}


def test_first_matching_patient_is_chosen_and_skips_are_explained(waitlist):
    candidate, skipped = pick_candidate(waitlist, **SLOT)
    assert candidate["entry_id"] == "wl-204"
    assert dict(skipped) == {
        "wl-201": "time outside preferred morning",
        "wl-202": "waiting for Consultation",
        "wl-203": "no consent_to_call",
    }


def test_nobody_is_offered_the_same_slot_twice(waitlist):
    waitlist[3]["offered_slots"] = ["appt-1042"]
    candidate, skipped = pick_candidate(waitlist, **SLOT)
    assert candidate is None and ("wl-204", "already offered this slot") in skipped


def test_only_waiting_entries_are_considered(waitlist):
    waitlist[3]["status"] = "booked"
    assert pick_candidate(waitlist, **SLOT)[0] is None


def test_oldest_entry_wins(waitlist):
    earlier = waitlist[3] | {"entry_id": "wl-100", "created_at": "2026-08-01T00:00:00Z"}
    assert pick_candidate([*waitlist, earlier], **SLOT)[0]["entry_id"] == "wl-100"


def test_preferences_are_read_in_the_clinic_timezone(waitlist):
    # 20:30 UTC is 4:30 PM in New York (afternoon) but 9:30 PM in London (outside every window).
    assert pick_candidate(waitlist, **(SLOT | {"timezone": "Europe/London"}))[0] is None


def test_preferred_dates_are_respected(waitlist):
    waitlist[3]["preferred_dates"] = ["2026-09-14"]
    assert pick_candidate(waitlist, **SLOT)[0] is None
