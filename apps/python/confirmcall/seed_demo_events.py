from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from services.calendar_service import get_calendar_service


TIMEZONE = ZoneInfo("Africa/Lagos")


def create_demo_event(
    service,
    customer,
    phone,
    start_time,
):
    calendar = get_calendar_service()

    event = {
        "summary": service,
        "description": (
            "CONFIRMCALL=true\n"
            f"CUSTOMER_NAME={customer}\n"
            f"CUSTOMER_PHONE={phone}\n"
            f"SERVICE={service}\n"
            "STATUS=pending"
        ),
        "start": {
            "dateTime": start_time.isoformat(),
            "timeZone": "Africa/Lagos",
        },
        "end": {
            "dateTime": (
                start_time + timedelta(hours=1)
            ).isoformat(),
            "timeZone": "Africa/Lagos",
        },
    }

    created = (
        calendar.events()
        .insert(
            calendarId="primary",
            body=event,
        )
        .execute()
    )

    print(
        f"Created: {service} "
        f"at {start_time.strftime('%Y-%m-%d %H:%M')}"
    )

    return created


def main():
    now = datetime.now(TIMEZONE)

    tomorrow = now + timedelta(days=1)

    appointments = [
        {
            "service": "Haircut Appointment",
            "customer": "Alice Demo",
            "phone": "+12025550123",
            "hour": 10,
        },
        {
            "service": "Consultation",
            "customer": "Brian Demo",
            "phone": "+12025550123",
            "hour": 13,
        },
        {
            "service": "Service Visit",
            "customer": "Clara Demo",
            "phone": "+12025550123",
            "hour": 16,
        },
    ]

    for item in appointments:

        start = tomorrow.replace(
            hour=item["hour"],
            minute=0,
            second=0,
            microsecond=0,
        )

        create_demo_event(
            service=item["service"],
            customer=item["customer"],
            phone=item["phone"],
            start_time=start,
        )


if __name__ == "__main__":
    main()