import pytest
from src.models import IncidentAlert, IncidentSeverity, IncidentState, IncidentAction
from src.incident_engine import IncidentEngine
from src.calle_bridge import MockCalleBridge


@pytest.mark.asyncio
async def test_engine_primary_acknowledge():
    engine = IncidentEngine(bridge=MockCalleBridge())
    alert = IncidentAlert(
        service="k8s-ingress",
        severity=IncidentSeverity.P0_CRITICAL,
        title="Ingress controller crash",
        description="Nginx pods in crash loop"
    )
    record = await engine.trigger_incident(alert, force_action=IncidentAction.ACKNOWLEDGE)

    assert record.state == IncidentState.OWNERSHIP_ESTABLISHED
    assert record.owner == "Alex Vance (Primary On-Call SRE)"
    assert record.escalation_level == 1
    assert len(record.calls) == 1
    assert record.calls[0].result.verdict == IncidentAction.ACKNOWLEDGE
    assert record.audit_hash != ""
    assert len(record.state_history) >= 5


@pytest.mark.asyncio
async def test_engine_escalation_cascade():
    engine = IncidentEngine(bridge=MockCalleBridge())
    alert = IncidentAlert(
        service="payment-processor",
        severity=IncidentSeverity.P0_CRITICAL,
        title="Payment processor outage",
        description="Unable to reach upstream acquirer"
    )
    record = await engine.trigger_incident(alert, force_action=IncidentAction.ESCALATE)

    # Primary escalated -> Secondary SRE called and accepted ownership
    assert record.state == IncidentState.OWNERSHIP_ESTABLISHED
    assert record.owner == "Elena Rostova (Secondary On-Call SRE)"
    assert record.escalation_level == 2
    assert len(record.calls) == 2
    assert record.calls[1].result.verdict == IncidentAction.ACKNOWLEDGE


@pytest.mark.asyncio
async def test_engine_primary_no_answer_autonomous_escalation():
    engine = IncidentEngine(bridge=MockCalleBridge())
    alert = IncidentAlert(
        service="order-matching-engine",
        severity=IncidentSeverity.P0_CRITICAL,
        title="Order book matching freeze",
        description="Kafka stream consumer group lagged 50,000 messages"
    )
    record = await engine.trigger_incident(alert, primary_outcome="no_answer")

    assert record.state == IncidentState.OWNERSHIP_ESTABLISHED
    assert record.owner == "Elena Rostova (Secondary On-Call SRE)"
    assert record.escalation_level == 2
    assert len(record.calls) == 2
    assert record.calls[0].status == "no_answer"
    assert record.calls[1].status == "completed"
    assert record.calls[1].result.pin_matched is True
    # Verify exact state transition progression
    history_states = [s["state"] for s in record.state_history]
    assert "UNASSIGNED" in history_states
    assert "CALLING_PRIMARY" in history_states
    assert "PRIMARY_UNAVAILABLE" in history_states
    assert "ESCALATING" in history_states
    assert "CALLING_SECONDARY" in history_states
    assert "OWNERSHIP_ESTABLISHED" in history_states

