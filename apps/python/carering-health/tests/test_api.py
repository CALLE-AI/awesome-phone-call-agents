"""API integration tests for CareRing Health FastAPI server."""

import pytest
from fastapi.testclient import TestClient
from src.server import app

client = TestClient(app)


def test_dashboard_endpoint():
    res = client.get("/")
    assert res.status_code == 200
    assert "CareRing Health" in res.text
    assert "CALL-E CLINICAL VOIP" in res.text


def test_metrics_endpoint():
    res = client.get("/api/v1/metrics")
    assert res.status_code == 200
    data = res.json()
    assert "total_patients_monitored" in data
    assert "adherence_rate_pct" in data
    assert "latest_sha256_audit_seal" in data


def test_patients_list():
    res = client.get("/api/v1/patients")
    assert res.status_code == 200
    patients = res.json()
    assert len(patients) >= 3
    assert any(p["patient_id"] == "PAT-4081" for p in patients)


def test_triage_endpoint():
    res = client.post("/api/v1/patients/PAT-4081/triage?scenario=normal")
    assert res.status_code == 200
    data = res.json()
    assert data["success"] is True
    assert data["triage_level"] == "NORMAL"
    assert data["result"]["escalate_to_nurse"] is False
