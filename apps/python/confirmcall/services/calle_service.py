import os

from zoneinfo import ZoneInfo

from calle import CalleClient
from dotenv import load_dotenv

from models.appointment import Appointment
from services.decision_service import CallResult


load_dotenv()


BUSINESS_TIMEZONE = ZoneInfo(
    os.getenv("BUSINESS_TIMEZONE", "Africa/Lagos")
)

RESULT_SCHEMA = {
    "type": "object",
    "required": [
        "outcome",
        "requested_time",
        "customer_notes",
    ],
    "properties": {
        "outcome": {
            "type": "string",
            "enum": [
                "confirmed",
                "cancelled",
                "reschedule_requested",
                "no_answer",
                "unknown",
            ],
        },
        "requested_time": {
            "type": "string",
        },
        "customer_notes": {
            "type": "string",
        },
    },
}


def build_call_task(appointment: Appointment) -> str:
    local_start_time = appointment.start_time.astimezone(
        BUSINESS_TIMEZONE
    )

    appointment_time = local_start_time.strftime(
        "%A, %B %d at %I:%M %p"
    )

    return (
        "You are ConfirmCall, an appointment confirmation assistant. "
        f"Speak with {appointment.customer_name} about their "
        f"{appointment.service_name} appointment scheduled for "
        f"{appointment_time}. "
        "Politely ask whether they will attend. "
        "If they cannot attend, ask whether they want to cancel "
        "or request another time. "
        "Do not promise that a requested new time is confirmed. "
        "A reschedule request will be reviewed by the business. "
        "Classify the final outcome as exactly one of: "
        "confirmed, cancelled, reschedule_requested, "
        "no_answer, or unknown. "
        "If they request another time, record it in requested_time. "
        "Otherwise return an empty string for requested_time. "
        "Put any useful short summary in customer_notes."
    )


def make_confirmation_call(
    appointment: Appointment,
) -> CallResult:

    api_key = os.getenv("CALLE_API_KEY")

    if not api_key:
        raise RuntimeError(
            "CALLE_API_KEY is missing from .env"
        )

    if not appointment.customer_phone:
        raise ValueError(
            "Appointment does not have a customer phone number."
        )

    client = CalleClient(
        api_key=api_key,
        base_url="https://api.heycall-e.com",
    )

    recipient = {
        "phone": appointment.customer_phone,
    }

    # Optional values for supported CALL-E regions.
    region = os.getenv("CALLE_REGION")
    locale = os.getenv("CALLE_LOCALE")

    if region:
        recipient["region"] = region

    if locale:
        recipient["locale"] = locale

    call = client.calls.create_and_wait(
        task=build_call_task(appointment),
        recipient=recipient,
        recipient_result_schema=RESULT_SCHEMA,
        metadata={
            "source": "confirmcall",
            "event_id": appointment.event_id,
        },
        idempotency_key=(
            f"confirmcall:"
            f"{appointment.event_id}:"
            f"{appointment.start_time.isoformat()}"
        ),
        timeout_seconds=600,
    )

    call_id = call.get("id")

    status = str(
        call.get("status", "")
    ).lower()

    if status != "completed":
        return CallResult(
            outcome="unknown",
            customer_notes=(
                f"CALL-E ended with status: {status or 'unknown'}"
            ),
            call_id=call_id,
        )

    structured_result = {}

    recipients = call.get("recipients") or []

    if recipients:
        structured_result = (
            recipients[0].get("structured_result")
            or {}
        )

    # Defensive fallback.
    if not structured_result:
        structured_result = (
            call.get("structured_result")
            or {}
        )

    outcome = (
        structured_result.get(
            "outcome",
            "unknown",
        )
        or "unknown"
    )

    requested_time = (
        structured_result.get(
            "requested_time"
        )
        or None
    )

    customer_notes = (
        structured_result.get(
            "customer_notes"
        )
        or None
    )

    return CallResult(
        outcome=outcome,
        requested_time=requested_time,
        customer_notes=customer_notes,
        call_id=call_id,
    )