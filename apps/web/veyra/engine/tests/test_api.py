import asyncio

from httpx import ASGITransport, AsyncClient

from app.config import settings
from app.main import app
from app.sample_workflow import SAMPLE_WORKFLOW


async def _request(method: str, path: str, *, json: dict | None = None):
    headers = (
        {"authorization": f"Bearer {settings.shared_secret}"} if settings.shared_secret else {}
    )
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://testserver",
        headers=headers,
    ) as client:
        return await client.request(method, path, json=json)


def request(method: str, path: str, *, json: dict | None = None):
    """Use HTTPX's native ASGI transport without TestClient's deprecated thread portal."""
    return asyncio.run(_request(method, path, json=json))


def test_health():
    assert request("GET", "/health").json() == {"status": "ok"}


def test_validate_sample_workflow():
    response = request(
        "POST", "/workflows/validate", json={"workflow": SAMPLE_WORKFLOW.model_dump(by_alias=True)}
    )
    assert response.status_code == 200
    body = response.json()
    assert body["valid"] is True
    assert body["errors"] == []


def test_validate_rejects_malformed_workflow():
    response = request("POST", "/workflows/validate", json={"workflow": {"goal": "x"}})
    assert response.status_code == 422


def test_compile_sample_workflow():
    response = request(
        "POST",
        "/workflows/compile",
        json={
            "workflow": SAMPLE_WORKFLOW.model_dump(by_alias=True),
            "campaign_id": "campaign-1",
            "contact": {"id": "c1", "name": "Jordan Lee", "phoneNumber": "+14155550100"},
            "webhook_url": "https://example.com/api/calle/webhook",
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["metadata"] == {"campaignId": "campaign-1", "contactId": "c1"}
    assert "Jordan Lee" in body["task"]
    assert body["result_schema"]["type"] == "object"
