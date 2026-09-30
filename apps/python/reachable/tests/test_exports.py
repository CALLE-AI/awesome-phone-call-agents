"""Exports: sanitised, masked, and suggestions only."""

from __future__ import annotations

import csv
import io

from reachable import exports
from reachable.models import ContactHealth

from .conftest import SCHOOL_DAY_IN_WINDOW

IVY_CASE = "PF-P-1041-2026-09-11"


def rows(text: str) -> list[dict[str, str]]:
    return list(csv.DictReader(io.StringIO(text)))


def test_suggested_changes_lists_flagged_contacts_only(live, fake_state):
    live.scan_register()
    request, *_ = live.build_request(IVY_CASE)
    fake_state.queue(request.idempotency_key, "wrong_person")
    outcome = live.place_call(IVY_CASE, confirmed=True, now=SCHOOL_DAY_IN_WINDOW)
    live.reconcile(outcome.attempt_id)

    data = rows(exports.suggested_contact_changes(live.store, live.dataset))
    flagged = {r["contact_id"] for r in data}
    assert "C-2089" in flagged          # the wrong number
    assert "C-2088" not in flagged      # never checked, so nothing to suggest


def test_no_export_ever_contains_a_full_phone_number(live, fake_state):
    live.scan_register()
    live.start_contact_check()
    request, *_ = live.build_request(IVY_CASE)
    fake_state.queue(request.idempotency_key, "wrong_person")
    outcome = live.place_call(IVY_CASE, confirmed=True, now=SCHOOL_DAY_IN_WINDOW)
    live.reconcile(outcome.attempt_id)

    everything = "\n".join(
        [
            exports.suggested_contact_changes(live.store, live.dataset),
            exports.suggested_register_reasons(live.store, live.dataset),
            exports.contact_health_report(live.store, live.dataset),
        ]
    )
    for contact in live.dataset.contacts:
        assert contact.phone_e164 not in everything
    assert "…377" in everything  # masked form is present


def test_exports_neutralise_spreadsheet_formulas(live):
    """A school office opens these in Excel."""
    live.start_contact_check()
    live.store.set_contact_health(
        "C-2088",
        pupil_id="P-1041",
        status=ContactHealth.WRONG_PERSON.value,
        reason="=cmd|'/c calc'!A1",
        source="test",
    )
    text = exports.suggested_contact_changes(live.store, live.dataset)
    assert "'=cmd" in text
    assert "\n=cmd" not in text


def test_suggested_reasons_are_marked_unapproved_until_staff_act(live, fake_state):
    live.scan_register()
    request, *_ = live.build_request(IVY_CASE)
    fake_state.queue(request.idempotency_key, "pattern_reason_only")
    outcome = live.place_call(IVY_CASE, confirmed=True, now=SCHOOL_DAY_IN_WINDOW)
    live.reconcile(outcome.attempt_id)

    before = rows(exports.suggested_register_reasons(live.store, live.dataset))
    assert before and before[0]["approved_by_staff"] == "no"
    assert before[0]["suggested_reason_category"] == "illness"
    assert before[0]["code_n_deadline"]  # the 5-school-day date is shown

    live.approve_suggested_reason(IVY_CASE, actor="office")
    after = rows(exports.suggested_register_reasons(live.store, live.dataset))
    assert after[0]["approved_by_staff"] == "yes"


def test_approving_a_reason_records_that_reachable_wrote_nothing(live, fake_state):
    live.scan_register()
    request, *_ = live.build_request(IVY_CASE)
    fake_state.queue(request.idempotency_key, "pattern_reason_only")
    outcome = live.place_call(IVY_CASE, confirmed=True, now=SCHOOL_DAY_IN_WINDOW)
    live.reconcile(outcome.attempt_id)
    live.approve_suggested_reason(IVY_CASE, actor="office")

    reasons = [e["reason"] for e in live.store.events_for(IVY_CASE)]
    assert any("does not write to the register" in r for r in reasons)


def test_reachability_summarises_per_pupil(live, fake_state):
    live.start_contact_check()
    case_id = "CC-2026-autumn-C-2088"
    request, *_ = live.build_request(case_id)
    fake_state.queue(request.idempotency_key, "clean_identity")
    outcome = live.place_call(case_id, confirmed=True, now=SCHOOL_DAY_IN_WINDOW)
    live.reconcile(outcome.attempt_id)

    ivy = next(r for r in exports.reachability(live.store, live.dataset) if r.pupil_id == "P-1041")
    assert ivy.total == 3
    assert ivy.verified == 1
    assert ivy.summary == "1 of 3 contacts verified"
    assert not ivy.at_risk


def test_a_pupil_with_no_verified_contact_is_surfaced(live):
    live.start_contact_check()
    at_risk = [r for r in exports.reachability(live.store, live.dataset) if r.at_risk]
    assert at_risk  # nothing verified yet, so every pupil is at risk
    assert exports.counters(live.store, live.dataset)["pupils_with_no_verified_contact"] > 0


def test_counters_are_honest_counts_of_what_happened(live, fake_state):
    live.scan_register()
    request, *_ = live.build_request(IVY_CASE)
    fake_state.queue(request.idempotency_key, "urgent_did_not_know")
    outcome = live.place_call(IVY_CASE, confirmed=True, now=SCHOOL_DAY_IN_WINDOW)
    live.reconcile(outcome.attempt_id)

    counts = exports.counters(live.store, live.dataset)
    assert counts["calls_placed"] == 1
    # An escalation that came out of a call, counted apart from the vulnerable
    # pupil who was never called at all. Adding them would overstate alarms.
    assert counts["escalations_from_calls"] == 1
    assert counts["vulnerable_pupils_not_called"] == 1
    assert counts["decisions_not_to_call"] >= 1
    # Nothing resembling a claim about outcomes for children.
    assert not any("saved" in k for k in counts)


def test_contact_health_report_covers_every_pupil(live):
    live.start_contact_check()
    data = rows(exports.contact_health_report(live.store, live.dataset))
    assert len(data) == len(live.dataset.pupils)
    assert all(r["reachability"].endswith("contacts verified") for r in data)
