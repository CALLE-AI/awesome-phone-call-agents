from __future__ import annotations

import asyncio

import httpx


def test_health_endpoint_returns_ok() -> None:
    from app.main import app

    async def _get() -> httpx.Response:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=transport,
            base_url="http://testserver",
        ) as client:
            return await client.get("/health")

    response = asyncio.run(_get())
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
