import json
import threading
import time
import urllib.request
from http.client import HTTPResponse
from pathlib import Path

import pytest

from ringfence.decide import ESCALATE_TO_HUMAN
from ringfence.verify_call import DIALED, PREVIEWED
from ringfence.webhook import CaseStore, create_server, handle_get, handle_submit
from ringfence.verify_call import SecurityEventLog, resolve_dial_target
from ringfence.case import Case

_ON_FILE = "+14155550101"
_SMUGGLED = "+14155559999"


def _case_payload(**overrides) -> dict:
    payload = dict(
        case_id="case_wh_001",
        account_holder_name="Pat Rivera",
        on_file_phone=_ON_FILE,
        claimed_transaction_amount="4500.00",
        claimed_recipient="Jordan Rivera",
        claimed_payment_method="wire",
        request_supplied_callback_number=None,
    )
    payload.update(overrides)
    return payload


class _FakeCalls:
    def __init__(self, structured_result: dict | None = None):
        self.create_and_wait_calls = 0
        self._structured_result = structured_result or {}

    def create_and_wait(self, **kwargs):
        self.create_and_wait_calls += 1
        return {"id": f"call_fake_{self.create_and_wait_calls}"}

    def get(self, call_id: str):
        return {
            "id": call_id,
            "status": "completed",
            "task_completed": True,
            "structured_result": self._structured_result,
            "recipients": [
                {
                    "attempts": [
                        {
                            "started_at": "2026-09-10T00:00:00Z",
                            "completed_at": "2026-09-10T00:01:00Z",
                            "transcript_turns": [{"speaker": "bot", "text": "hi"}],
                        }
                    ]
                }
            ],
        }

    def list_events(self, call_id: str):
        return {"data": []}


class _FakeClient:
    def __init__(self, structured_result: dict | None = None):
        self.calls = _FakeCalls(structured_result)


# ---- pure handle_submit/handle_get, no HTTP ----


@pytest.mark.parametrize("host", ["0.0.0.0", "::", "192.0.2.10", "public.example"])
def test_live_webhook_refuses_non_loopback_before_opening_socket(host, monkeypatch):
    def unexpected_server(*args, **kwargs):
        raise AssertionError("must reject the bind before constructing an HTTP server")

    monkeypatch.setattr("ringfence.webhook.ThreadingHTTPServer", unexpected_server)
    with pytest.raises(ValueError, match="loopback-only"):
        create_server(host=host, live=True)


@pytest.mark.parametrize("host", ["127.0.0.1", "localhost", "::1"])
def test_live_webhook_accepts_loopback_without_opening_socket(host, monkeypatch):
    marker = object()
    monkeypatch.setattr("ringfence.webhook.ThreadingHTTPServer", lambda *args: marker)
    assert create_server(host=host, live=True) is marker


def test_post_case_dry_run_never_dials_and_status_is_previewed(tmp_path: Path):
    store = CaseStore()
    log = SecurityEventLog(tmp_path / "security_events.jsonl")
    status, payload = handle_submit(
        store, _case_payload(), live=False, security_log=log, client_factory=None
    )
    assert status == 201
    assert payload["status"] == PREVIEWED
    assert payload["call_id"] is None
    assert payload["disposition"] is None


def test_get_unknown_case_id_is_404():
    store = CaseStore()
    status, payload = handle_get(store, "does_not_exist")
    assert status == 404
    assert payload["error"] == "not_found"


def test_resubmitting_same_case_id_never_places_a_second_call(tmp_path: Path):
    store = CaseStore()
    log = SecurityEventLog(tmp_path / "security_events.jsonl")
    fake_client = _FakeClient()

    status1, payload1 = handle_submit(
        store, _case_payload(), live=True, security_log=log, client_factory=lambda: fake_client
    )
    status2, payload2 = handle_submit(
        store, _case_payload(), live=True, security_log=log, client_factory=lambda: fake_client
    )

    assert status1 == 201
    assert status2 == 200  # returned the existing record, not a new dial
    assert payload1["call_id"] == payload2["call_id"]
    assert fake_client.calls.create_and_wait_calls == 1


def test_smuggled_callback_number_is_never_dialed_through_the_webhook(tmp_path: Path):
    store = CaseStore()
    log = SecurityEventLog(tmp_path / "security_events.jsonl")
    fake_client = _FakeClient()

    case_data = _case_payload(request_supplied_callback_number=_SMUGGLED)
    status, payload = handle_submit(
        store, case_data, live=True, security_log=log, client_factory=lambda: fake_client
    )

    assert status == 201
    assert payload["dialed_phone_masked"] != None  # noqa: E711 - explicit presence check
    assert _SMUGGLED not in json.dumps(payload)
    # The webhook never re-implements the invariant: prove independently
    # that resolve_dial_target (the one real implementation) agrees.
    case = Case.from_dict(case_data)
    assert resolve_dial_target(case) == _ON_FILE
    # A security event was logged for the smuggled number, same as the CLI path.
    logged = log.path.read_text(encoding="utf-8")
    assert "rejected_request_supplied_callback_number" in logged
    assert _SMUGGLED not in logged
    assert _ON_FILE not in logged


def test_live_call_completion_resolves_and_stores_disposition(tmp_path: Path):
    store = CaseStore()
    log = SecurityEventLog(tmp_path / "security_events.jsonl")
    clean_signals = {
        "secrecy_demand_present": False,
        "urgency_pressure_present": False,
        "relationship_explained": True,
        "irreversible_payment_demanded": False,
        "explicit_hold_requested": False,
    }
    fake_client = _FakeClient(structured_result=clean_signals)

    status, payload = handle_submit(
        store, _case_payload(), live=True, security_log=log, client_factory=lambda: fake_client
    )
    assert status == 201
    assert payload["disposition"] == "ADVISE_ALLOW"

    _, fetched = handle_get(store, "case_wh_001")
    assert fetched["disposition"] == "ADVISE_ALLOW"

    # An institution reading this response must be told, in the response
    # itself, that it is a recommendation pending human review -- not an
    # instruction to release the transaction.
    for record in (payload, fetched):
        assert record["advisory"] is True
        assert record["requires_human_review"] is True


def test_live_call_error_escalates_rather_than_leaving_disposition_null(tmp_path: Path):
    store = CaseStore()
    log = SecurityEventLog(tmp_path / "security_events.jsonl")

    class _FailingCalls:
        def create_and_wait(self, **kwargs):
            raise RuntimeError("simulated CALL-E API failure")

    class _FailingClient:
        calls = _FailingCalls()

    status, payload = handle_submit(
        store, _case_payload(), live=True, security_log=log, client_factory=lambda: _FailingClient()
    )
    assert status == 201
    assert payload["disposition"] == ESCALATE_TO_HUMAN
    assert "call_error" in payload["outcome"]

    _, fetched = handle_get(store, "case_wh_001")
    assert fetched["disposition"] == ESCALATE_TO_HUMAN


def test_dialed_with_no_call_id_escalates_rather_than_crashing(tmp_path: Path):
    store = CaseStore()
    log = SecurityEventLog(tmp_path / "security_events.jsonl")

    class _NoIdCalls:
        def create_and_wait(self, **kwargs):
            return {}  # no "id" field, matching CALL-E's undocumented response shape

        def get(self, call_id):
            raise AssertionError("must not be called when call_id is missing")

    class _NoIdClient:
        calls = _NoIdCalls()

    status, payload = handle_submit(
        store, _case_payload(), live=True, security_log=log, client_factory=lambda: _NoIdClient()
    )
    assert status == 201
    assert payload["disposition"] == ESCALATE_TO_HUMAN
    assert payload["call_id"] is None


def test_concurrent_identical_submissions_place_only_one_call(tmp_path: Path):
    store = CaseStore()
    log = SecurityEventLog(tmp_path / "security_events.jsonl")

    class _SlowCalls:
        def __init__(self):
            self.create_and_wait_calls = 0

        def create_and_wait(self, **kwargs):
            self.create_and_wait_calls += 1
            time.sleep(0.05)  # widen the race window
            return {"id": "call_fake_1"}

        def get(self, call_id):
            return {"id": call_id, "status": "completed", "task_completed": True,
                     "structured_result": {}, "recipients": []}

        def list_events(self, call_id):
            return {"data": []}

    class _SlowClient:
        def __init__(self, calls):
            self.calls = calls

    fake_calls = _SlowCalls()
    results: list[tuple[int, dict]] = []

    def submit():
        results.append(
            handle_submit(
                store, _case_payload(), live=True, security_log=log,
                client_factory=lambda: _SlowClient(fake_calls),
            )
        )

    threads = [threading.Thread(target=submit) for _ in range(5)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=5)

    assert fake_calls.create_and_wait_calls == 1
    statuses = sorted(status for status, _ in results)
    assert statuses == [200, 200, 200, 200, 201]


# ---- real HTTP round-trip over a bound socket ----


def _request(conn_url: str, method: str, path: str, body: dict | None = None) -> tuple[int, dict]:
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(f"{conn_url}{path}", data=data, method=method)
    if data is not None:
        req.add_header("Content-Type", "application/json")
    try:
        resp: HTTPResponse = urllib.request.urlopen(req, timeout=5)
        return resp.status, json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        return exc.code, json.loads(exc.read().decode("utf-8"))


def test_http_round_trip_post_then_get(tmp_path: Path):
    server = create_server(
        host="127.0.0.1", port=0, live=False, security_log_path=tmp_path / "security_events.jsonl"
    )
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        base = f"http://127.0.0.1:{server.server_address[1]}"
        status, payload = _request(base, "POST", "/cases", _case_payload(case_id="case_http_001"))
        assert status == 201
        assert payload["status"] == PREVIEWED

        status, payload = _request(base, "GET", "/cases/case_http_001")
        assert status == 200
        assert payload["case_id"] == "case_http_001"

        status, payload = _request(base, "GET", "/cases/does_not_exist")
        assert status == 404
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
