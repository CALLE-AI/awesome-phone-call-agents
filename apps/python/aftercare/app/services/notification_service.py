from __future__ import annotations

import logging

from app.core.datetimes import utc_now_naive
from app.core.redact import mask_phone
from app.integrations import twilio as twilio_client
from app.integrations.calle import CalleCreateUnknownError, place_warning_call
from app.models.orm import Call, EmergencyNotification, Patient
from app.repositories.emergency_notification_repository import (
    EmergencyNotificationRepository,
)
from app.utils.validators import destinations_match, is_supported_e164, is_valid_e164

logger = logging.getLogger(__name__)

CHANNEL_SMS = "sms"
CHANNEL_CALLE_CALL = "calle_call"


class DoctorAlertError(Exception):
    """Domain error while dispatching a doctor emergency alert."""


class NotificationService:
    def __init__(self, notifications: EmergencyNotificationRepository):
        self.notifications = notifications

    def notify_emergency(self, *, patient: Patient, call: Call) -> None:
        """Queue doctor-alert rows. Heuristic scoring must not SMS or call."""
        self._ensure_rows(patient, call)
        to_number = (patient.doctor_contact or "").strip() or None
        if not to_number:
            logger.warning(
                "No doctor contact for patient %s; queued emergency alert without destination",
                patient.id,
            )
            return
        logger.info(
            "Queued emergency doctor alert for call %s to %s; waiting for authorized dispatch",
            call.id,
            mask_phone(to_number),
        )

    def dispatch_emergency(
        self,
        *,
        patient: Patient,
        call: Call,
        dry_run: bool = True,
        authorized_destination: str | None = None,
    ) -> tuple[EmergencyNotification, EmergencyNotification]:
        """Send queued doctor SMS + warning call after a human authorization."""
        if not call.is_emergency:
            raise DoctorAlertError("Call is not marked as an emergency")

        to_number = (patient.doctor_contact or "").strip() or None
        if not to_number:
            raise DoctorAlertError("No doctor contact on file")
        if not is_supported_e164(to_number):
            raise DoctorAlertError(
                "doctor_contact must be a supported ASCII E.164 number"
            )

        if not dry_run:
            if not authorized_destination:
                raise DoctorAlertError(
                    "Live doctor alerts require authorized_destination set to the exact doctor contact"
                )
            if not is_supported_e164(authorized_destination):
                raise DoctorAlertError(
                    "authorized_destination must be a supported ASCII E.164 number"
                )
            if not destinations_match(authorized_destination, to_number):
                raise DoctorAlertError(
                    "authorized_destination does not match the doctor contact"
                )

        body = _alert_body(patient, call)
        sms, warning = self._ensure_rows(patient, call)
        self._send_sms(sms, to_number=to_number, body=body, dry_run=dry_run)
        self._place_warning_call(
            warning,
            patient=patient,
            call=call,
            to_number=to_number,
            dry_run=dry_run,
        )
        return sms, warning

    def is_warning_call(self, provider_call_id: str | None) -> bool:
        return self.get_warning_by_provider_id(provider_call_id) is not None

    def get_warning_by_provider_id(
        self, provider_call_id: str | None
    ) -> EmergencyNotification | None:
        if not provider_call_id:
            return None
        return self.notifications.get_by_provider_id(str(provider_call_id))

    def mark_warning_call_terminal(
        self,
        *,
        provider_call_id: str | None,
        internal_call_id: int | None,
        status: str,
        event_type: str,
    ) -> EmergencyNotification | None:
        row = None
        if provider_call_id:
            row = self.notifications.get_by_provider_id(str(provider_call_id))
        if row is None and internal_call_id is not None:
            row = self.notifications.get_by_call_and_channel(
                internal_call_id, CHANNEL_CALLE_CALL
            )
        if row is None:
            return None

        if event_type == "call.failed" or status in {"failed", "canceled"}:
            row.status = "failed"
            row.last_error = row.last_error or event_type
        else:
            row.status = "sent"
            row.last_error = None
            row.sent_at = row.sent_at or utc_now_naive()
        return self.notifications.save(row)

    def _ensure_rows(
        self, patient: Patient, call: Call
    ) -> tuple[EmergencyNotification, EmergencyNotification]:
        to_number = (patient.doctor_contact or "").strip() or None
        body = _alert_body(patient, call)
        sms = self.notifications.get_or_create(
            call_id=call.id,
            patient_id=patient.id,
            channel=CHANNEL_SMS,
            to_number=to_number,
            message_body=body,
        )
        warning = self.notifications.get_or_create(
            call_id=call.id,
            patient_id=patient.id,
            channel=CHANNEL_CALLE_CALL,
            to_number=to_number,
            message_body=body,
        )
        return sms, warning

    def _send_sms(
        self,
        row: EmergencyNotification,
        *,
        to_number: str,
        body: str,
        dry_run: bool,
    ) -> None:
        if row.status in {"sent", "dry_run", "skipped"}:
            return

        row.attempt_count += 1
        if dry_run:
            row.status = "dry_run"
            row.last_error = None
            self.notifications.save(row)
            logger.info(
                "Dry-run emergency SMS for call %s to %s",
                row.call_id,
                mask_phone(to_number),
            )
            return

        try:
            sid = twilio_client.send_sms(to=to_number, body=body)
            if not sid:
                row.status = "failed"
                row.last_error = "Twilio credentials not configured"
            else:
                row.status = "sent"
                row.provider_id = sid
                row.sent_at = utc_now_naive()
                row.last_error = None
            self.notifications.save(row)
        except Exception as exc:
            logger.exception("Emergency SMS failed for call %s", row.call_id)
            row.status = "failed"
            row.last_error = str(exc)[:4000]
            self.notifications.save(row)

    def _place_warning_call(
        self,
        row: EmergencyNotification,
        *,
        patient: Patient,
        call: Call,
        to_number: str,
        dry_run: bool,
    ) -> None:
        if row.status in {"queued", "sent", "dry_run", "skipped", "outcome_unknown"}:
            return

        if not is_valid_e164(to_number):
            logger.warning(
                "Doctor contact %s is not E.164; skipped warning call for call %s",
                mask_phone(to_number),
                call.id,
            )
            self._mark_skipped(row, "Doctor contact is not a valid E.164 number")
            return

        row.attempt_count += 1
        try:
            result = place_warning_call(
                doctor_phone=to_number,
                task=_warning_task(patient, call),
                patient=patient,
                internal_call_id=call.id,
                dry_run=dry_run,
            )
            row.provider_id = result.provider_call_id
            row.last_error = None
            if result.dry_run:
                row.status = "dry_run"
            else:
                row.status = "queued"
            self.notifications.save(row)
            logger.info(
                "Doctor warning call %s for follow-up call %s status=%s dry_run=%s",
                result.provider_call_id,
                call.id,
                result.status,
                result.dry_run,
            )
        except CalleCreateUnknownError as exc:
            logger.warning(
                "Ambiguous CALL-E warning create for call %s; not retrying",
                call.id,
            )
            row.status = "outcome_unknown"
            row.last_error = str(exc)[:4000]
            self.notifications.save(row)
        except Exception as exc:
            logger.exception("Doctor warning call failed for call %s", call.id)
            row.status = "failed"
            row.last_error = str(exc)[:4000]
            self.notifications.save(row)

    def _mark_skipped(self, row: EmergencyNotification, reason: str) -> None:
        if row.status in {"sent", "queued", "dry_run", "outcome_unknown"}:
            return
        row.status = "skipped"
        row.last_error = reason
        self.notifications.save(row)


def _alert_body(patient: Patient, call: Call) -> str:
    return (
        f"EMERGENCY follow-up alert\n"
        f"Patient: {patient.name} (id={patient.id})\n"
        f"Phone: {patient.phone}\n"
        f"Risk: {call.risk_level or 'critical'}\n"
        f"Call id: {call.id}\n"
        f"Summary: {call.summary or 'n/a'}"
    )


def _warning_task(patient: Patient, call: Call) -> str:
    doctor = patient.doctor_name or "Doctor"
    summary = (call.summary or "Warning signs were reported during the recovery check-in.").strip()
    diagnosis = (patient.discharge_diagnosis or "").strip()
    extra = f" Discharge note: {diagnosis}." if diagnosis else ""
    return (
        f"Call {patient.doctor_contact}. You are a hospital post-discharge assistant "
        f"calling {doctor} with an urgent clinical alert. "
        f"Patient {patient.name} (phone {patient.phone}) reported emergency warning signs "
        f"on a follow-up call. Risk level: {call.risk_level or 'critical'}.{extra} "
        f"Summary for the doctor: {summary} "
        "State clearly that this is an emergency alert from the hospital follow-up system. "
        "Ask them to acknowledge the alert and whether they will follow up with the patient. "
        "Do not diagnose or prescribe. Keep under 2 minutes. Be concise and professional."
    )
