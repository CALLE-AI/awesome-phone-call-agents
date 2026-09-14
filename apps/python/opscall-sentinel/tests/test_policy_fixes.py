import pytest
from httpx import AsyncClient, ASGITransport
from src.server import app, verify_loopback_or_auth
from src.config import validate_ascii_e164, Settings
from src.models import (
    IncidentAlert,
    IncidentSeverity,
    IncidentState,
    IncidentAction,
    mask_phone,
)
from src.incident_engine import IncidentEngine
from src.calle_bridge import MockCalleBridge


@pytest.mark.asyncio
async def test_pending_ambiguous_primary_stops_escalation():
    """
    Requirement 1: Stop after pending/ambiguous primary submissions instead of
    automatically calling secondary; never fabricate completed/PIN-verified ownership.
    """
    engine = IncidentEngine(bridge=MockCalleBridge())
    alert = IncidentAlert(
        service="payment-checkout",
        severity=IncidentSeverity.P0_CRITICAL,
        title="Checkout degradation",
        description="High latency on checkout",
        cluster="prod-us-east-1"
    )

    record = await engine.trigger_incident(alert, primary_outcome="pending")
    # Must stop at PRIMARY_PENDING
    assert record.state == IncidentState.PRIMARY_PENDING
    assert record.owner == "UNASSIGNED"
    # Must NOT have escalated to secondary
    assert record.escalation_level == 1
    assert len(record.calls) == 1
    assert record.calls[0].status == "pending"
    assert record.calls[0].result is None


@pytest.mark.asyncio
async def test_missing_result_does_not_fabricate_ownership():
    """
    Requirement 1: Never fabricate completed/PIN-verified ownership from missing results.
    """
    engine = IncidentEngine(bridge=MockCalleBridge())
    alert = IncidentAlert(
        service="kafka-broker",
        severity=IncidentSeverity.P0_CRITICAL,
        title="Broker unassigned",
        description="Kafka partitions offline",
        cluster="prod-us-east-1"
    )

    record = await engine.trigger_incident(alert, primary_outcome="missing_result")
    assert record.state == IncidentState.PRIMARY_UNAVAILABLE
    assert record.owner == "UNASSIGNED"
    assert record.escalation_level == 1
    # Verify primary call did NOT have fabricated ownership
    assert record.calls[0].result is None


def test_ascii_e164_validation_and_synthetic_rejection():
    """
    Requirement 2: Restrict credentials to approved HTTPS and validate authorized
    live ASCII E.164 destinations, excluding synthetic defaults.
    """
    # Valid ASCII E.164 numbers
    assert validate_ascii_e164("+919876543210", allow_synthetic=False) == "+919876543210"
    assert validate_ascii_e164("+14155552671", allow_synthetic=False) == "+14155552671"

    # Synthetic patterns must fail when allow_synthetic=False
    with pytest.raises(ValueError, match="Synthetic default destination"):
        validate_ascii_e164("+15555550100", allow_synthetic=False)

    with pytest.raises(ValueError, match="Synthetic default destination"):
        validate_ascii_e164("+15555550199", allow_synthetic=False)

    # Synthetic allowed in mock mode
    assert validate_ascii_e164("+15555550100", allow_synthetic=True) == "+15555550100"

    # Invalid E.164 formats
    with pytest.raises(ValueError, match="ASCII E.164"):
        validate_ascii_e164("15555550100", allow_synthetic=True)
    with pytest.raises(ValueError, match="ASCII E.164"):
        validate_ascii_e164("+1-555-555-0100", allow_synthetic=True)


def test_phone_masking_utility():
    """
    Requirement 4: Mask phone-bearing outputs.
    """
    assert mask_phone("+916204403896") == "+91 •••• •••896"
    assert mask_phone("+15555550100") == "+15 •••• •••100"
    assert mask_phone(None) == "••••••••"


@pytest.mark.asyncio
async def test_loopback_and_auth_enforcement():
    """
    Requirement 3: Enforce loopback or authentication for remote calls/private transcripts.
    """
    transport = ASGITransport(app=app)
    # Loopback request passes
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        res = await ac.get("/api/v1/incidents")
        assert res.status_code == 200
        data = res.json()
        assert len(data) >= 1
        # Check phone is masked in output
        assert "••••" in data[0]["phone_dialed"]
