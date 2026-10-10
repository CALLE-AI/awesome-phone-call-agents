"""API integration tests for OrderShield FastAPI server."""

import pytest
from fastapi.testclient import TestClient
from src.server import app

client = TestClient(app)


def test_dashboard_endpoint():
    res = client.get("/")
    assert res.status_code == 200
    assert "OrderShield AI" in res.text
    assert "CALL-E PSTN LIVE" in res.text


def test_metrics_endpoint():
    res = client.get("/api/v1/metrics")
    assert res.status_code == 200
    data = res.json()
    assert "total_orders" in data
    assert "shipping_fees_saved_inr" in data
    assert "latest_sha256_audit_seal" in data


def test_orders_list():
    res = client.get("/api/v1/orders")
    assert res.status_code == 200
    orders = res.json()
    assert len(orders) >= 3
    assert any(o["order_id"] == "ORD-8491" for o in orders)


def test_verify_order_endpoint():
    res = client.post("/api/v1/orders/ORD-8491/verify?scenario=confirm")
    assert res.status_code == 200
    data = res.json()
    assert data["success"] is True
    assert data["status"] == "VERIFIED_DISPATCHED"
    assert data["result"]["verified"] is True
