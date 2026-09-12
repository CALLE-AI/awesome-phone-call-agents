from zoneinfo import ZoneInfo

from models.appointment import AppointmentStatus

from services.calendar_service import (
    get_confirmcall_appointments,
    update_calendar_event,
)

from services.calle_service import make_confirmation_call

from services.decision_service import (
    CallResult,
    apply_call_result,
)


DRY_RUN = True

DISPLAY_TIMEZONE = ZoneInfo("Africa/Lagos")


DEMO_RESULTS = {
    "Alice Demo": CallResult(
        outcome="confirmed",
        customer_notes="Customer confirmed attendance.",
        call_id="demo-call-alice",
    ),

    "Brian Demo": CallResult(
        outcome="cancelled",
        customer_notes="Customer requested cancellation.",
        call_id="demo-call-brian",
    ),

    "Clara Demo": CallResult(
        outcome="reschedule_requested",
        requested_time="Monday at 2:00 PM",
        customer_notes="Customer requested a new appointment time.",
        call_id="demo-call-clara",
    ),
}


def get_demo_result(appointment):
    result = DEMO_RESULTS.get(appointment.customer_name)

    if result:
        return result

    return CallResult(
        outcome="unknown",
        customer_notes="No demo response configured.",
        call_id="demo-call-unknown",
    )


def process_appointment(appointment):
    local_time = appointment.start_time.astimezone(
        DISPLAY_TIMEZONE
    )

    print()
    print("=" * 60)
    print(f"Customer: {appointment.customer_name}")
    print(f"Service: {appointment.service_name}")
    print(
        f"Time: "
        f"{local_time.strftime('%A, %B %d at %I:%M %p')}"
    )
    print(f"Status: {appointment.status.value}")

    if appointment.status != AppointmentStatus.PENDING:
        print(
            "Skipping: appointment already processed."
        )
        return {
            "success": True,
            "skipped": True,
            "status": appointment.status.value,
        }

    try:

        if DRY_RUN:
            print(
                "DRY RUN: simulating CALL-E conversation."
            )

            result = get_demo_result(
                appointment
            )

        else:
            print(
                "Starting CALL-E call..."
            )

            result = make_confirmation_call(
                appointment
            )

        print(
            f"Call outcome: {result.outcome}"
        )

        if result.requested_time:
            print(
                f"Requested time: "
                f"{result.requested_time}"
            )

        updated = apply_call_result(
            appointment,
            result,
        )

        update_calendar_event(
            updated
        )

        print(
            f"Calendar updated: "
            f"{updated.status.value}"
        )

        return {
            "success": True,
            "skipped": False,
            "status": updated.status.value,
            "call_id": updated.call_id,
        }

    except Exception as exc:

        print(
            f"ERROR processing "
            f"{appointment.customer_name}: {exc}"
        )

        appointment.status = (
            AppointmentStatus.NEEDS_HUMAN
        )

        try:
            update_calendar_event(
                appointment
            )

            print(
                "Appointment marked for human review."
            )

        except Exception as calendar_exc:
            print(
                "WARNING: Could not update Calendar "
                f"after failure: {calendar_exc}"
            )

        return {
            "success": False,
            "skipped": False,
            "status": (
                AppointmentStatus.NEEDS_HUMAN.value
            ),
            "error": str(exc),
        }

def main():
    print()
    print("CONFIRMCALL")
    print("AI Appointment Confirmation Agent")
    print("=" * 60)

    appointments = get_confirmcall_appointments(
        hours=48
    )

    print(
        f"Found {len(appointments)} "
        "ConfirmCall appointment(s)."
    )

    results = []

    for appointment in appointments:
        result = process_appointment(
            appointment
        )

        if result:
            results.append(result)

    successful = sum(
        1
        for result in results
        if result.get("success")
        and not result.get("skipped")
    )

    skipped = sum(
        1
        for result in results
        if result.get("skipped")
    )

    failed = sum(
        1
        for result in results
        if not result.get("success")
    )

    print()
    print("=" * 60)
    print("CONFIRMCALL RUN SUMMARY")
    print("=" * 60)

    print(
        f"Processed successfully: {successful}"
    )

    print(
        f"Skipped: {skipped}"
    )

    print(
        f"Needs human review: {failed}"
    )

    print()
    print("ConfirmCall run complete.")


if __name__ == "__main__":
    main()
    