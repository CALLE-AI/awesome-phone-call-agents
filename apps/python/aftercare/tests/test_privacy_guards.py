from __future__ import annotations

import json
import logging
from datetime import datetime
from unittest.mock import MagicMock, patch

import pytest

from app.core.logging import RedactFilter, _JsonFormatter
from app.core.redact import mask_phone
from app.integrations.calle import CallEResult
from app.models.orm import Call, FollowUp, Patient
from app.models.schemas import CallRead, PatientRead
from app.repositories.agent_repository import AgentRepository
from app.services.agent_blocks import _patient_detail_blocks
from app.services.call_service import CallService, TriggerError
from app.utils.validators import is_supported_e164

FICTIONAL_PHONE = "+15555550100"
OTHER_PHONE = "+15555550101"


def _patient(*, consent: bool = True, phone: str = FICTIONAL_PHONE) -> Patient:
    return Patient(
        id=1,
        name="Demo Patient",
        phone=phone,
        consent_on_file=consent,
        doctor_contact=OTHER_PHONE,
        doctor_name="Demo Doctor",
        discharge_diagnosis="Call me at +15555550999 after discharge",
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


def _call_service(patient: Patient, followup: FollowUp | None = None) -> CallService:
    def create_call(call: Call) -> Call:
        call.id = 42
        return call

    patients = MagicMock()
    patients.get_by_id.return_value = patient
    followups = MagicMock()
    followups.get_due.return_value = [followup] if followup else []
    followups.get_for_patient.return_value = followup
    followups.save.side_effect = lambda row: followup
    calls = MagicMock()
    calls.create.side_effect = create_call
    calls.save.side_effect = lambda row: row
    protocols = MagicMock()
    protocols.get_for_patient.return_value = None
    protocols.build_task.return_value = "Ask how recovery is going."
    protocols.build_result_schema.return_value = {"type": "object", "properties": {}}
    return CallService(
        patients=patients,
        followups=followups,
        calls=calls,
        protocols=protocols,
    )


def test_supported_e164_rejects_non_ascii_digits() -> None:
    assert is_supported_e164(FICTIONAL_PHONE)
    assert not is_supported_e164("+" + "\u0661" + "5555550100")
    assert not is_supported_e164("+15555\uFF15" + "50100")
    assert not is_supported_e164("+1555555")


def test_live_trigger_requires_authorized_destination() -> None:
    service = _call_service(_patient())
    with patch("app.services.call_service.place_call") as mock_place:
        with pytest.raises(TriggerError, match="authorized_destination"):
            service.trigger(patient_id=1, dry_run=False)
    mock_place.assert_not_called()


def test_live_trigger_rejects_mismatched_destination() -> None:
    service = _call_service(_patient())
    with patch("app.services.call_service.place_call") as mock_place:
        with pytest.raises(TriggerError, match="does not match"):
            service.trigger(
                patient_id=1,
                dry_run=False,
                authorized_destination=OTHER_PHONE,
            )
    mock_place.assert_not_called()


def test_live_trigger_exact_match_places_call() -> None:
    service = _call_service(_patient())
    result = CallEResult(
        provider_call_id="calle_1",
        status="queued",
        dry_run=False,
    )
    with patch("app.services.call_service.place_call", return_value=result) as mock_place:
        call = service.trigger(
            patient_id=1,
            dry_run=False,
            authorized_destination=FICTIONAL_PHONE,
        )
    mock_place.assert_called_once()
    assert call.status == "queued"
    assert mock_place.call_args.kwargs["dry_run"] is False


def test_process_due_followups_forces_dry_run() -> None:
    followup = _followup()
    service = _call_service(_patient(), followup)
    result = CallEResult(
        provider_call_id="dryrun_1",
        status="dry_run",
        dry_run=True,
    )
    with patch("app.services.call_service.place_call", return_value=result) as mock_place:
        service.process_due_followups(dry_run=False)
    mock_place.assert_called_once()
    assert mock_place.call_args.kwargs["dry_run"] is True


def test_log_formatter_redacts_e164() -> None:
    record = logging.LogRecord(
        name="test",
        level=logging.WARNING,
        pathname=__file__,
        lineno=1,
        msg="calling %s",
        args=(FICTIONAL_PHONE,),
        exc_info=None,
    )
    RedactFilter().filter(record)
    formatted = _JsonFormatter().format(record)
    assert FICTIONAL_PHONE not in formatted
    assert mask_phone(FICTIONAL_PHONE) in formatted


def test_agent_patient_detail_masks_phone_and_clinical_text() -> None:
    repo = AgentRepository(db=MagicMock())
    payload = repo._patient_detail_payload(_patient(), query=FICTIONAL_PHONE)
    dumped = json.dumps(payload)
    assert "phone" not in payload["patient"]
    assert payload["patient"]["phone_masked"] == mask_phone(FICTIONAL_PHONE)
    assert FICTIONAL_PHONE not in dumped
    assert "+15555550999" not in dumped

    blocks = _patient_detail_blocks(payload)
    block_dump = blocks[0].model_dump()
    patient = block_dump["patient"]
    assert "phone" not in patient
    assert "diagnosis" not in patient
    assert patient["phone_masked"] == mask_phone(FICTIONAL_PHONE)
    assert FICTIONAL_PHONE not in json.dumps(block_dump)


def test_patient_read_masks_phones_and_omits_diagnosis() -> None:
    dumped = PatientRead.model_validate(_patient()).model_dump()
    assert dumped["phone_masked"] == mask_phone(FICTIONAL_PHONE)
    assert dumped["doctor_contact_masked"] == mask_phone(OTHER_PHONE)
    assert "phone" not in dumped
    assert "doctor_contact" not in dumped
    assert "discharge_diagnosis" not in dumped
    text = json.dumps(dumped)
    assert FICTIONAL_PHONE not in text
    assert OTHER_PHONE not in text
    assert "+15555550999" not in text


def test_call_read_omits_clinical_fields_and_transcript() -> None:
    call = Call(
        id=7,
        patient_id=1,
        status="completed",
        transcript="Patient reported chest pain. Reach them at +15555550100.",
        summary="Clinical summary of emergency symptoms",
        risk_score=97.0,
        risk_level="critical",
        is_emergency=True,
        dry_run=False,
    )
    dumped = CallRead.model_validate(call).model_dump()
    assert "transcript" not in dumped
    assert "summary" not in dumped
    assert "risk_score" not in dumped
    assert "risk_level" not in dumped
    assert "is_emergency" not in dumped
    assert "symptoms" not in dumped
    text = json.dumps(dumped)
    assert "chest pain" not in text
    assert "Clinical summary" not in text
    assert FICTIONAL_PHONE not in text


def test_fixtures_do_not_use_plausible_in_numbers() -> None:
    from pathlib import Path

    root = Path(__file__).resolve().parents[1]
    banned = (
        "+" + "91" + "98765" + "43210",
        "+" + "91" + "21212" + "34567",
        "+" + "91 " + "21212" + "34567",
        "98765" + "43210",
        "21212" + "34567",
    )
    paths = [
        root / "scripts" / "check_agent.py",
        root / "app" / "models" / "schemas.py",
        root / "app" / "services" / "patient_service.py",
        root / "static" / "frontend" / "_next" / "static" / "chunks" / "333ffh7oqn20b.js",
        root / "static" / "frontend" / "_next" / "static" / "chunks" / "40i_rpbveb29r.js",
    ]
    for path in paths:
        text = path.read_text(encoding="utf-8")
        for needle in banned:
            assert needle not in text, f"{needle} still in {path}"
