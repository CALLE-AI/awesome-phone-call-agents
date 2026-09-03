import datetime
import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from app.main import app
from app.database import db
from app.models import (
    CivicTicket,
    CitizenContact,
    DepartmentEnum,
    TicketStatus,
    TicketSeverity,
    CalleWebhookPayload,
)
from app.mcp_server import (
    query_authorization_code,
    update_ticket_status_midcall,
    trigger_department_escalation,
)


@pytest_asyncio.fixture
async def async_client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        yield client


@pytest.mark.asyncio
async def test_health_check(async_client):
    """Verify Cloud Run liveness health check."""
    response = await async_client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    assert "database" in data
    assert "fastmcp_server" in data


@pytest.mark.asyncio
async def test_ticket_listing_and_creation(async_client):
    """Verify listing existing 311 tickets and creating a new civic ticket."""
    # List tickets
    response = await async_client.get("/api/tickets")
    assert response.status_code == 200
    tickets = response.json()
    assert len(tickets) >= 3

    # Create new ticket
    new_ticket = {
        "id": "TKT-311-TEST-9999",
        "title": "Broken Streetlight on Pedestrian Crossing",
        "description": "Streetlight pole flickering and dark at busy school crossing.",
        "department": DepartmentEnum.TRAFFIC_SIGNALS.value,
        "location_address": "500 Mission Street",
        "cross_streets": "Mission St & 1st Street",
        "severity": TicketSeverity.MEDIUM.value,
        "status": TicketStatus.PENDING_OUTREACH.value,
        "reporter": {
            "name": "David Miller",
            "phone_e164": "+14155559090",
            "role": "Crossing Guard",
            "language": "en-US",
        },
        "authorization_code": "PW-AUTH-9921",
    }
    create_resp = await async_client.post("/api/tickets", json=new_ticket)
    assert create_resp.status_code == 201
    created_data = create_resp.json()
    assert created_data["id"] == "TKT-311-TEST-9999"
    assert created_data["status"] == TicketStatus.PENDING_OUTREACH.value


@pytest.mark.asyncio
async def test_fastmcp_tools_execution():
    """Verify all FastMCP tools operate correctly against state layer."""
    # 1. Test query_authorization_code with valid code
    auth_valid = await query_authorization_code(
        ticket_id="TKT-311-ROADS-8812",
        auth_code="PW-AUTH-9921"
    )
    assert auth_valid["valid"] is True
    assert "Department of Transportation Safety Division" in auth_valid["issuer"]
    assert "ROAD_CLOSURE_AUTHORITY" in auth_valid["permissions"]

    # 2. Test query_authorization_code with invalid code
    auth_invalid = await query_authorization_code(
        ticket_id="TKT-311-ROADS-8812",
        auth_code="INVALID-CODE-999"
    )
    assert auth_invalid["valid"] is False

    # 3. Test update_ticket_status_midcall
    status_update = await update_ticket_status_midcall(
        ticket_id="TKT-311-ROADS-8812",
        status=TicketStatus.CALL_IN_PROGRESS.value,
        notes="Citizen verified sinkhole is expanding rapidly.",
        severity=TicketSeverity.HIGH.value
    )
    assert status_update["success"] is True
    assert status_update["applied_status"] == TicketStatus.CALL_IN_PROGRESS.value

    # 4. Test trigger_department_escalation
    esc_result = await trigger_department_escalation(
        ticket_id="TKT-311-ROADS-8812",
        source_dept=DepartmentEnum.ROADS_INFRASTRUCTURE.value,
        target_dept=DepartmentEnum.EMERGENCY_UTILITY_DISPATCH.value,
        reason="High-pressure gas line exposed directly underneath collapsed roadbed.",
        urgency_level=TicketSeverity.CRITICAL_EMERGENCY.value
    )
    assert esc_result["success"] is True
    assert esc_result["escalation_status"] == "ESCALATION_TRIGGERED"
    assert esc_result["target_department"] == DepartmentEnum.EMERGENCY_UTILITY_DISPATCH.value


@pytest.mark.asyncio
async def test_orchestrator_polling_and_dispatch(async_client):
    """Verify orchestrator poll loop retrieves pending tickets and dispatches calls."""
    resp = await async_client.post("/api/orchestrator/poll")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "success"
    assert "dispatched_tickets" in data["results"]


@pytest.mark.asyncio
async def test_webhook_standard_call_completion(async_client):
    """Verify CALL-E completion webhook parsing structured result and updating ticket."""
    ticket_id = "TKT-311-TREE-3091"
    webhook_data = {
        "event_type": "call.completed",
        "call_id": "call_test_standard_001",
        "task": "Urban Forestry Triage",
        "phone_number": "+14155550312",
        "duration_seconds": 88,
        "transcript": "Agent: Verified tree limb over powerline. Caller: Confirmed. Agent: Scheduled bucket truck.",
        "structured_result": {
            "incident_confirmed": True,
            "updated_severity": "HIGH",
            "identified_hazards": ["Branch swaying over energized lines"],
            "verified_cross_street": "Skyline Blvd & Crestview Dr",
            "access_code_or_gate": "Gate 2 Code 4410",
            "department_escalation_needed": False,
            "target_escalation_department": None,
            "escalation_reason": None,
            "call_summary": "Confirmed tree limb hazard. Dispatched priority tree trimming team.",
            "action_items": ["Rig branch with crane", "Clear power lines"],
            "outcome": "CONFIRMED_HAZARD"
        },
        "metadata": {
            "ticket_id": ticket_id,
            "department": DepartmentEnum.FORESTRY_PARKS.value
        }
    }

    response = await async_client.post("/api/webhooks/calle", json=webhook_data)
    assert response.status_code == 200
    res = response.json()
    assert res["status"] == "completed"
    assert res["final_ticket_status"] == TicketStatus.FIELD_DISPATCHED.value

    # Verify Firestore state
    ticket = await db.get_ticket(ticket_id)
    assert ticket.status == TicketStatus.FIELD_DISPATCHED
    assert ticket.severity == TicketSeverity.HIGH
    assert len(ticket.audit_logs) >= 1
    assert ticket.audit_logs[-1].call_id == "call_test_standard_001"


@pytest.mark.asyncio
async def test_webhook_multi_agent_escalation(async_client):
    """Verify dynamic multi-agent escalation workflow when hazardous conditions require department handoff."""
    ticket_id = "TKT-311-WATER-4421"
    webhook_data = {
        "event_type": "call.completed",
        "call_id": "call_test_escalate_002",
        "task": "Water Main Triage",
        "phone_number": "+14155550244",
        "duration_seconds": 115,
        "transcript": "Agent: Water Department calling. Caller: Water has breached underground electrical vault with heavy arcing! Agent: Escalating immediately to Emergency Utility & Multi-Agency Dispatch.",
        "structured_result": {
            "incident_confirmed": True,
            "updated_severity": "CRITICAL_EMERGENCY",
            "identified_hazards": [
                "Water entering underground electrical transformer vault",
                "High voltage electrical arcing"
            ],
            "verified_cross_street": "Market St & 8th Street",
            "access_code_or_gate": "Vault Grate 14B",
            "department_escalation_needed": True,
            "target_escalation_department": "Emergency Utility & Multi-Agency Dispatch",
            "escalation_reason": "Water main breach flooding high voltage electrical substation vault.",
            "call_summary": "Critical electrical and water emergency. Escalated from Water to Multi-Agency Emergency Dispatch.",
            "action_items": [
                "Immediate grid de-energization",
                "Emergency water main isolation valve closure",
                "Police perimeter lockdown"
            ],
            "outcome": "ESCALATED_TO_DEPARTMENT"
        },
        "metadata": {
            "ticket_id": ticket_id,
            "department": DepartmentEnum.WATER_WASTEWATER.value
        }
    }

    response = await async_client.post("/api/webhooks/calle", json=webhook_data)
    assert response.status_code == 200
    res = response.json()
    assert res["status"] == "escalated"
    assert res["escalation"]["target_department"] == DepartmentEnum.EMERGENCY_UTILITY_DISPATCH.value
    assert res["escalation"]["secondary_call_id"] is not None

    # Verify Firestore state reflect escalation
    ticket = await db.get_ticket(ticket_id)
    assert ticket.status == TicketStatus.ESCALATED
    assert ticket.department == DepartmentEnum.EMERGENCY_UTILITY_DISPATCH
    assert ticket.severity == TicketSeverity.CRITICAL_EMERGENCY
    assert len(ticket.escalation_trail) >= 1
    assert "electrical substation vault" in ticket.escalation_trail[-1].reason


@pytest.mark.asyncio
async def test_full_simulation_endpoint(async_client):
    """Verify one-click end-to-end simulation endpoint for hackathon demo."""
    response = await async_client.post("/api/tickets/TKT-311-ROADS-8812/simulate-call?simulate_escalation=true")
    assert response.status_code == 200
    data = response.json()
    assert data["simulation_status"] == "SUCCESS"
    assert data["escalation_triggered"] is True
    assert data["final_ticket"]["status"] == TicketStatus.ESCALATED.value
