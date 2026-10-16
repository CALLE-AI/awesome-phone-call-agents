import pytest
from src.models import IncidentAlert, IncidentSeverity, IncidentAction
from src.calle_bridge import MockCalleBridge


@pytest.mark.asyncio
async def test_mock_bridge_dispatch_acknowledge():
    bridge = MockCalleBridge()
    alert = IncidentAlert(
        service="order-service",
        severity=IncidentSeverity.P0_CRITICAL,
        title="Orders failing",
        description="Database unreachable"
    )
    call_record = await bridge.dispatch_incident_call(
        alert=alert,
        to_phone="+15555550100",
        callee_role="Primary SRE",
        expected_pin="4829",
        force_action=IncidentAction.ACKNOWLEDGE
    )

    assert call_record.status == "completed"
    assert call_record.mode == "mock"
    assert len(call_record.transcript) >= 4
    assert call_record.result is not None
    assert call_record.result.pin_matched is True
    assert call_record.result.verdict == IncidentAction.ACKNOWLEDGE
    assert call_record.result.dtmf_key_pressed == "1"


@pytest.mark.asyncio
async def test_mock_bridge_dispatch_escalate():
    bridge = MockCalleBridge()
    alert = IncidentAlert(
        service="billing-engine",
        severity=IncidentSeverity.P0_CRITICAL,
        title="Billing queue stopped",
        description="RabbitMQ node failure"
    )
    call_record = await bridge.dispatch_incident_call(
        alert=alert,
        to_phone="+15555550100",
        force_action=IncidentAction.ESCALATE
    )

    assert call_record.result is not None
    assert call_record.result.verdict == IncidentAction.ESCALATE
    assert call_record.result.dtmf_key_pressed == "2"


@pytest.mark.asyncio
async def test_mock_bridge_dispatch_no_answer():
    bridge = MockCalleBridge()
    alert = IncidentAlert(
        service="checkout-db",
        severity=IncidentSeverity.P0_CRITICAL,
        title="PostgreSQL connection exhaustion",
        description="Pool saturated at 500/500"
    )
    call_record = await bridge.dispatch_incident_call(
        alert=alert,
        to_phone="+15555550100",
        force_outcome="no_answer"
    )

    assert call_record.status == "no_answer"
    assert call_record.duration_seconds == 18.0
    assert call_record.result.outcome == "unreachable"
    assert call_record.result.reason == "no_answer"
    assert call_record.result.call_completed is False

