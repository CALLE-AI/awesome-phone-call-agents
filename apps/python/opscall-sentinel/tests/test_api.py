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

