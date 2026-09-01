"""Staff-facing run report with masked phone numbers."""
from .models import (
    CallOutcome,
    CallStatus,
    Reservation,
    ReservationStatus,
    WaitlistEntry,
    WaitlistStatus,
)
from .stores import mask_phone

DIALLED_STATUSES = {
    CallStatus.CONFIRMED,
    CallStatus.CANCELLED,
    CallStatus.RESCHEDULED,
    CallStatus.NO_ANSWER,
    CallStatus.ACCEPTED,
    CallStatus.DECLINED,
    CallStatus.ERROR,
}


def render_report(
    run_id: str,
    outcomes: list[CallOutcome],
    reservations: list[Reservation],
    waitlist: list[WaitlistEntry],
) -> str:
    phones = {entry.booking_id: entry.phone for entry in reservations}
    phones.update({entry.entry_id: entry.phone for entry in waitlist})
    dialled = [outcome for outcome in outcomes if outcome.status in DIALLED_STATUSES]
    recovered = [r for r in reservations if r.status == ReservationStatus.RECOVERED]
    accepted = [w for w in waitlist if w.status == WaitlistStatus.ACCEPTED]
    escalated = [
        o for o in outcomes if o.status in {CallStatus.NO_ANSWER, CallStatus.ERROR}
    ]
    lines = [
        f"# Table Rescue run {run_id}",
        "",
        f"- Calls placed: {len(dialled)}",
        f"- Slots recovered: {len(recovered)}",
        f"- Waitlist entries accepted: {len(accepted)}",
        f"- Needs staff attention (no answer or error): {len(escalated)}",
        "",
        "| Target | Phone | Outcome | Notes |",
        "| --- | --- | --- | --- |",
    ]
    for outcome in outcomes:
        phone = mask_phone(phones.get(outcome.target_id, "+0000000000"))
        notes = (outcome.notes or "").replace("|", "/")
        lines.append(
            f"| {outcome.target_id} | {phone} | {outcome.status.value} | {notes} |"
        )
    return "\n".join(lines) + "\n"
