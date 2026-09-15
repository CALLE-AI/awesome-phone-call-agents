import sys
import os
import json
import pytest

# Ensure project root directory is in sys.path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import config
config.MOCK_MODE = True
config.CALL_TIMEOUT_SECONDS = 0.1


from app import app
from database import Base, get_db, Lead


# In-memory SQLite Database for testing
SQLALCHEMY_DATABASE_URL = "sqlite:///./test_leads.db"

engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Override FastAPI get_db dependency
def override_get_db():
    try:
        db = TestingSessionLocal()
        yield db
    finally:
        db.close()

app.dependency_overrides[get_db] = override_get_db

@pytest.fixture(scope="module", autouse=True)
def setup_db():
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)

client = TestClient(app)

def test_create_lead():
    payload = {
        "name": "Bruce Wayne",
        "phone": "+155512345",
        "company": "Wayne Enterprises",
        "product_interest": "AI Customer Support Agent"
    }
    response = client.post("/api/leads", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "Bruce Wayne"
    assert data["phone"] == "+155512345"
    assert data["company"] == "Wayne Enterprises"
    assert data["product_interest"] == "AI Customer Support Agent"
    assert data["status"] == "calling"
    assert "call_mock_" in data["call_id"]

def test_list_leads():
    response = client.get("/api/leads")
    assert response.status_code == 200
    data = response.json()
    assert len(data) >= 1
    assert data[0]["name"] == "Bruce Wayne"

def test_get_single_lead():
    # First get list to find the ID
    response = client.get("/api/leads")
    lead_id = response.json()[0]["id"]
    
    response = client.get(f"/api/leads/{lead_id}")
    assert response.status_code == 200
    assert response.json()["name"] == "Bruce Wayne"

def test_get_nonexistent_lead():
    response = client.get("/api/leads/9999")
    assert response.status_code == 404

def test_webhook_id_mismatch():
    # Test that webhook endpoint rejects requests with event ID headers that don't match the body ID
    payload = {
        "id": "evt_abc123",
        "type": "call.completed",
        "created_at": "2026-08-05T12:00:00Z",
        "data": {
            "id": "call_mock_123",
            "status": "completed"
        }
    }
    # No header header or mismatched header should return 400
    headers = {"CALL-E-Event-Id": "evt_mismatch"}
    response = client.post("/api/webhook", json=payload, headers=headers)
    assert response.status_code == 400
    assert response.json()["detail"] == "Event ID signature verification failed"

def test_delete_lead():
    # Create a dummy lead to delete
    create_res = client.post("/api/leads", json={"name": "Temp Lead", "phone": "+1555999"})
    lead_id = create_res.json()["id"]
    
    # Delete the lead
    delete_response = client.delete(f"/api/leads/{lead_id}")
    assert delete_response.status_code == 200
    assert delete_response.json()["ok"] is True
    
    # Check that retrieving it now returns 404
    get_response = client.get(f"/api/leads/{lead_id}")
    assert get_response.status_code == 404

def test_redial_lead():
    create_res = client.post("/api/leads", json={"name": "Clark Kent", "phone": "+1555888"})
    lead_id = create_res.json()["id"]
    
    redial_res = client.post(f"/api/leads/{lead_id}/redial")
    assert redial_res.status_code == 200
    assert redial_res.json()["status"] == "calling"

def test_system_status():
    res = client.get("/api/system/status")
    assert res.status_code == 200
    assert "mock_mode" in res.json()

def test_clear_all_leads():
    res = client.delete("/api/leads")
    assert res.status_code == 200
    assert res.json()["ok"] is True


