"""Staff-facing run report with masked phone numbers."""
from .models import (
    CallOutcome,
    CallStatus,
    Reservation,
    ReservationStatus,
    WaitlistEntry,
    WaitlistStatus,
)
from .safety import mask_phone, sanitize_text

DIALLED_STATUSES = {
    CallStatus.CONFIRMED,
    CallStatus.CANCELLED,
    CallStatus.RESCHEDULED,
    CallStatus.NO_ANSWER,
    CallStatus.ACCEPTED,
    CallStatus.DECLINED,
    CallStatus.ERROR,
    CallStatus.UNCERTAIN,
}


def render_report(
    run_id: str,
    outcomes: list[CallOutcome],
    reservations: list[Reservation],
    waitlist: list[WaitlistEntry],
    avg_check_per_guest: float | None = None,
    resumed_from: str | None = None,
) -> str:
    phones = {entry.booking_id: entry.phone for entry in reservations}
    phones.update({entry.entry_id: entry.phone for entry in waitlist})
    dialled = [outcome for outcome in outcomes if outcome.status in DIALLED_STATUSES]
    recovered = [r for r in reservations if r.status == ReservationStatus.RECOVERED]
    accepted = [w for w in waitlist if w.status == WaitlistStatus.ACCEPTED]
    needs_review_res = [
        r for r in reservations if r.status == ReservationStatus.NEEDS_REVIEW
    ]
    needs_review_wl = [w for w in waitlist if w.status == WaitlistStatus.NEEDS_REVIEW]
    lines = [
        f"# Table Rescue run {run_id}",
        *([f"- Resumed from run: {resumed_from}"] if resumed_from else []),
        "",
        f"- Calls placed: {len(dialled)}",
        f"- Slots recovered: {len(recovered)}",
        f"- Waitlist entries accepted: {len(accepted)}",
        f"- Needs review: {len(needs_review_res) + len(needs_review_wl)}",
        *(
            [
                f"- Estimated revenue protected: {sum(r.party_size for r in recovered) * avg_check_per_guest:.0f} "
                f"({sum(r.party_size for r in recovered)} recovered seats x {avg_check_per_guest:.0f} per guest)"
            ]
            if avg_check_per_guest is not None and recovered
            else []
        ),
        "",
        "| Target | Phone | Outcome | Notes |",
        "| --- | --- | --- | --- |",
    ]
    for outcome in outcomes:
        phone = mask_phone(phones.get(outcome.target_id, "+0000000000"))
        notes = sanitize_text(outcome.notes or "").replace("|", "/")
        lines.append(
            f"| {outcome.target_id} | {phone} | {outcome.status.value} | {notes} |"
        )
    if needs_review_res or needs_review_wl:
        lines += [
            "",
            "## Needs review",
            "",
            "These destinations stopped the run with an uncertain result. "
            "Review the notes/transcript, then run `table-rescue resume`.",
            "",
            "| Target | Reason | Notes |",
            "| --- | --- | --- |",
        ]
        last_outcome = {o.target_id: o for o in outcomes}
        for target_id in [
            *[r.booking_id for r in needs_review_res],
            *[w.entry_id for w in needs_review_wl],
        ]:
            outcome = last_outcome.get(target_id)
            reason = (
                (outcome.uncertainty_reason or outcome.status.value)
                if outcome
                else "NEEDS_REVIEW"
            )
            notes = (
                sanitize_text(outcome.notes or "").replace("|", "/") if outcome else ""
            )
            lines.append(f"| {target_id} | {reason} | {notes} |")
    return "\n".join(lines) + "\n"
