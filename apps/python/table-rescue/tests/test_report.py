from table_rescue.models import (
    CallOutcome,
    CallStatus,
    Reservation,
    ReservationStatus,
    WaitlistEntry,
    WaitlistStatus,
)
from table_rescue.report import render_report


def test_render_report_masks_phones_and_counts():
    reservation = Reservation(
        booking_id="R-001",
        name="Fictional Guest",
        phone="+15550101",
        party_size=4,
        slot="2026-09-10T19:00:00+07:00",
        consent=True,
        status=ReservationStatus.RECOVERED,
    )
    entry = WaitlistEntry(
        entry_id="W-001",
        name="Fictional Waitlist",
        phone="+15550111",
        party_size=4,
        window_start="2026-09-10T18:00:00+07:00",
        window_end="2026-09-10T21:00:00+07:00",
        priority=1,
        consent=True,
        status=WaitlistStatus.ACCEPTED,
    )
    outcomes = [
        CallOutcome(run_id="run-1", target_id="R-001", status=CallStatus.CANCELLED,
                    notes="cannot make it"),
        CallOutcome(run_id="run-1", target_id="W-001", status=CallStatus.ACCEPTED,
                    notes="we will come"),
    ]
    report = render_report("run-1", outcomes, [reservation], [entry])
    assert "Slots recovered: 1" in report
    assert "Waitlist entries accepted: 1" in report
    assert "+15550101" not in report
    assert "+******01" in report


def test_render_report_estimates_protected_revenue():
    reservation = Reservation(
        booking_id="R-001",
        name="Fictional Guest",
        phone="+15550101",
        party_size=4,
        slot="2026-09-10T19:00:00+07:00",
        consent=True,
        status=ReservationStatus.RECOVERED,
    )
    report = render_report(
        "run-1", [], [reservation], [], avg_check_per_guest=25.0
    )
    assert (
        "Estimated revenue protected: 100 (4 recovered seats x 25 per guest)" in report
    )
    plain = render_report("run-1", [], [reservation], [])
    assert "Estimated revenue protected" not in plain


def test_report_notes_never_contain_raw_phones():
    reservation = Reservation(
        booking_id="R-001", name="Guest", phone="+15550101", party_size=2,
        slot="2026-09-10T19:00:00+07:00", consent=True,
        status=ReservationStatus.NEEDS_REVIEW,
    )
    outcomes = [
        CallOutcome(
            run_id="run-1", target_id="R-001", status=CallStatus.UNCERTAIN,
            notes="callback +14155550100 after 6pm",
            uncertainty_reason="UNPARSEABLE_SUMMARY",
        )
    ]
    report = render_report("run-1", outcomes, [reservation], [])
    assert "+14155550100" not in report
    assert "callback" in report


def test_report_needs_review_section_and_resumed_from():
    reservation = Reservation(
        booking_id="R-001", name="Guest", phone="+15550101", party_size=2,
        slot="2026-09-10T19:00:00+07:00", consent=True,
        status=ReservationStatus.NEEDS_REVIEW,
    )
    outcomes = [
        CallOutcome(
            run_id="run-2", target_id="R-001", status=CallStatus.UNCERTAIN,
            notes="guest mumbled [hint: confirm]",
            uncertainty_reason="UNPARSEABLE_SUMMARY",
        )
    ]
    report = render_report(
        "run-2", outcomes, [reservation], [], resumed_from="run-1"
    )
    assert "Resumed from run: run-1" in report
    assert "Needs review" in report
    assert "R-001" in report
    assert "UNPARSEABLE_SUMMARY" in report
    assert "hint: confirm" in report
