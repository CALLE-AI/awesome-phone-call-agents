import pytest
from src.models import (
    IncidentAlert,
    IncidentSeverity,
    IncidentState,
    IncidentAction,
    CallResultSchema,
    IncidentRecord,
)


def test_incident_alert_creation():
    alert = IncidentAlert(
        service="checkout-service",
        severity=IncidentSeverity.P0_CRITICAL,
        title="Checkout failure",
        description="Checkout API returning 500 status codes",
    )
    assert alert.service == "checkout-service"
    assert alert.severity == IncidentSeverity.P0_CRITICAL
    assert alert.id.startswith("INC-")


def test_call_result_schema_validation():
    schema = CallResultSchema(
        incident_id="INC-123456",
        callee_name="Primary SRE",
        callee_verified=True,
        pin_matched=True,
        verdict=IncidentAction.ACKNOWLEDGE,
        spoken_eta_minutes=15,
        dtmf_key_pressed="1",
        call_duration_seconds=35.0,
        transcript_summary="Verified and acknowledged.",
    )
    assert schema.pin_matched is True
    assert schema.verdict == IncidentAction.ACKNOWLEDGE
    assert schema.dtmf_key_pressed == "1"


def test_incident_record_audit_hash():
    alert = IncidentAlert(
        service="auth-service",
        title="Auth service down",
        description="Redis cluster latency spike"
    )
    record = IncidentRecord(
        alert=alert,
        state=IncidentState.ACKNOWLEDGED,
        phone_dialed="+15555550100"
    )
    audit_hash = record.compute_audit_hash()
    assert isinstance(audit_hash, str)
    assert len(audit_hash) == 64  # SHA-256 hex string
