import pytest
from httpx import AsyncClient, ASGITransport
from src.server import app


@pytest.mark.asyncio
async def test_get_dashboard():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        res = await ac.get("/")
    assert res.status_code == 200
    assert "OpsCall Sentinel" in res.text


@pytest.mark.asyncio
async def test_get_telemetry():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        res = await ac.get("/api/v1/telemetry")
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "healthy"
    assert "calle_mode" in data


@pytest.mark.asyncio
async def test_list_incidents():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        res = await ac.get("/api/v1/incidents")
    assert res.status_code == 200
    incidents = res.json()
    assert isinstance(incidents, list)
    assert len(incidents) >= 1  # seeded incident from startup


@pytest.mark.asyncio
async def test_simulate_alert():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        payload = {
            "service": "test-cache",
            "severity": "P0",
            "title": "Redis cluster degraded",
            "description": "Cache misses spiked to 90%"
        }
        res = await ac.post("/api/v1/alerts/simulate", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert data["alert"]["service"] == "test-cache"
    assert data["state"] == "OWNERSHIP_ESTABLISHED"
    assert data["owner"] == "Alex Vance (Primary On-Call SRE)"
    assert len(data["calls"]) >= 1


@pytest.mark.asyncio
async def test_simulate_escalation_alert():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        payload = {
            "service": "auth-cluster",
            "severity": "P0",
            "title": "Auth token cluster failure",
            "description": "Token verification unresponsive",
            "mode": "escalate"
        }
        res = await ac.post("/api/v1/alerts/simulate", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert data["state"] == "OWNERSHIP_ESTABLISHED"
    assert data["owner"] == "Elena Rostova (Secondary On-Call SRE)"
    assert data["escalation_level"] == 2
    assert len(data["calls"]) == 2


@pytest.mark.asyncio
async def test_crm_orders_and_verification():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        res = await ac.get("/api/v1/crm/orders")
        assert res.status_code == 200
        orders = res.json()
        assert len(orders) >= 3

        # Verify an order
        verify_res = await ac.post("/api/v1/crm/orders/ORD-94021/verify?action=confirm")
        assert verify_res.status_code == 200
        data = verify_res.json()
        assert data["success"] is True
        assert data["order"]["status"] == "VERIFIED_DISPATCHED"


@pytest.mark.asyncio
async def test_crm_appointments_and_reminder():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        res = await ac.get("/api/v1/crm/appointments")
        assert res.status_code == 200
        appts = res.json()
        assert len(appts) >= 2

        # Remind an appointment
        remind_res = await ac.post("/api/v1/crm/appointments/APT-7014/remind")
        assert remind_res.status_code == 200
        data = remind_res.json()
        assert data["success"] is True
        assert data["appointment"]["status"] == "CONFIRMED_BY_PATIENT"


@pytest.mark.asyncio
async def test_multi_tenant_registry_and_dispatch():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        # 1. List existing seeded tenants
        res = await ac.get("/api/v1/tenants")
        assert res.status_code == 200
        tenants = res.json()
        assert len(tenants) >= 3

        # 2. Register a new custom tenant
        new_tenant = {
            "tenant_id": "tenant-test-agency",
            "client_name": "Apex Marketing Agency",
            "vertical": "leadgen",
            "voice_agent_prompt": "Qualify inbound B2B lead.",
            "crm_type": "twenty",
            "webhook_callback_url": "http://n8n.internal:5678/webhook/lead-feedback"
        }
        reg_res = await ac.post("/api/v1/tenants", json=new_tenant)
        assert reg_res.status_code == 200
        assert reg_res.json()["client_name"] == "Apex Marketing Agency"

        # 3. Dispatch a lead call for this tenant (mimicking n8n node call)
        dispatch_req = {
            "tenant_id": "tenant-test-agency",
            "customer_name": "Karan Malhotra",
            "customer_phone": "+91 98111 22334",
            "context": {"budget": "$10k/mo", "urgency": "immediate"}
        }
        disp_res = await ac.post("/api/v1/tenants/tenant-test-agency/dispatch", json=dispatch_req)
        assert disp_res.status_code == 200
        disp_data = disp_res.json()
        assert disp_data["success"] is True
        assert disp_data["callee"] == "Karan Malhotra"
        assert "call_leadgen_" in disp_data["task_id"]


@pytest.mark.asyncio
async def test_crm_prospect_call():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        payload = {"name": "Test Prospect", "phone": "+91 99999 88888", "vertical": "ecommerce"}
        res = await ac.post("/api/v1/crm/prospect-call", json=payload)
        assert res.status_code == 200
        data = res.json()
        assert data["success"] is True
        assert "call_demo_" in data["task_id"]


