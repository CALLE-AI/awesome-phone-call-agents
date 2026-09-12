from datetime import datetime, timedelta, timezone
from pathlib import Path

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

from models.appointment import Appointment, AppointmentStatus


BASE_DIR = Path(__file__).resolve().parent.parent

CREDENTIALS_FILE = BASE_DIR / "credentials.json"
TOKEN_FILE = BASE_DIR / "token.json"

SCOPES = [
    "https://www.googleapis.com/auth/calendar.events"
]


def get_calendar_service():
    creds = None

    if TOKEN_FILE.exists():
        creds = Credentials.from_authorized_user_file(
            TOKEN_FILE,
            SCOPES,
        )

    if not creds or not creds.valid:

        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())

        else:
            flow = InstalledAppFlow.from_client_secrets_file(
                CREDENTIALS_FILE,
                SCOPES,
            )

            creds = flow.run_local_server(port=0)

        TOKEN_FILE.write_text(creds.to_json())

    return build(
        "calendar",
        "v3",
        credentials=creds,
    )


def get_upcoming_events(hours=48):
    service = get_calendar_service()

    now = datetime.now(timezone.utc)
    end = now + timedelta(hours=hours)

    response = (
        service.events()
        .list(
            calendarId="primary",
            timeMin=now.isoformat(),
            timeMax=end.isoformat(),
            singleEvents=True,
            orderBy="startTime",
        )
        .execute()
    )

    return response.get("items", [])


def parse_event_metadata(description):
    metadata = {}

    if not description:
        return metadata

    for line in description.splitlines():

        if "=" not in line:
            continue

        key, value = line.split("=", 1)

        metadata[key.strip().upper()] = value.strip()

    return metadata


def event_to_appointment(event):
    description = event.get("description", "")

    metadata = parse_event_metadata(description)

    if metadata.get("CONFIRMCALL", "").lower() != "true":
        return None

    start_data = event.get("start", {})

    start_raw = start_data.get("dateTime")

    if not start_raw:
        return None

    start_time = datetime.fromisoformat(
        start_raw.replace("Z", "+00:00")
    )

    status_text = metadata.get(
        "STATUS",
        "pending",
    ).lower()

    try:
        status = AppointmentStatus(status_text)

    except ValueError:
        status = AppointmentStatus.NEEDS_HUMAN

    return Appointment(
        event_id=event["id"],
        customer_name=metadata.get(
            "CUSTOMER_NAME",
            "Unknown Customer",
        ),
        customer_phone=metadata.get(
            "CUSTOMER_PHONE",
            "",
        ),
        service_name=metadata.get(
            "SERVICE",
            event.get("summary", "Appointment"),
    ),
    start_time=start_time,
    status=status,
    requested_time=metadata.get(
        "REQUESTED_TIME"
    ),
    call_id=metadata.get(
        "CALL_ID"
    ),
)

def get_confirmcall_appointments(hours=48):
    events = get_upcoming_events(hours)

    appointments = []

    for event in events:

        appointment = event_to_appointment(event)

        if appointment:
            appointments.append(appointment)

    return appointments

STATUS_PREFIXES = {
    AppointmentStatus.PENDING: "⏳",
    AppointmentStatus.CONFIRMED: "✅",
    AppointmentStatus.CANCELLED: "❌",
    AppointmentStatus.RESCHEDULE_REQUESTED: "🟡",
    AppointmentStatus.NO_ANSWER: "⚪",
    AppointmentStatus.NEEDS_HUMAN: "🔴",
}


def update_calendar_event(appointment: Appointment):
    service = get_calendar_service()

    event = (
        service.events()
        .get(
            calendarId="primary",
            eventId=appointment.event_id,
        )
        .execute()
    )

    prefix = STATUS_PREFIXES.get(
        appointment.status,
        "🔴",
    )

    original_summary = event.get(
        "summary",
        appointment.service_name,
    )

    # Remove an old ConfirmCall status prefix if one exists.
    for existing_prefix in STATUS_PREFIXES.values():
        if original_summary.startswith(f"{existing_prefix} "):
            original_summary = original_summary[len(existing_prefix) + 1:]
            break

    event["summary"] = f"{prefix} {original_summary}"

    metadata_lines = [
        "CONFIRMCALL=true",
        f"CUSTOMER_NAME={appointment.customer_name}",
        f"CUSTOMER_PHONE={appointment.customer_phone}",
        f"SERVICE={appointment.service_name}",
        f"STATUS={appointment.status.value}",
    ]

    if appointment.requested_time:
        metadata_lines.append(
            f"REQUESTED_TIME={appointment.requested_time}"
        )

    if appointment.call_id:
        metadata_lines.append(
            f"CALL_ID={appointment.call_id}"
        )

    event["description"] = "\n".join(metadata_lines)

    updated_event = (
        service.events()
        .update(
            calendarId="primary",
            eventId=appointment.event_id,
            body=event,
        )
        .execute()
    )

    return updated_event

DEMO_CUSTOMERS = {
    "Alice Demo",
    "Brian Demo",
    "Clara Demo",
}


def reset_demo_appointments(hours=48):
    service = get_calendar_service()

    appointments = get_confirmcall_appointments(
        hours=hours
    )

    reset_count = 0

    for appointment in appointments:

        if appointment.customer_name not in DEMO_CUSTOMERS:
            continue

        event = (
            service.events()
            .get(
                calendarId="primary",
                eventId=appointment.event_id,
            )
            .execute()
        )

        summary = event.get(
            "summary",
            appointment.service_name,
        )

        # Remove ConfirmCall status emoji.
        for prefix in STATUS_PREFIXES.values():
            if summary.startswith(f"{prefix} "):
                summary = summary[len(prefix) + 1:]
                break

        event["summary"] = summary

        event["description"] = "\n".join(
            [
                "CONFIRMCALL=true",
                f"CUSTOMER_NAME={appointment.customer_name}",
                f"CUSTOMER_PHONE={appointment.customer_phone}",
                f"SERVICE={appointment.service_name}",
                "STATUS=pending",
            ]
        )

        (
            service.events()
            .update(
                calendarId="primary",
                eventId=appointment.event_id,
                body=event,
            )
            .execute()
        )

        reset_count += 1

    return reset_count