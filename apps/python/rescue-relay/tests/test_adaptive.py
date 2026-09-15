import asyncio
import copy
import json
import time
from types import SimpleNamespace

import pytest
import app as relay
import calling
from coordinator import Coordinator, PlannerUnavailable

REPORT = {"expected_outcome": "Safely rescue the dog and transport it to an accepting veterinary team for assessment.", "animal_type": "dog", "goal_confirmed": True, "summary": "A dog is beside a service lane, cannot put weight on its back leg, and moves away when approached.", "location": "Fictional blue shop on Example Road"}


def incident(client, **changes):
    result = client.post("/api/incidents", json={**REPORT, **changes})
    assert result.status_code == 201, result.text
    return result.json()["id"]


def wait(client, run_id):
    for _ in range(500):
        data = client.get(f"/api/runs/{run_id}").json()
        if data["status"] not in {"queued", "running"}:
            return data
        time.sleep(.01)
    pytest.fail("Run did not terminate")


def start(client, scenario="success", ident=None):
    ident = ident or incident(client)
    for c in client.get("/api/businesses").json():
        body = {k: c[k] for k in ("name", "description", "consent_to_contact", "capabilities", "simulation")}
        changed = False
        if scenario == "one_contact" and c["id"] == "biz_street_team":
            body["capabilities"].append("receiving_care"); changed = True
        if scenario in {"gap", "conditional"} and c["id"] == "biz_paws":
            body["simulation"]["response"] = "declines" if scenario == "gap" else "conditional"
            body["simulation"]["conditions"] = "Waiting for manager approval"; changed = True
        if scenario == "no_answer":
            body["simulation"]["response"] = "no_answer"; changed = True
        if changed:
            assert client.patch(f"/api/businesses/{c['id']}", json=body).status_code == 200
    response = client.post(f"/api/incidents/{ident}/coordinate", json={})
    assert response.status_code == 202, response.text
    return wait(client, response.json()["run_id"])


@pytest.mark.parametrize("scenario,status,calls,covered", [
    ("success", "covered", 2, 3), ("one_contact", "covered", 1, 3),
    ("gap", "partial", 2, 2), ("conditional", "partial", 2, 2), ("no_answer", "partial", 2, 0),
])
def test_scenarios(client, scenario, status, calls, covered):
    run = start(client, scenario)
    assert run["status"] == status, run.get("error")
    assert run["calls_made"] == calls
    assert run["plan"]["covered_count"] == covered
    assert run["plan"]["total_count"] == 3
    assert run["planner"]["mode"] == "rules"
    assert all(c["analysis"] is not None for c in run["calls"])
    assert all(c["evidence"]["simulated"] for c in run["calls"])


def test_calls_sequential_gaps_only_and_stop(client):
    run = start(client)
    assert [c["business_id"] for c in run["calls"]] == ["biz_street_team", "biz_paws"]
    assert run["calls"][1]["target_needs"] == ["receiving_care"]
    assert run["uncalled_count"] == 1
    events = [e["type"] for e in run["events"]]
    first_analyzed = events.index("coverage")
    second_called = events.index("calling", events.index("calling") + 1)
    assert first_analyzed < second_called
    assert run["calls"][0]["updated_at"] <= run["calls"][1]["created_at"]
    assert run["plan"]["helpers_count"] == 2


def test_covered_plan_is_not_rescue_completion(client):
    run = start(client)
    export = client.get(f"/api/runs/{run['id']}/export").json()
    assert export["live_call_performed"] is False
    assert "not proof of completed rescue" in export["note"]
    assert REPORT["location"] not in json.dumps(export)
    assert "Paws & Care" not in json.dumps(export)
    assert "+12025550101" not in json.dumps(export)


def test_conditional_does_not_go_green(client):
    run = start(client, "conditional")
    receiving = next(n for n in run["plan"]["requirements"] if n["id"] == "receiving_care")
    assert receiving["status"] == "conditional"
    assert receiving["assignment"] is None
    assert receiving["offers"][0]["conditions"]


def test_report_interpretation_not_identical_for_every_incident(client):
    contained = incident(client, summary="The injured dog is already contained in a carrier and needs someone to collect it.")
    run = start(client, ident=contained)
    assert {n["id"] for n in run["definition"]["requirements"]} == {"transport", "receiving_care"}
    assert run["plan"]["complete"]


def test_unknown_specialist_need_remains_uncovered(client):
    trapped = incident(client, summary="A dog is trapped down a drain and cannot climb out. It appears alert.")
    run = start(client, ident=trapped)
    assert run["status"] == "partial"
    assert "specialist_access" in [n["id"] for n in run["plan"]["requirements"] if n["status"] != "covered"]


def test_unapproved_contacts_are_not_called(client):
    contact = next(c for c in client.get("/api/businesses").json() if c["id"] == "biz_street_team")
    response = client.patch("/api/businesses/biz_street_team", json={"name": contact["name"], "description": contact["description"], "consent_to_contact": False})
    assert response.status_code == 200
    run = start(client)
    assert "biz_street_team" not in [c["business_id"] for c in run["calls"]]
    assert run["status"] == "partial"


def test_no_approved_contacts_gives_actionable_error(client):
    for c in client.get("/api/businesses").json():
        client.delete(f"/api/businesses/{c['id']}")
    ident = incident(client)
    response = client.post(f"/api/incidents/{ident}/coordinate", json={})
    assert response.status_code == 409
    assert "approved trusted contact" in response.json()["detail"]


def test_contact_crud_phone_masks_and_duplicates(client):
    body = {"name": "Full response", "phone": "+12025550199", "description": "Full rescue team with a vehicle and veterinary receiving clinic.", "consent_to_contact": True}
    added = client.post("/api/businesses", json=body)
    assert added.status_code == 201
    assert "phone" not in added.json()
    assert added.json()["masked_phone"].endswith("0199")
    assert client.post("/api/businesses", json=body).status_code == 409
    ident = added.json()["id"]
    result = client.patch(f"/api/businesses/{ident}", json={"name": "Updated", "description": body["description"], "phone": None, "consent_to_contact": True})
    assert result.status_code == 200
    assert result.json()["masked_phone"] == added.json()["masked_phone"]
    assert client.delete(f"/api/businesses/{ident}").status_code == 204


def test_live_disabled_and_explicit_confirm_required(client, monkeypatch):
    ident = incident(client)
    assert client.post(f"/api/incidents/{ident}/coordinate", json={"mode": "live", "confirm_live": True}).status_code == 422
    monkeypatch.setattr(relay, "CALL_MODE", "live")
    monkeypatch.setattr(relay, "ENABLE_LIVE_CALLS", True)
    monkeypatch.setattr(relay, "CALLE_API_KEY", "test-key")
    monkeypatch.setattr(relay.planner, "enabled", True)
    assert client.post(f"/api/incidents/{ident}/coordinate", json={"mode": "live"}).status_code == 422
    assert client.post(f"/api/incidents/{ident}/coordinate", json={"mode": "live", "confirm_live": True}).status_code == 409  # demo destinations excluded


def test_no_env_number_list_or_operator_session_in_config(client):
    c = client.get("/api/config").json()
    assert not any("operator" in key or "authorized_number" in key for key in c)
    assert c["default_mode"] == "mock"
    assert c["default_currency"] == "USD"


def test_cross_origin_changes_blocked(client):
    response = client.post("/api/incidents", json=REPORT, headers={"Origin": "https://attacker.invalid"})
    assert response.status_code == 403
    assert not client.get("/api/incidents").json()


def test_live_host_restriction(client, monkeypatch):
    monkeypatch.setattr(relay, "CALL_MODE", "live")
    response = client.get("/api/businesses", headers={"host": "public.invalid"})
    assert response.status_code == 403


def test_duplicate_run_is_blocked(client, monkeypatch):
    monkeypatch.setattr(calling, "MOCK_DELAY_SECONDS", .15)
    ident = incident(client)
    first = client.post(f"/api/incidents/{ident}/coordinate", json={})
    assert first.status_code == 202
    second = client.post(f"/api/incidents/{ident}/coordinate", json={})
    assert second.status_code == 409
    wait(client, first.json()["run_id"])


def test_stop_blocks_next_call_but_keeps_first_evidence(client, monkeypatch):
    monkeypatch.setattr(calling, "MOCK_DELAY_SECONDS", .15)
    ident = incident(client)
    rid = client.post(f"/api/incidents/{ident}/coordinate", json={}).json()["run_id"]
    for _ in range(100):
        if client.get(f"/api/runs/{rid}").json()["calls"]:
            break
        time.sleep(.005)
    assert client.post(f"/api/runs/{rid}/stop").status_code == 200
    run = wait(client, rid)
    assert run["status"] == "stopped"
    assert run["calls_made"] == 1
    assert run["calls"][0]["analysis"]


def test_archive_rechecked_before_next_call(client, monkeypatch):
    monkeypatch.setattr(calling, "MOCK_DELAY_SECONDS", .15)
    ident = incident(client)
    rid = client.post(f"/api/incidents/{ident}/coordinate", json={}).json()["run_id"]
    for _ in range(100):
        if client.get(f"/api/runs/{rid}").json()["calls"]:
            break
        time.sleep(.005)
    client.delete("/api/businesses/biz_paws")
    run = wait(client, rid)
    assert run["calls_made"] == 1
    assert run["status"] == "partial"


def test_llm_required_has_no_silent_demo_fallback(client, monkeypatch):
    monkeypatch.setattr(relay.planner, "required", True)
    run = start(client)
    assert run["status"] == "failed"
    assert run["calls_made"] == 0
    assert "LLM_MODE=required" in run["error"]


def test_analysis_failure_stops_before_next_contact(client, monkeypatch):
    async def fail(*args, **kwargs):
        raise PlannerUnavailable("Transcript analysis failed. No next call.")
    monkeypatch.setattr(relay.planner, "analyze", fail)
    run = start(client)
    assert run["status"] == "failed"
    assert run["calls_made"] == 1
    assert run["calls"][0]["evidence"]["transcript"]


def test_call_limit_is_enforced(client, monkeypatch):
    monkeypatch.setattr(relay, "MAX_CONTACTS", 1)
    run = start(client)
    assert run["status"] == "partial" and run["calls_made"] == 1


def test_saved_report_reload(client):
    run = start(client)
    data = client.get(f"/api/incidents/{run['incident_id']}").json()
    assert data["latest_run"]["id"] == run["id"]
    assert data["latest_run"]["plan"]["complete"]


class FakeOpenAI:
    """SDK-shaped test double. Does not claim real model inference or network access."""
    requests = []
    definition = {"goal": "Get the dog to a confirmed receiving centre.", "requirements": [
        {"id": "safe_containment", "label": "Safe containment", "reason": "The dog moves away."},
        {"id": "transport", "label": "Transport", "reason": "The dog cannot walk normally."},
        {"id": "receiving_care", "label": "Receiving care", "reason": "A destination must accept the animal."}], "uncertainties": []}
    def __init__(self, **kwargs):
        self.chat = SimpleNamespace(completions=self)
    async def __aenter__(self):
        return self
    async def __aexit__(self, *args):
        pass
    async def create(self, **kwargs):
        payload = json.loads(kwargs["messages"][1]["content"])
        self.requests.append(payload)
        data = payload["data"]
        if payload["phase"] == "incident analysis":
            result = self.definition
        elif payload["phase"] == "next-contact selection":
            ids = {c["id"] for c in data["candidates"]}
            target = "biz_street_team" if "biz_street_team" in ids else "biz_paws" if "biz_paws" in ids else None
            result = {"contact_id": target, "reason": "This contact can fill the missing needs."}
        elif payload["phase"] == "conversation simulation":
            result = {"transcript": data["reference_script"]}
        else:
            s = data["completed_call"]["structured_result"]
            result = {"recipient_confirmed": s["recipient_confirmed"], "identity_quote": s["identity_quote"],
                      "summary": s["offer_summary"], "assessments": s["assessments"], "new_requirements": [], "next_step": "Check coverage."}
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=json.dumps(result)))])


def test_openai_adapter_path_analyzes_transcripts_between_calls(client, monkeypatch):
    FakeOpenAI.requests = []
    monkeypatch.setattr(relay.planner, "enabled", True)
    monkeypatch.setattr(relay.planner, "client_factory", FakeOpenAI)
    run = start(client)
    assert run["status"] == "covered", run["error"]
    phases = [r["phase"] for r in FakeOpenAI.requests]
    assert phases == ["incident analysis", "next-contact selection", "conversation simulation", "transcript analysis", "next-contact selection", "conversation simulation", "transcript analysis"]
    assert all(r["data"]["completed_call"]["transcript"] for r in FakeOpenAI.requests if r["phase"] == "transcript analysis")
    second_choice = FakeOpenAI.requests[4]["data"]
    assert second_choice["coverage"]["covered_count"] == 2
    assert second_choice["previous_call_analyses"]
    assert not any("phone" in c for c in second_choice["candidates"])
