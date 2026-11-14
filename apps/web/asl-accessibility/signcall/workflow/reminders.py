"""
Confirmation messages. CALL-E only places voice calls, so texting needs a
separate provider; `send_confirmation_text()` is the extension point for one.
"""

from .types import ClinicSlot


def confirmation_text_body(
    recipient_name: str,
    clinic_name: str,
    slot: ClinicSlot,
    interpreter_name: str | None = None,
    requirements: list[str] | None = None,
) -> str:
    """The confirmation message. The user and the secured interpreter are told
    the same thing, except only the user gets `requirements`.
    `interpreter_name` is None when the user brought their own interpreter."""
    interpreter_line = f" ASL interpreter: {interpreter_name}." if interpreter_name else ""
    requirements_line = (
        f" Required for the appointment: {'; '.join(requirements)}." if requirements else ""
    )
    return (
        f"{recipient_name}: appointment confirmed at {clinic_name} on "
        f"{slot.date} at {slot.time}.{interpreter_line}{requirements_line}"
    )


def send_confirmation_text(phone: str, message: str) -> None:
    """Send `message` to `phone`. Not implemented: plug in an SMS, email or
    push provider here. The caller (appointment.py) catches the
    NotImplementedError and records the undelivered message in the result's
    evidence, so a booked appointment never fails over a missing provider."""
    raise NotImplementedError("No SMS/email/push provider is configured.")
