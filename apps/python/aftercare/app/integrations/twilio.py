from twilio.rest import Client

from app.config import settings


def send_sms(*, to: str, body: str) -> str | None:
    if not (
        settings.twilio_account_sid
        and settings.twilio_auth_token
        and settings.twilio_from_number
    ):
        return None

    client = Client(settings.twilio_account_sid, settings.twilio_auth_token)
    message = client.messages.create(
        to=to,
        from_=settings.twilio_from_number,
        body=body[:1500],
    )
    return message.sid
