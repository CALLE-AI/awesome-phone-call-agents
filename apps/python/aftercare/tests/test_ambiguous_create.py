from __future__ import annotations

from datetime import datetime
from unittest.mock import MagicMock, patch

import pytest

from app.integrations.calle import CalleCreateUnknownError, place_call
from app.models.orm import Call, EmergencyNotification, FollowUp, Patient
from app.services.call_service import CallService
from app.services.notification_service import (
    CHANNEL_CALLE_CALL,
    CHANNEL_SMS,
    NotificationService,
)

FICTIONAL_PHONE = "+15555550100"


def _patient(*, consent: bool, doctor_contact: str | None = FICTIONAL_PHONE) -> Patient:
    return Patient(
        id=1,
        name="Demo Patient",
        phone=FICTIONAL_PHONE,
        consent_on_file=consent,
        doctor_contact=doctor_contact,
        doctor_name="Demo Doctor",
    )


def _followup() -> FollowUp:
    return FollowUp(
        id=9,
        patient_id=1,
        scheduled_time=datetime(2026, 1, 1),
        status="pending",
        attempt_count=0,
        max_attempts=3,
    )


def _call_service(patient: Patient, followup: FollowUp) -> tuple[CallService, list[Call]]:
    created: list[Call] = []

    def create_call(call: Call) -> Call:
        call.id = 42
        created.append(call)
        return call

    patients = MagicMock()
    patients.get_by_id.return_value = patient
    followups = MagicMock()
    followups.get_due.return_value = [followup]
    followups.get_for_patient.return_value = followup
    followups.save.side_effect = lambda row: row
    calls = MagicMock()
    calls.create.side_effect = create_call
    calls.save.side_effect = lambda row: row
    protocols = MagicMock()
    protocols.get_for_patient.return_value = None
    protocols.build_task.return_value = "Ask how recovery is going."
    protocols.build_result_schema.return_value = {"type": "object", "properties": {}}
    service = CallService(
        patients=patients,
        followups=followups,
        calls=calls,
        protocols=protocols,
    )
    return service, created


def test_place_call_timeout_is_unknown_create() -> None:
    client = MagicMock()
    client.calls.create.side_effect = TimeoutError("create timed out")
    with patch("app.integrations.calle._get_client", return_value=client):
        with pytest.raises(CalleCreateUnknownError, match="unknown"):
            place_call(
                _patient(consent=True),
                task="Ask how recovery is going.",
                result_schema={"type": "object", "properties": {}},
                dry_run=False,
                internal_call_id=1,
            )
    client.calls.create.assert_called_once()


def test_place_call_missing_id_is_unknown_create() -> None:
    client = MagicMock()
    client.calls.create.return_value = {"status": "queued"}
    with patch("app.integrations.calle._get_client", return_value=client):
        with pytest.raises(CalleCreateUnknownError, match="no call id"):
            place_call(
                _patient(consent=True),
                task="Ask how recovery is going.",
                result_schema={"type": "object", "properties": {}},
                dry_run=False,
                internal_call_id=1,
            )


def test_place_call_client_4xx_is_not_unknown() -> None:
    class BadRequest(Exception):
        status_code = 400

    client = MagicMock()
    client.calls.create.side_effect = BadRequest("invalid recipient")
    with patch("app.integrations.calle._get_client", return_value=client):
        with pytest.raises(BadRequest):
            place_call(
                _patient(consent=True),
                task="Ask how recovery is going.",
                result_schema={"type": "object", "properties": {}},
                dry_run=False,
                internal_call_id=1,
            )


def test_ambiguous_create_leaves_followup_in_progress() -> None:
    followup = _followup()
    service, created = _call_service(_patient(consent=True), followup)
    with patch(
        "app.services.call_service.place_call",
        side_effect=CalleCreateUnknownError("timeout"),
    ) as mock_place:
        service.process_due_followups(dry_run=False)

    mock_place.assert_called_once()
    assert followup.status == "in_progress"
    assert followup.attempt_count == 1
    assert created[0].status == "outcome_unknown"


def test_live_trigger_without_consent_does_not_place_call() -> None:
    followup = _followup()
    service, created = _call_service(_patient(consent=False), followup)
    with patch("app.services.call_service.place_call") as mock_place:
        with pytest.raises(Exception, match="consent"):
            service.trigger(
                patient_id=1,
                followup_id=9,
                dry_run=False,
                authorized_destination=FICTIONAL_PHONE,
            )

    mock_place.assert_not_called()
    assert created == []


def test_presend_place_call_error_marks_failed_and_requeues() -> None:
    followup = _followup()
    service, created = _call_service(_patient(consent=True), followup)
    with patch(
        "app.services.call_service.place_call",
        side_effect=ValueError("Patient has not given consent to be called"),
    ) as mock_place:
        service.process_due_followups(dry_run=False)

    mock_place.assert_called_once()
    assert created[0].status == "failed"
    assert followup.status == "pending"
    assert followup.attempt_count == 1


def test_warning_unknown_create_is_not_retried() -> None:
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

    def get_or_create(**kwargs: object) -> EmergencyNotification:
        if kwargs["channel"] == CHANNEL_SMS:
            return sms
        return warning

    repo = MagicMock()
    repo.get_or_create.side_effect = get_or_create
    repo.save.side_effect = lambda row: row
    service = NotificationService(repo)
    call = Call(
        id=7,
        patient_id=1,
        status="completed",
        dry_run=False,
        is_emergency=True,
        summary="Chest pain reported",
        risk_level="critical",
    )
    patient = _patient(consent=True, doctor_contact=FICTIONAL_PHONE)

    with (
        patch("app.services.notification_service.twilio_client.send_sms", return_value="SM1"),
        patch(
            "app.services.notification_service.place_warning_call",
            side_effect=CalleCreateUnknownError("timeout"),
        ) as mock_warn,
    ):
        service.dispatch_emergency(
            patient=patient,
            call=call,
            dry_run=False,
            authorized_destination=FICTIONAL_PHONE,
        )
        service.dispatch_emergency(
            patient=patient,
            call=call,
            dry_run=False,
            authorized_destination=FICTIONAL_PHONE,
        )

    mock_warn.assert_called_once()
    assert warning.status == "outcome_unknown"
    assert warning.attempt_count == 1
