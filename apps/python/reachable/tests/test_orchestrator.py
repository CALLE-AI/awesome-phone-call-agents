"""The orchestrator: imports, scans, guards, results, and the loop between
the two workflows."""

from __future__ import annotations

import pytest

from reachable.models import (
    IN_FLIGHT_ATTEMPTS,
    AttemptState,
    ContactCheckState,
    ContactHealth,
    Disposition,
    NoCallReason,
    PatternState,
    Workflow,
)
from reachable.orchestrator import Orchestrator

from .conftest import AFTER_HOURS, NON_SCHOOL_DAY, SCHOOL_DAY_IN_WINDOW

IVY = "P-1041"
IVY_CASE = "PF-P-1041-2026-09-11"
DYLAN = "P-1203"
DYLAN_CASE = "PF-P-1203-2026-09-10"


def state_of(orc: Orchestrator, case_id: str) -> str:
    return orc.store.case(case_id)["state"]


def health_of(orc: Orchestrator, contact_id: str) -> str:
    row = orc.store.health_for(contact_id)
    return row["status"] if row else ""


# ------------------------------------------------------------------- import


def test_import_adopts_the_schools_own_timezone_and_window(dry):
    assert dry.config.school_name == "Fernhollow Primary School"
    assert dry.config.school_timezone == "Europe/London"
    assert dry.config.call_window_start.hour == 9
    assert dry.config.call_window_end.hour == 16


def test_every_contact_starts_unknown_not_assumed_good(dry):
    assert health_of(dry, "C-2088") == ContactHealth.NOT_CHECKED.value


def test_import_is_recorded_in_the_event_log(dry):
    kinds = [r["kind"] for r in dry.store.rows("SELECT kind FROM events")]
    assert "import.completed" in kinds


# -------------------------------------------------------- register scanning


def test_scan_creates_cases_for_the_designed_triggers(dry):
    created = dry.scan_register()
    assert IVY_CASE in created
    assert DYLAN_CASE in created
    # Niamh had a reason recorded; Priya had one session; Tomas was authorised.
    assert not any("P-1015" in c or "P-1058" in c or "P-1064" in c for c in created)


def test_a_vulnerable_pupil_is_never_called_and_goes_to_staff(dry):
    dry.scan_register()
    assert state_of(dry, DYLAN_CASE) == PatternState.PF_NOT_CALLED.value

    reasons = [d["reason"] for d in dry.store.decisions()]
    assert NoCallReason.PUPIL_VULNERABLE.value in reasons

    tasks = dry.store.tasks()
    vulnerable = [t for t in tasks if t["kind"] == "vulnerable_pupil"]
    assert len(vulnerable) == 1
    assert vulnerable[0]["urgent"] == 1
    assert "social worker" in vulnerable[0]["detail"]

    # And no attempt was ever created for that case.
    assert dry.store.rows("SELECT 1 FROM call_attempts WHERE case_id = ?", (DYLAN_CASE,)) == []


def test_the_decision_reason_is_human_readable(dry):
    dry.scan_register()
    events = [e["reason"] for e in dry.store.events_for(DYLAN_CASE)]
    assert any("vulnerable" in r and "staff task" in r for r in events)


def test_scan_selects_the_first_contact_in_the_schools_order(dry):
    dry.scan_register()
    case = dry.store.case(IVY_CASE)
    assert case["state"] == PatternState.PF_CASCADE_READY.value
    assert case["contact_id"] == "C-2089"  # Daniel Fry, contact_order 1


def test_scanning_twice_does_not_duplicate_cases(dry):
    first = dry.scan_register()
    second = dry.scan_register()
    assert first and second == []


# ------------------------------------------------------------------ guards


def test_dry_run_refuses_before_any_transport_is_reached(dry, fake_client):
    dry.scan_register()
    outcome = dry.place_call(IVY_CASE, confirmed=True, now=SCHOOL_DAY_IN_WINDOW)
    assert not outcome.placed
    assert outcome.reason is NoCallReason.DRY_RUN
    assert fake_client.state.requests == []
    # The preview still renders, so the office can see exactly what would be said.
    assert outcome.preview is not None
    assert "automated assistant" in outcome.preview.task


def test_live_mode_alone_is_not_sufficient(live, fake_client):
    live.scan_register()
    outcome = live.place_call(IVY_CASE, confirmed=False, now=SCHOOL_DAY_IN_WINDOW)
    assert not outcome.placed
    assert outcome.reason is NoCallReason.AWAITING_CONFIRMATION
    assert fake_client.state.requests == []


def test_outside_the_calling_window_is_a_hold_that_names_the_time(live, fake_client):
    live.scan_register()
    outcome = live.place_call(IVY_CASE, confirmed=True, now=AFTER_HOURS)
    assert outcome.reason is NoCallReason.OUTSIDE_CALLING_WINDOW
    assert "19:30" in outcome.detail and "Europe/London" in outcome.detail
    assert fake_client.state.requests == []
    # A hold leaves the case where a retry can find it.
    assert state_of(live, IVY_CASE) == PatternState.PF_CASCADE_READY.value


def test_a_non_school_day_is_a_hold(live, fake_client):
    live.scan_register()
    outcome = live.place_call(IVY_CASE, confirmed=True, now=NON_SCHOOL_DAY)
    assert outcome.reason is NoCallReason.NON_SCHOOL_DAY
    assert fake_client.state.requests == []


def test_a_call_in_flight_blocks_a_second_dial(live, fake_client):
    live.scan_register()
    assert live.place_call(IVY_CASE, confirmed=True, now=SCHOOL_DAY_IN_WINDOW).placed
    second = live.place_call(IVY_CASE, confirmed=True, now=SCHOOL_DAY_IN_WINDOW)
    assert not second.placed
    assert len(fake_client.state.requests) == 1


def test_an_invalid_number_is_never_dialled(live, fake_client):
    """C-2131 has a non-E.164 number and is rejected at import, so it can never
    reach a transport at all."""
    live.start_contact_check()
    assert all(r.destination != "07700900182" for r in fake_client.state.requests)
    assert live.store.case("CC-2026-autumn-C-2131") is None


def test_an_unsupported_language_never_dials_and_raises_a_task(live, fake_client):
    live.start_contact_check()
    case_id = "CC-2026-autumn-C-2120"  # Annika Lindqvist, Swedish
    assert state_of(live, case_id) == ContactCheckState.CC_NOT_CALLED.value
    assert health_of(live, "C-2120") == ContactHealth.LANGUAGE_UNSUPPORTED.value
    assert any(t["kind"] == "language" for t in live.store.tasks())
    assert all(r.destination != "+447700900171" for r in fake_client.state.requests)


def test_the_key_is_reserved_before_the_transport_is_called(live, fake_client, monkeypatch):
    """A record that only exists after success is not a record."""
    live.scan_register()
    seen: list[bool] = []
    original = fake_client.create

    def spy(request):
        seen.append(live.store.key_reserved(request.idempotency_key))
        return original(request)

    monkeypatch.setattr(fake_client, "create", spy)
    live.place_call(IVY_CASE, confirmed=True, now=SCHOOL_DAY_IN_WINDOW)
    assert seen == [True]


# ---------------------------------------------------------------- the loop


def test_a_wrong_number_flags_the_contact_and_advances_the_cascade(live, fake_state):
    """The B -> A half of the loop: found during a real absence call, flagged at
    once rather than waiting for next term."""
    live.scan_register()
    request, *_ = live.build_request(IVY_CASE)
    fake_state.queue(request.idempotency_key, "wrong_person")

    outcome = live.place_call(IVY_CASE, confirmed=True, now=SCHOOL_DAY_IN_WINDOW)
    live.reconcile(outcome.attempt_id)

    assert health_of(live, "C-2089") == ContactHealth.WRONG_PERSON.value
    case = live.store.case(IVY_CASE)
    assert case["state"] == PatternState.PF_CASCADE_READY.value
    assert case["contact_id"] == "C-2090"  # Martin Dunn, the next in order


def test_a_dead_number_also_flags_and_advances(live, fake_state):
    live.scan_register()
    request, *_ = live.build_request(IVY_CASE)
    fake_state.queue(request.idempotency_key, "not_in_service")
    outcome = live.place_call(IVY_CASE, confirmed=True, now=SCHOOL_DAY_IN_WINDOW)
    live.reconcile(outcome.attempt_id)
    assert health_of(live, "C-2089") == ContactHealth.NUMBER_NOT_WORKING.value
    assert live.store.case(IVY_CASE)["contact_id"] == "C-2090"


def test_the_cascade_stops_at_the_first_confirmed_contact(live, fake_state):
    live.scan_register()
    first, *_ = live.build_request(IVY_CASE)
    fake_state.queue(first.idempotency_key, "wrong_person")
    outcome = live.place_call(IVY_CASE, confirmed=True, now=SCHOOL_DAY_IN_WINDOW)
    live.reconcile(outcome.attempt_id)

    second, *_ = live.build_request(IVY_CASE)
    fake_state.queue(second.idempotency_key, "pattern_support")
    outcome = live.place_call(IVY_CASE, confirmed=True, now=SCHOOL_DAY_IN_WINDOW)
    live.reconcile(outcome.attempt_id)

    assert state_of(live, IVY_CASE) == PatternState.PF_SUPPORT_REQUESTED.value
    # Janet Okoro, contact 3, was never dialled.
    assert live.store.attempts_for_contact(IVY_CASE, "C-2088") == 0


def test_support_requested_raises_a_task_with_the_barrier(live, fake_state):
    live.scan_register()
    request, *_ = live.build_request(IVY_CASE)
    fake_state.queue(request.idempotency_key, "pattern_support")
    outcome = live.place_call(IVY_CASE, confirmed=True, now=SCHOOL_DAY_IN_WINDOW)
    live.reconcile(outcome.attempt_id)

    support = [t for t in live.store.tasks() if t["kind"] == "support"]
    assert len(support) == 1
    assert "bus fare" in support[0]["detail"].lower()


# ------------------------------------------------------------ escalation


def test_did_not_know_goes_to_urgent_human_with_an_urgent_task(live, fake_state):
    live.scan_register()
    request, *_ = live.build_request(IVY_CASE)
    fake_state.queue(request.idempotency_key, "urgent_did_not_know")
    outcome = live.place_call(IVY_CASE, confirmed=True, now=SCHOOL_DAY_IN_WINDOW)
    live.reconcile(outcome.attempt_id)

    assert state_of(live, IVY_CASE) == PatternState.PF_URGENT_HUMAN.value
    urgent = [t for t in live.store.tasks() if t["urgent"]]
    assert any(t["kind"] == "safeguarding" for t in urgent)
    detail = next(t["detail"] for t in urgent if t["kind"] == "safeguarding")
    assert "Call the family back now" in detail
    assert "left for school this morning" in detail


def test_an_escalation_stops_the_cascade(live, fake_state):
    live.scan_register()
    request, *_ = live.build_request(IVY_CASE)
    fake_state.queue(request.idempotency_key, "urgent_did_not_know")
    outcome = live.place_call(IVY_CASE, confirmed=True, now=SCHOOL_DAY_IN_WINDOW)
    live.reconcile(outcome.attempt_id)
    assert live.store.attempts_for_contact(IVY_CASE, "C-2090") == 0


def test_reachable_never_concludes_a_child_is_safe(live, fake_state):
    """No state, event reason or task detail may say it."""
    live.scan_register()
    request, *_ = live.build_request(IVY_CASE)
    fake_state.queue(request.idempotency_key, "pattern_reason_only")
    outcome = live.place_call(IVY_CASE, confirmed=True, now=SCHOOL_DAY_IN_WINDOW)
    live.reconcile(outcome.attempt_id)

    text = " ".join(
        r["reason"] for r in live.store.rows("SELECT reason FROM events")
    ) + " ".join(t["detail"] for t in live.store.tasks())
    for forbidden in ["is safe", "accounted for", "all is well", "no concern"]:
        assert forbidden not in text.lower()


# ------------------------------------------------------------- binding


def test_identity_claimed_only_by_the_bot_never_verifies(live, fake_state):
    live.start_contact_check()
    case_id = "CC-2026-autumn-C-2088"
    request, *_ = live.build_request(case_id)
    fake_state.queue(request.idempotency_key, "identity_only_in_bot_turn")

    outcome = live.place_call(case_id, confirmed=True, now=SCHOOL_DAY_IN_WINDOW)
    live.reconcile(outcome.attempt_id)

    assert state_of(live, case_id) == ContactCheckState.CC_NEEDS_HUMAN.value
    assert health_of(live, "C-2088") != ContactHealth.VERIFIED.value


def test_a_clean_contact_check_verifies(live, fake_state):
    live.start_contact_check()
    case_id = "CC-2026-autumn-C-2088"
    request, *_ = live.build_request(case_id)
    fake_state.queue(request.idempotency_key, "clean_identity")

    outcome = live.place_call(case_id, confirmed=True, now=SCHOOL_DAY_IN_WINDOW)
    live.reconcile(outcome.attempt_id)

    assert state_of(live, case_id) == ContactCheckState.CC_VERIFIED.value
    assert health_of(live, "C-2088") == ContactHealth.VERIFIED.value


def test_a_low_confidence_result_needs_a_human(live, fake_state):
    live.start_contact_check()
    case_id = "CC-2026-autumn-C-2088"
    request, *_ = live.build_request(case_id)
    fake_state.queue(request.idempotency_key, "low_confidence")
    outcome = live.place_call(case_id, confirmed=True, now=SCHOOL_DAY_IN_WINDOW)
    live.reconcile(outcome.attempt_id)
    assert state_of(live, case_id) == ContactCheckState.CC_NEEDS_HUMAN.value


def test_an_update_request_raises_a_task_and_captures_no_number(live, fake_state):
    live.start_contact_check()
    case_id = "CC-2026-autumn-C-2088"
    request, *_ = live.build_request(case_id)
    fake_state.queue(request.idempotency_key, "clean_identity")

    # Mutate the scripted result to ask for an update.
    from fake_calle.scripts import SCRIPTS

    original = SCRIPTS["clean_identity"]

    def wants_update(destination, metadata):
        snapshot = original(destination, metadata)
        snapshot["structured_result"]["best_number_for_school"] = "wants_to_update"
        return snapshot

    SCRIPTS["clean_identity"] = wants_update
    try:
        outcome = live.place_call(case_id, confirmed=True, now=SCHOOL_DAY_IN_WINDOW)
        live.reconcile(outcome.attempt_id)
    finally:
        SCRIPTS["clean_identity"] = original

    assert state_of(live, case_id) == ContactCheckState.CC_UPDATE_REQUESTED.value
    task = next(t for t in live.store.tasks() if t["kind"] == "contact_update")
    assert "no number was captured" in task["detail"]


# ------------------------------------------------------- unknown outcomes


def test_a_timeout_is_reconciled_not_redialled(live, fake_state, fake_client):
    live.scan_register()
    fake_state.fail_submission = "unknown"
    outcome = live.place_call(IVY_CASE, confirmed=True, now=SCHOOL_DAY_IN_WINDOW)

    assert not outcome.placed
    assert state_of(live, IVY_CASE) == PatternState.PF_CALL_UNVERIFIED.value

    # And the in-flight guard blocks the case until a person resolves it.
    fake_state.fail_submission = None
    blocked = live.place_call(IVY_CASE, confirmed=True, now=SCHOOL_DAY_IN_WINDOW)
    assert not blocked.placed
    assert blocked.reason is NoCallReason.CALL_IN_PROGRESS
    assert fake_client.state.requests == []


def test_a_non_terminal_read_is_not_ready_not_a_failure(live, fake_state):
    live.start_contact_check()
    case_id = "CC-2026-autumn-C-2088"
    request, *_ = live.build_request(case_id)
    fake_state.queue(request.idempotency_key, "timeout_then_complete")

    outcome = live.place_call(case_id, confirmed=True, now=SCHOOL_DAY_IN_WINDOW)
    first = live.reconcile(outcome.attempt_id)
    assert first.disposition.value == "outcome_unknown"
    assert state_of(live, case_id) == ContactCheckState.CC_IN_FLIGHT.value

    second = live.reconcile(outcome.attempt_id)
    assert second.disposition.value == "confirmed"
    assert state_of(live, case_id) == ContactCheckState.CC_VERIFIED.value


def test_restart_resumes_from_sqlite_without_redialling(live, fake_state, fake_client):
    live.start_contact_check()
    case_id = "CC-2026-autumn-C-2088"
    request, *_ = live.build_request(case_id)
    fake_state.queue(request.idempotency_key, "timeout_then_complete")
    live.place_call(case_id, confirmed=True, now=SCHOOL_DAY_IN_WINDOW)
    submitted = len(fake_client.state.requests)

    # A fresh orchestrator over the same store, as after a process restart.
    resumed = Orchestrator(
        store=live.store, config=live.config, client=fake_client, dataset=live.dataset
    )
    resumed.resume()
    resumed.resume()

    assert len(fake_client.state.requests) == submitted  # nothing redialled
    assert state_of(resumed, case_id) == ContactCheckState.CC_VERIFIED.value


def test_reusing_an_authorised_intent_returns_the_same_call(live, fake_client):
    """One authorised intent produces at most one call."""
    live.scan_register()
    request, *_ = live.build_request(IVY_CASE)
    first = fake_client.create(request)
    second = fake_client.create(request)
    assert first.call_id == second.call_id


# -------------------------------------------------------------- sanitising


def test_stored_results_are_sanitised_at_the_ingestion_boundary(live, fake_state):
    live.start_contact_check()
    case_id = "CC-2026-autumn-C-2088"
    request, *_ = live.build_request(case_id)

    from fake_calle.scripts import SCRIPTS

    original = SCRIPTS["clean_identity"]

    def hostile(destination, metadata):
        snapshot = original(destination, metadata)
        snapshot["structured_result"]["verbatim_identity_quote"] = "Yes\x00\x07 spea‮king"
        return snapshot

    SCRIPTS["clean_identity"] = hostile
    fake_state.queue(request.idempotency_key, "clean_identity")
    try:
        outcome = live.place_call(case_id, confirmed=True, now=SCHOOL_DAY_IN_WINDOW)
        live.reconcile(outcome.attempt_id)
    finally:
        SCRIPTS["clean_identity"] = original

    stored = live.store.attempt(outcome.attempt_id)["structured_result"]
    assert "\x00" not in stored
    assert "‮" not in stored


def test_audit_events_name_fields_not_values(live, fake_state):
    live.scan_register()
    request, *_ = live.build_request(IVY_CASE)
    fake_state.queue(request.idempotency_key, "pattern_support")
    outcome = live.place_call(IVY_CASE, confirmed=True, now=SCHOOL_DAY_IN_WINDOW)
    live.reconcile(outcome.attempt_id)

    fields = " ".join(r["fields"] for r in live.store.rows("SELECT fields FROM events"))
    assert "barrier_note" in fields
    assert "bus fare" not in fields.lower()


def test_full_numbers_never_appear_in_events_or_tasks(live, fake_state):
    live.scan_register()
    request, *_ = live.build_request(IVY_CASE)
    fake_state.queue(request.idempotency_key, "urgent_did_not_know")
    outcome = live.place_call(IVY_CASE, confirmed=True, now=SCHOOL_DAY_IN_WINDOW)
    live.reconcile(outcome.attempt_id)

    text = " ".join(r["reason"] for r in live.store.rows("SELECT reason FROM events"))
    text += " ".join(t["detail"] for t in live.store.tasks())
    for contact in live.dataset.contacts:
        assert contact.phone_e164 not in text


def test_reading_back_a_non_terminal_call_leaves_the_attempt_in_flight(live, fake_client):
    """Found on a live call: an early read-back must not retire guard 6.

    The provider left that call queued for a minute. Reconciling in that window
    used to move the attempt to TERMINAL_UNVERIFIED, which is not one of
    IN_FLIGHT_ATTEMPTS -- so the attempt-level "never two calls for one case"
    guard silently stopped applying while the telephone was still ringing. The
    case state refused the second dial, but that is one defence where the design
    calls for two.
    """
    live.scan_register()
    fake_client.state.default_script = "timeout_then_complete"
    outcome = live.place_call(IVY_CASE, confirmed=True, now=SCHOOL_DAY_IN_WINDOW)
    assert outcome.placed
    attempt_id = outcome.attempt_id

    classification = live.reconcile(attempt_id)
    assert classification.disposition is Disposition.OUTCOME_UNKNOWN

    row = live.store.attempt(attempt_id)
    assert AttemptState(row["state"]) in IN_FLIGHT_ATTEMPTS
    # The reason is still recorded, so the office can see why it is waiting.
    assert row["disposition"] == Disposition.OUTCOME_UNKNOWN.value
    # And the guard still sees it.
    assert live.store.in_flight_for(IVY_CASE) != []

    # The next read finds it terminal and the attempt leaves the in-flight set.
    live.reconcile(attempt_id)
    assert AttemptState(live.store.attempt(attempt_id)["state"]) not in IN_FLIGHT_ATTEMPTS
