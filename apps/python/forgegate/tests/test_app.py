import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import audit_log
from app import app

SCENARIOS_DIR = Path(__file__).resolve().parents[1] / "scenarios"


@pytest.fixture(autouse=True)
def isolated_log(tmp_path, monkeypatch):
    monkeypatch.setattr(audit_log, "LOG_DIR", tmp_path)
    monkeypatch.setattr(audit_log, "LOG_PATH", tmp_path / "audit_log.jsonl")
    monkeypatch.setattr(audit_log, "ACTIVITY_PATH", tmp_path / "activity_feed.jsonl")
    yield


@pytest.fixture
def client():
    return TestClient(app)


def load_scenario(name: str) -> dict:
    return json.loads((SCENARIOS_DIR / name).read_text(encoding="utf-8"))


def test_health_reports_dry_run(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["dry_run"] is True
    assert 0.0 < body["risk_threshold"] <= 1.0


def test_scenarios_endpoint_reflects_the_scenario_files_on_disk(client):
    resp = client.get("/scenarios")
    assert resp.status_code == 200
    scenarios = resp.json()["scenarios"]
    names = {s["name"] for s in scenarios}
    assert names == {
        "high_risk",
        "low_risk",
        "server_breach",
        "coolant_leak",
        "badge_tailgate",
        "routine_maintenance",
    }
    high_risk = next(s for s in scenarios if s["name"] == "high_risk")
    assert high_risk["payload"]["incident_id"] == "inc_001"


def test_dashboard_is_served_at_root(client):
    resp = client.get("/")
    assert resp.status_code == 200
    assert "ForgeGate" in resp.text


def test_low_risk_scenario_auto_clears_without_a_call(client):
    resp = client.post("/incident", json=load_scenario("low_risk.json"))
    body = resp.json()
    assert resp.status_code == 200
    assert body["action_state"] == "AUTO-CLEARED"
    assert body["call_placed"] is False

    trail = client.get("/incidents/inc_002").json()["entries"]
    assert len(trail) == 1
    assert trail[0]["action_state"] == "AUTO-CLEARED"
    assert trail[0]["call_id"] is None


def test_high_risk_scenario_triggers_call_and_holds_on_mocked_hold(client):
    resp = client.post("/incident", json=load_scenario("high_risk.json"))
    body = resp.json()
    assert resp.status_code == 200
    assert body["call_placed"] is True
    assert body["disposition"] == "HOLD"
    assert body["action_state"] == "HELD"
    assert body["call_id"].startswith("dryrun_")

    trail = client.get("/incidents/inc_001").json()["entries"]
    assert len(trail) == 1
    assert trail[0]["disposition"] == "HOLD"
    assert "task_text" in trail[0]
    assert "approve, hold, or escalate" in trail[0]["task_text"]


def test_duplicate_post_for_same_incident_does_not_place_a_second_call(client):
    first = client.post("/incident", json=load_scenario("high_risk.json")).json()
    second = client.post("/incident", json=load_scenario("high_risk.json")).json()

    assert first["call_placed"] is True
    assert second["call_placed"] is False
    assert second["call_id"] == first["call_id"]

    trail = client.get("/incidents/inc_001").json()["entries"]
    call_entries = [e for e in trail if e.get("call_id")]
    assert len(call_entries) == 1


def test_unknown_incident_id_returns_404(client):
    resp = client.get("/incidents/does_not_exist")
    assert resp.status_code == 404


def test_incidents_listing_includes_every_entry(client):
    client.post("/incident", json=load_scenario("high_risk.json"))
    client.post("/incident", json=load_scenario("low_risk.json"))

    entries = client.get("/incidents").json()["entries"]
    assert len(entries) == 2


def test_create_incident_critical_triggers_call(client):
    payload = {
        "incident_id": "INC-TEST-CRIT",
        "source": "ids_alert",
        "severity": "critical",
        "description": "SSH brute force on primary server",
        "proposed_action": "isolate host and block IP",
    }
    resp = client.post("/incident/create", json=payload)
    assert resp.status_code == 200
    body = resp.json()
    assert body["incident_id"] == "INC-TEST-CRIT"
    assert body["call_placed"] is True
    assert body["action_state"] == "HELD"

    entries = client.get("/incidents/INC-TEST-CRIT").json()["entries"]
    assert len(entries) == 1
    assert entries[0]["description"] == "SSH brute force on primary server"
    assert entries[0]["proposed_action"] == "isolate host and block IP"


def test_create_incident_low_auto_clears(client):
    payload = {
        "incident_id": "INC-TEST-LOW",
        "source": "routine_scanner",
        "severity": "low",
        "description": "Routine ping test",
        "proposed_action": "none",
    }
    resp = client.post("/incident/create", json=payload)
    assert resp.status_code == 200
    body = resp.json()
    assert body["incident_id"] == "INC-TEST-LOW"
    assert body["call_placed"] is False
    assert body["action_state"] == "AUTO-CLEARED"


def test_post_incident_action_escalate_and_discard(client):
    client.post("/incident", json=load_scenario("high_risk.json"))

    # Escalate
    resp = client.post(
        "/incident/inc_001/action",
        json={"action": "escalate", "reason": "escalating to CISO"},
    )
    assert resp.status_code == 200
    assert resp.json()["action_state"] == "ESCALATED"

    entries = client.get("/incidents/inc_001").json()["entries"]
    assert len(entries) == 2
    latest = entries[-1]
    assert latest["action_state"] == "ESCALATED"
    assert latest["post_action"] == "escalate"
    assert latest["post_action_reason"] == "escalating to CISO"
    # Ensure prior call details were preserved
    assert latest["call_id"].startswith("dryrun_")
    assert latest["disposition"] == "HOLD"

    # Discard
    resp_discard = client.post(
        "/incident/inc_001/action",
        json={"action": "discard", "reason": "false alarm confirmed"},
    )
    assert resp_discard.status_code == 200
    assert resp_discard.json()["action_state"] == "DISCARDED"


def test_post_incident_action_validations(client):
    # Invalid action
    resp = client.post(
        "/incident/inc_001/action",
        json={"action": "invalid_action"},
    )
    assert resp.status_code == 400

    # Non-existent incident
    resp = client.post(
        "/incident/non_existent/action",
        json={"action": "escalate"},
    )
    assert resp.status_code == 404


def test_get_incident_status(client):
    client.post("/incident", json=load_scenario("high_risk.json"))
    resp = client.get("/incidents/inc_001/status")
    assert resp.status_code == 200
    data = resp.json()
    assert data["incident_id"] == "inc_001"
    assert data["call_phase"] == "completed"
    assert data["entry"]["disposition"] == "HOLD"


def test_activity_feed_and_reset(client):
    client.post("/incident", json=load_scenario("high_risk.json"))
    feed_resp = client.get("/activity-feed")
    assert feed_resp.status_code == 200
    activities = feed_resp.json()["activities"]
    assert len(activities) > 0
    events = [a["event"] for a in activities]
    assert "risk_evaluated" in events
    assert "call_dispatched" in events

    # Reset
    reset_resp = client.post("/reset")
    assert reset_resp.status_code == 200
    assert reset_resp.json()["status"] == "ok"

    # Verify audit log and feed are cleared
    assert client.get("/incidents").json()["entries"] == []
    assert client.get("/activity-feed").json()["activities"] == []
