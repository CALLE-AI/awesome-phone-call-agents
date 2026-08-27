import json
import threading
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import app
from store import Store


EXAMPLE = json.loads(
    (Path(__file__).parents[1] / "example_request.json").read_text(encoding="utf-8")
)


def call(base_url, path, method="GET", payload=None, headers=None):
    data = json.dumps(payload).encode() if payload is not None else None
    request = Request(
        base_url + path,
        data=data,
        method=method,
        headers={"Content-Type": "application/json", **(headers or {})},
    )
    try:
        with urlopen(request, timeout=5) as response:
            return response.status, json.loads(response.read())
    except HTTPError as error:
        return error.code, json.loads(error.read())


def test_web_case_simulation_dashboard_and_live_lock(tmp_path, monkeypatch):
    server = app.create_server(port=0, database_path=tmp_path / "test.sqlite3")
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base_url = f"http://127.0.0.1:{server.server_port}"
    try:
        status, health = call(base_url, "/health")
        assert status == 200 and health == {"status": "ok"}

        status, created = call(
            base_url, "/api/cases", method="POST", payload=EXAMPLE
        )
        assert status == 201
        assert EXAMPLE["phone"] not in json.dumps(created)

        status, attempt = call(
            base_url,
            f"/api/cases/{created['id']}/simulate",
            method="POST",
            payload={"scenario": "rebook"},
        )
        assert status == 200
        assert attempt["mode"] == "simulation"
        assert attempt["result"]["decision"]["route"] == "rebook"

        status, dashboard = call(base_url, "/api/cases")
        assert status == 200
        assert dashboard["cases"][0]["status"] == "ready"
        assert dashboard["cases"][0]["decision"] is None
        assert len(dashboard["attempts"]) == 1
        assert EXAMPLE["phone"] not in json.dumps(dashboard)

        monkeypatch.delenv("CALLE_LIVE_CALLS_ENABLED", raising=False)
        status, locked = call(
            base_url, f"/api/cases/{created['id']}/execute", method="POST"
        )
        assert status == 503
        assert "CALLE_LIVE_CALLS_ENABLED" in locked["detail"]
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def test_live_execution_claim_and_ambiguity_are_audited(tmp_path):
    store = Store(tmp_path / "audit.sqlite3")
    case = store.create_case(EXAMPLE)
    case_id = case["id"]

    assert store.claim_live_execution(case_id)
    assert not store.claim_live_execution(case_id)

    request = app.resolver.parse_request(EXAMPLE)
    simulation = app.resolver.simulated_result(request, "rebook")
    store.record_simulation_attempt(case_id, simulation)
    calling_case = store.get_case(case_id)
    assert calling_case["status"] == "calling"
    assert calling_case["decision"] is None
    assert not store.claim_live_execution(case_id)

    attempt_id = store.record_call_accepted(case_id, "call_accepted_001")
    store.record_live_ambiguity(
        case_id,
        attempt_id,
        "call_accepted_001",
        "TimeoutError",
    )

    audited_case = store.get_case(case_id)
    attempt = store.get_attempt(attempt_id)
    assert audited_case["status"] == "outcome_unknown"
    assert audited_case["decision"] == "escalate"
    assert not store.claim_live_execution(case_id)
    store.record_simulation_attempt(case_id, simulation)
    still_ambiguous = store.get_case(case_id)
    assert still_ambiguous["status"] == "outcome_unknown"
    assert still_ambiguous["decision"] == "escalate"
    assert not store.claim_live_execution(case_id)
    assert attempt["provider_call_id"] == "call_accepted_001"
    assert attempt["provider_status"] == "outcome_unknown"


def test_live_web_requires_loopback_and_bearer_auth(
    tmp_path, monkeypatch
):
    token = "a" * 32
    monkeypatch.setenv("CALLE_LIVE_CALLS_ENABLED", "true")
    monkeypatch.setenv("FRESHCHAIN_LIVE_TOKEN", token)

    try:
        app.create_server(
            host="0.0.0.0",
            port=0,
            database_path=tmp_path / "unsafe.sqlite3",
        )
    except ValueError as exc:
        assert "loopback" in str(exc)
    else:
        raise AssertionError("non-loopback live server was accepted")

    server = app.create_server(
        host="127.0.0.1",
        port=0,
        database_path=tmp_path / "authenticated.sqlite3",
    )
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base_url = f"http://127.0.0.1:{server.server_port}"
    try:
        status, denied = call(
            base_url, "/api/cases", method="POST", payload=EXAMPLE
        )
        assert status == 401
        assert denied["detail"] == "Bearer authentication required"

        auth = {"Authorization": f"Bearer {token}"}
        status, created = call(
            base_url,
            "/api/cases",
            method="POST",
            payload=EXAMPLE,
            headers=auth,
        )
        assert status == 201

        status, denied = call(
            base_url,
            f"/api/cases/{created['id']}/execute",
            method="POST",
        )
        assert status == 401

        status, missing_confirmation = call(
            base_url,
            f"/api/cases/{created['id']}/execute",
            method="POST",
            headers=auth,
        )
        assert status == 400
        assert "X-Confirm-Live-Call" in missing_confirmation["detail"]
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def test_live_web_requires_strong_token(tmp_path, monkeypatch):
    monkeypatch.setenv("CALLE_LIVE_CALLS_ENABLED", "true")
    monkeypatch.setenv("FRESHCHAIN_LIVE_TOKEN", "too-short")
    try:
        app.create_server(
            host="127.0.0.1",
            port=0,
            database_path=tmp_path / "weak-token.sqlite3",
        )
    except ValueError as exc:
        assert "at least 32 characters" in str(exc)
    else:
        raise AssertionError("weak live token was accepted")
