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


@pytest.mark.asyncio
async def test_api_token_comparison_with_configured_secret():
    """
    Requirement 1: Compare the API token with a configured secret;
    reject arbitrary tokens, require matching secret for remote requests.
    """
    from fastapi import HTTPException
    from src.config import settings
    
    orig_server_key = settings.server_api_key
    orig_calle_key = settings.calle_api_key

    try:
        settings.server_api_key = "super_secure_server_secret_123"
        settings.calle_api_key = ""

        class MockClient:
            host = "192.168.1.100"  # Remote IP

        class MockRequest:
            client = MockClient()
            def __init__(self, headers):
                self.headers = headers

        # Arbitrary token (even >= 8 chars) must fail with 401
        req_arbitrary = MockRequest({"Authorization": "Bearer any_random_token_12345"})
        with pytest.raises(HTTPException) as exc_info:
            verify_loopback_or_auth(req_arbitrary)
        assert exc_info.value.status_code == 401

        # Matching token must succeed
        req_valid = MockRequest({"Authorization": "Bearer super_secure_server_secret_123"})
        assert verify_loopback_or_auth(req_valid) is True

        # Matching X-API-Key header must succeed
        req_valid_api_key = MockRequest({"X-API-Key": "super_secure_server_secret_123"})
        assert verify_loopback_or_auth(req_valid_api_key) is True

    finally:
        settings.server_api_key = orig_server_key
        settings.calle_api_key = orig_calle_key


def test_explicit_recipient_authorization_enforced():
    """
    Requirement 1: Retain explicit recipient authorization for live calls.
    """
    import asyncio
    from src.config import is_authorized_live_recipient, settings
    from src.calle_bridge import LiveCalleBridge

    # Configured on-call phone is authorized
    assert is_authorized_live_recipient(settings.primary_oncall_phone) is True

    # Random number not in whitelist is unauthorized
    assert is_authorized_live_recipient("+919800011111") is False

    # LiveCalleBridge dispatch to unauthorized number raises ValueError
    live_bridge = LiveCalleBridge(api_key="mock_key", base_url="https://api.heycall-e.com/v1")
    alert = IncidentAlert(
        service="db-service",
        severity=IncidentSeverity.P0_CRITICAL,
        title="DB crash",
        description="DB outage",
        cluster="prod"
    )
    with pytest.raises(ValueError, match="not in the authorized live recipient pool"):
        asyncio.run(live_bridge.dispatch_incident_call(alert, to_phone="+919800011111"))


@pytest.mark.asyncio
async def test_transport_failure_kept_ambiguous_and_halts_cascade():
    """
    Requirement 2: Keep transport/submission failures ambiguous and halt the cascade.
    """
    engine = IncidentEngine(bridge=MockCalleBridge())
    alert = IncidentAlert(
        service="payment-gw",
        severity=IncidentSeverity.P0_CRITICAL,
        title="Gateway 502",
        description="Payment gateway 502 Bad Gateway",
        cluster="prod-eu-west-1"
    )

    # Simulated transport error
    record = await engine.trigger_incident(alert, primary_outcome="transport_error")
    assert record.state == IncidentState.PRIMARY_PENDING
    assert record.owner == "UNASSIGNED"
    assert record.escalation_level == 1
    assert len(record.calls) == 1
    assert record.calls[0].status == "ambiguous"


def test_crm_credentials_origin_restriction_no_plain_http():
    """
    Requirement 3: Restrict provider credentials to an approved HTTPS origin;
    the new CRM credential path must not permit plain HTTP.
    """
    from src.crm_connector import TwentyCRMConnector

    # Plain remote HTTP with credentials must raise ValueError
    with pytest.raises(ValueError, match="CRM provider credentials cannot be transmitted over plain HTTP"):
        TwentyCRMConnector(base_url="http://remote-crm.corp.internal/rest", api_key="secret_token_abc")

    # Approved HTTPS origin with credentials must succeed
    crm_https = TwentyCRMConnector(base_url="https://crm.corp.internal/rest", api_key="secret_token_abc")
    assert crm_https.base_url == "https://crm.corp.internal/rest"

    # Local loopback with credentials allowed for testing
    crm_local = TwentyCRMConnector(base_url="http://localhost:3000/rest", api_key="secret_token_abc")
    assert crm_local.base_url == "http://localhost:3000/rest"


def test_nested_text_masking_in_state_and_transcripts():
    """
    Requirement 4: Mask nested transcript/result/error text in displayed or exported state.
    """
    from src.models import CallRecord, CallResultSchema, sanitize_text

    # Unstructured text sanitization
    raw_text = "Engineer Alex reached at +15555550100 and secondary at +91 98201 44512."
    sanitized = sanitize_text(raw_text)
    assert "+15555550100" not in sanitized
    assert "+91 98201 44512" not in sanitized
    assert "••••" in sanitized

    # Nested call record sanitization
    call = CallRecord(
        call_id="call_test_123",
        to_phone="+15555550100",
        status="completed",
        mode="mock",
        duration_seconds=15.0,
        result=CallResultSchema(
            incident_id="INC-1",
            callee_name="Alex Vance (+15555550100)",
            callee_verified=True,
            pin_matched=True,
            verdict=IncidentAction.ACKNOWLEDGE,
            spoken_eta_minutes=10,
            dtmf_key_pressed="1",
            call_duration_seconds=15.0,
            transcript_summary="Outbound call placed to +15555550100 was acknowledged.",
            notes="Callee confirmed at +15555550100."
        ),
        transcript=[
            {"speaker": "AGENT", "offset_seconds": 0.5, "text": "Calling engineer at +15555550100 now."}
        ]
    )

    masked_dict = call.to_safe_dict()
    assert "+15555550100" not in masked_dict["to_phone"]
    assert "+15555550100" not in masked_dict["transcript"][0]["text"]
    assert "+15555550100" not in masked_dict["result"]["transcript_summary"]
    assert "+15555550100" not in masked_dict["result"]["notes"]


@pytest.mark.asyncio
async def test_tenant_dispatch_simulation_safeguard():
    """
    Requirement 6: Tenant dispatch simulation must not fabricate COMPLETED/verified=True,
    and external callbacks must remain disabled by default.
    """
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        req_payload = {
            "tenant_id": "tenant-ecom-urbanstride",
            "customer_name": "Test Customer",
            "customer_phone": "+91 98201 44512",
            "is_simulation": True,
            "allow_external_callbacks": False
        }
        res = await ac.post("/api/v1/tenants/tenant-ecom-urbanstride/dispatch", json=req_payload)
        assert res.status_code == 200
        data = res.json()

        # Must NOT fabricate COMPLETED or claim real verification
        assert data["status"] == "SIMULATED"
        assert data["is_simulated"] is True
        assert "Simulation mode" in data["message"]
