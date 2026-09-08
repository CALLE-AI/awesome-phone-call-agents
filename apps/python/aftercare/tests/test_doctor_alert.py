from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from app.integrations.calle import CallEResult
from app.models.orm import Call, EmergencyNotification, Patient
from app.services.notification_service import (
    CHANNEL_CALLE_CALL,
    CHANNEL_SMS,
    DoctorAlertError,
    NotificationService,
)

FICTIONAL_PHONE = "+15555550100"
DOCTOR_PHONE = "+15555550101"


def _patient(*, doctor_contact: str | None = DOCTOR_PHONE) -> Patient:
    return Patient(
        id=1,
        name="Demo Patient",
        phone=FICTIONAL_PHONE,
        consent_on_file=True,
        doctor_contact=doctor_contact,
        doctor_name="Demo Doctor",
    )


def _call(*, is_emergency: bool = True, dry_run: bool = False) -> Call:
    return Call(
        id=7,
        patient_id=1,
        status="completed",
        dry_run=dry_run,
        is_emergency=is_emergency,
        summary="Chest pain reported",
        risk_level="critical",
    )


def _pending_rows() -> tuple[EmergencyNotification, EmergencyNotification]:
    sms = EmergencyNotification(
        id=1,
        call_id=7,
        patient_id=1,
        channel=CHANNEL_SMS,
        status="pending",
        attempt_count=0,
    )
    warning = EmergencyNotification(
        id=2,
        call_id=7,
        patient_id=1,
        channel=CHANNEL_CALLE_CALL,
        status="pending",
        attempt_count=0,
    )
    return sms, warning


def _service(
    sms: EmergencyNotification, warning: EmergencyNotification
) -> NotificationService:
    def get_or_create(**kwargs: object) -> EmergencyNotification:
        if kwargs["channel"] == CHANNEL_SMS:
            return sms
        return warning

    repo = MagicMock()
    repo.get_or_create.side_effect = get_or_create
    repo.save.side_effect = lambda row: row
    return NotificationService(repo)


def test_notify_emergency_queues_without_sending() -> None:
    sms, warning = _pending_rows()
    service = _service(sms, warning)
    with (
        patch("app.services.notification_service.twilio_client.send_sms") as mock_sms,
        patch("app.services.notification_service.place_warning_call") as mock_warn,
    ):
        service.notify_emergency(patient=_patient(), call=_call(dry_run=False))

    mock_sms.assert_not_called()
    mock_warn.assert_not_called()
    assert sms.status == "pending"
    assert warning.status == "pending"
    assert sms.attempt_count == 0
    assert warning.attempt_count == 0


def test_live_dispatch_requires_authorized_destination() -> None:
    sms, warning = _pending_rows()
    service = _service(sms, warning)
    with (
        patch("app.services.notification_service.twilio_client.send_sms") as mock_sms,
        patch("app.services.notification_service.place_warning_call") as mock_warn,
        pytest.raises(DoctorAlertError, match="authorized_destination"),
    ):
        service.dispatch_emergency(
            patient=_patient(),
            call=_call(),
            dry_run=False,
        )
    mock_sms.assert_not_called()
    mock_warn.assert_not_called()


def test_live_dispatch_rejects_patient_phone() -> None:
    sms, warning = _pending_rows()
    service = _service(sms, warning)
    with (
        patch("app.services.notification_service.twilio_client.send_sms") as mock_sms,
        patch("app.services.notification_service.place_warning_call") as mock_warn,
        pytest.raises(DoctorAlertError, match="does not match"),
    ):
        service.dispatch_emergency(
            patient=_patient(),
            call=_call(),
            dry_run=False,
            authorized_destination=FICTIONAL_PHONE,
        )
    mock_sms.assert_not_called()
    mock_warn.assert_not_called()


def test_live_dispatch_rejects_mismatched_destination() -> None:
    sms, warning = _pending_rows()
    service = _service(sms, warning)
    with pytest.raises(DoctorAlertError, match="does not match"):
        service.dispatch_emergency(
            patient=_patient(),
            call=_call(),
            dry_run=False,
            authorized_destination="+15555550199",
        )


def test_live_dispatch_exact_match_sends() -> None:
    sms, warning = _pending_rows()
    service = _service(sms, warning)
    result = CallEResult(
        provider_call_id="calle_doc_1",
        status="queued",
        dry_run=False,
    )
    with (
        patch(
            "app.services.notification_service.twilio_client.send_sms",
            return_value="SM1",
        ) as mock_sms,
        patch(
            "app.services.notification_service.place_warning_call",
            return_value=result,
        ) as mock_warn,
    ):
        service.dispatch_emergency(
            patient=_patient(),
            call=_call(),
            dry_run=False,
            authorized_destination=DOCTOR_PHONE,
        )
    mock_sms.assert_called_once()
    mock_warn.assert_called_once()
    assert mock_warn.call_args.kwargs["dry_run"] is False
    assert mock_warn.call_args.kwargs["doctor_phone"] == DOCTOR_PHONE
    assert sms.status == "sent"
    assert warning.status == "queued"


def test_dispatch_rejects_non_emergency() -> None:
    sms, warning = _pending_rows()
    service = _service(sms, warning)
    with pytest.raises(DoctorAlertError, match="not marked as an emergency"):
        service.dispatch_emergency(
            patient=_patient(),
            call=_call(is_emergency=False),
            dry_run=True,
        )


def test_dry_run_dispatch_does_not_construct_calle_client() -> None:
    sms, warning = _pending_rows()
    service = _service(sms, warning)
    with (
        patch(
            "app.integrations.calle.CalleClient",
            side_effect=AssertionError("CalleClient must not be constructed"),
        ),
        patch("app.services.notification_service.twilio_client.send_sms") as mock_sms,
    ):
        service.dispatch_emergency(patient=_patient(), call=_call(), dry_run=True)

    mock_sms.assert_not_called()
    assert sms.status == "dry_run"
    assert warning.status == "dry_run"
    assert warning.provider_id
    assert str(warning.provider_id).startswith("dryrun_doc_")
