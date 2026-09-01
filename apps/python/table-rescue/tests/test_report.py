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
