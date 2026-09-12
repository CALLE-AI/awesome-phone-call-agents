"""Live HTTP contract tests with an in-process CALL-E double.

The live branch is exercised through the same ``pipeline.resolve`` used by
the fake branch. The provider client is replaced in every test that can
reach it, so this module never contacts the real CALL-E host.
"""

from __future__ import annotations

import json
import threading
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import pytest

from api.server import REAL_API_BASE_URL
from client import CallEAPIError, CallEClient
from evidence.model import load_case
from pipeline import ResolutionRequest
from verdict import Verdict

from tests.test_api import HERE, api_server, api_server_and_backend, await_resolution, post


CASE = "critical-service-escalation"
DESTINATION = "+12025550187"
API_KEY = "live_test_key_not_a_real_credential"


def live_payload(**overrides: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "case": CASE,
        "execution_mode": "live",
        "destination": DESTINATION,
        "authorize_destination": DESTINATION,
        "gdpr_basis_documented": True,
    }
    payload.update(overrides)
    return payload


def live_headers(key: str = API_KEY) -> dict[str, str]:
    return {"X-Calle-Api-Key": key}


class StubCallEClient:
    """A provider-shaped double that records construction safely."""

    instances: list["StubCallEClient"] = []
    final_status = "completed"
    final_result: dict[str, Any] | None = {
        "subject_intent": "confirmed",
        "answered_by": "human",
    }
    create_error: Exception | None = None
    poll_error: Exception | None = None

    def __init__(self, base_url: str, api_key: str, allow_live: bool) -> None:
        self.base_url = base_url
        self.api_key = api_key
        self.allow_live = allow_live
        self.__class__.instances.append(self)

    def create_call(self, **_: Any) -> dict[str, Any]:
        if self.create_error is not None:
            raise self.create_error
        return {"id": "stub_call_id", "status": "queued"}

    def poll_until_terminal(self, call_id: str, **_: Any) -> dict[str, Any]:
        if self.poll_error is not None:
            raise self.poll_error
        result: dict[str, Any] = {"id": call_id, "status": self.final_status}
        if self.final_result is not None:
            result["structured_result"] = dict(self.final_result)
        return result


@pytest.fixture
def stub_client(monkeypatch: pytest.MonkeyPatch):
    import pipeline

    StubCallEClient.instances = []
    StubCallEClient.final_status = "completed"
    StubCallEClient.final_result = {"subject_intent": "confirmed", "answered_by": "human"}
    StubCallEClient.create_error = None
    StubCallEClient.poll_error = None
    monkeypatch.setattr(pipeline, "CallEClient", StubCallEClient)
    return StubCallEClient


@pytest.mark.parametrize("header", [None, "", "   "])
def test_live_requires_a_nonempty_header_and_never_falls_back_to_environment(
    monkeypatch: pytest.MonkeyPatch, header: str | None
) -> None:
    monkeypatch.setenv("CALLE_API_KEY", "environment_key_must_not_be_used")
    headers = {} if header is None else {"X-Calle-Api-Key": header}
    with api_server_and_backend() as (base_url, backend):
        status, body, _ = post(base_url, "/api/resolutions", live_payload(), headers=headers)
        assert status == 401
        assert body["error"]["code"] == "missing_api_key"
        assert backend.creates == 0
        assert "environment_key" not in json.dumps(body)


def test_live_header_is_rejected_in_fake_mode() -> None:
    with api_server_and_backend() as (base_url, backend):
        status, body, _ = post(
            base_url,
            "/api/resolutions",
            {"case": CASE, "execution_mode": "fake"},
            headers=live_headers(),
        )
        assert status == 422
        assert body["error"]["code"] == "api_key_not_allowed"
        assert backend.creates == 0


@pytest.mark.parametrize(
    "payload, code",
    [
        (live_payload(destination=None), "missing_destination"),
        (live_payload(authorize_destination=None), "missing_authorize_destination"),
    ],
)
def test_live_requires_both_destination_fields(payload: dict[str, Any], code: str) -> None:
    with api_server() as base_url:
        status, body, _ = post(base_url, "/api/resolutions", payload, headers=live_headers())
        assert status == 422
        assert body["error"]["code"] == code


@pytest.mark.parametrize(
    "field, value, code",
    [
        ("destination", "+12025550187\n", "invalid_destination"),
        ("destination", "+12025550187 ", "invalid_destination"),
        ("destination", "+1202 5550187", "invalid_destination"),
        ("destination", "+١٢٠٢٥٥٥٠١٨٧", "invalid_destination"),
        ("destination", "+１２０２５５５０１８７", "invalid_destination"),
        ("destination", "+12025550187x", "invalid_destination"),
        ("authorize_destination", "+12025550187\r\n", "invalid_authorize_destination"),
        ("authorize_destination", "+١٢٠٢٥٥٥٠١٨٧", "invalid_authorize_destination"),
    ],
)
def test_live_requires_strict_ascii_e164(field: str, value: str, code: str) -> None:
    with api_server() as base_url:
        status, body, _ = post(
            base_url, "/api/resolutions", live_payload(**{field: value}), headers=live_headers()
        )
        assert status == 422
        assert body["error"]["code"] == code


def test_live_requires_exact_destination_authorization_match() -> None:
    with api_server() as base_url:
        status, body, _ = post(
            base_url,
            "/api/resolutions",
            live_payload(authorize_destination="+12025550188"),
            headers=live_headers(),
        )
        assert status == 422
        assert body["error"]["code"] == "destination_authorization_mismatch"


@pytest.mark.parametrize("field", ["scenario", "now_utc"])
def test_fake_only_fields_are_rejected_in_live(field: str) -> None:
    with api_server() as base_url:
        status, body, _ = post(
            base_url,
            "/api/resolutions",
            live_payload(**{field: "confirmed"}),
            headers=live_headers(),
        )
        assert status == 422
        assert body["error"]["code"] == "field_not_allowed"


@pytest.mark.parametrize("field", ["destination", "authorize_destination", "gdpr_basis_documented"])
def test_live_only_fields_are_rejected_in_fake(field: str) -> None:
    with api_server() as base_url:
        value: Any = True if field == "gdpr_basis_documented" else DESTINATION
        status, body, _ = post(
            base_url,
            "/api/resolutions",
            {"case": CASE, "execution_mode": "fake", field: value},
        )
        assert status == 422
        assert body["error"]["code"] == "field_not_allowed"


def test_live_construction_uses_server_values_and_keeps_key_out_of_public_state(
    stub_client: type[StubCallEClient], capsys: pytest.CaptureFixture[str]
) -> None:
    with api_server_and_backend() as (base_url, backend):
        status, queued, _ = post(
            base_url, "/api/resolutions", live_payload(), headers=live_headers()
        )
        assert status == 202
        assert queued["state"] == "queued"
        assert queued["mode"] == "live"
        assert "api_key" not in json.dumps(queued)

        result = await_resolution(base_url, queued["id"])
        assert result["state"] == "completed"
        assert result["mode"] == "live"
        assert result["verdict"] == {"status": "RESOLVED", "action": "CONTINUE_DISPATCH"}
        assert API_KEY not in json.dumps(result)
        assert backend.creates == 0

    assert len(stub_client.instances) == 1
    client = stub_client.instances[0]
    assert client.base_url == REAL_API_BASE_URL
    assert client.allow_live is True
    assert client.api_key == API_KEY
    assert API_KEY not in capsys.readouterr().out


def test_live_compliance_block_is_completed_without_provider_call(monkeypatch: pytest.MonkeyPatch) -> None:
    import pipeline

    class MustNotConstruct:
        def __init__(self, *_: Any, **__: Any) -> None:
            raise AssertionError("a blocked live run must not construct CallEClient")

    monkeypatch.setattr(pipeline, "CallEClient", MustNotConstruct)
    unmapped_number = "+442079460123"
    with api_server_and_backend() as (base_url, backend):
        status, queued, _ = post(
            base_url,
            "/api/resolutions",
            live_payload(destination=unmapped_number, authorize_destination=unmapped_number),
            headers=live_headers(),
        )
        assert status == 202
        result = await_resolution(base_url, queued["id"])
        assert result["state"] == "completed"
        assert result["verdict"] == {
            "status": "UNRESOLVED_CALL_BLOCKED",
            "action": "RETRY_WHEN_PERMITTED",
        }
        assert result["call"] == {"placed": False, "provider_status": None, "result": None}
        assert backend.creates == 0


@pytest.mark.parametrize("status", ["failed", "canceled"])
def test_provider_failed_or_canceled_is_a_technical_failure(
    stub_client: type[StubCallEClient], status: str
) -> None:
    stub_client.final_status = status
    with api_server() as base_url:
        http_status, queued, _ = post(
            base_url, "/api/resolutions", live_payload(), headers=live_headers()
        )
        assert http_status == 202
        result = await_resolution(base_url, queued["id"])
        assert result["state"] == "failed"
        assert result["verdict"] is None
        assert result["error"]["code"] == "provider_failed"
        assert result["call"]["provider_status"] == status


@pytest.mark.parametrize(
    "error, code",
    [
        (TimeoutError("provider timed out"), "calle_timeout"),
        (CallEAPIError(401, "unauthorized", "secret provider text", {"token": API_KEY}), "calle_auth_error"),
        (CallEAPIError(500, "internal_error", "secret provider text", {}), "calle_api_error"),
        (RuntimeError("network details must stay private"), "calle_network_error"),
    ],
)
def test_live_provider_errors_are_safe_technical_failures(
    stub_client: type[StubCallEClient], error: Exception, code: str
) -> None:
    if isinstance(error, TimeoutError) or isinstance(error, CallEAPIError):
        stub_client.poll_error = error
    else:
        stub_client.create_error = error

    with api_server() as base_url:
        status, queued, _ = post(
            base_url, "/api/resolutions", live_payload(), headers=live_headers()
        )
        assert status == 202
        result = await_resolution(base_url, queued["id"])
        assert result["state"] == "failed"
        assert result["verdict"] is None
        assert result["error"] == {
            "code": code,
            "message": "the resolution could not be completed",
        }
        rendered = json.dumps(result)
        assert API_KEY not in rendered
        assert "secret provider text" not in rendered
        assert "network details" not in rendered


def test_completed_ambiguous_result_remains_unresolved_ambiguous(
    stub_client: type[StubCallEClient],
) -> None:
    stub_client.final_result = {"subject_intent": "unknown", "answered_by": "voicemail"}
    with api_server() as base_url:
        status, queued, _ = post(
            base_url, "/api/resolutions", live_payload(), headers=live_headers()
        )
        assert status == 202
        result = await_resolution(base_url, queued["id"])
        assert result["state"] == "completed"
        assert result["verdict"]["status"] == "UNRESOLVED_AMBIGUOUS"


def test_completed_cancelled_result_keeps_the_business_verdict(
    stub_client: type[StubCallEClient],
) -> None:
    stub_client.final_result = {"subject_intent": "cancelled", "answered_by": "human"}
    with api_server() as base_url:
        status, queued, _ = post(
            base_url, "/api/resolutions", live_payload(), headers=live_headers()
        )
        assert status == 202
        result = await_resolution(base_url, queued["id"])
        assert result["state"] == "completed"
        assert result["verdict"] == {
            "status": "RESOLVED_ALT",
            "action": "REASSIGN_TECHNICIAN",
        }


def test_request_and_client_repr_hide_the_live_key() -> None:
    request = ResolutionRequest(
        case_path="case.json",
        base_url=REAL_API_BASE_URL,
        execute=True,
        allow_live=True,
        api_key=API_KEY,
    )
    client = CallEClient(REAL_API_BASE_URL, API_KEY, allow_live=True)
    assert API_KEY not in repr(request)
    assert API_KEY not in repr(client)


def _no_call_resolve(request: ResolutionRequest, observer: Any) -> None:
    observer.on_start(load_case(request.case_path), "EXECUTE")
    observer.on_verdict(Verdict("NO_CALL_NEEDED", "NO_ACTION_REQUIRED", ()))


def test_live_capacity_is_immediate_fake_is_independent_and_releases(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import api.server as server_module

    entered = threading.Event()
    release = threading.Event()

    def blocking_resolve(request: ResolutionRequest, observer: Any) -> None:
        if not request.allow_live:
            _no_call_resolve(request, observer)
            return
        entered.set()
        observer.on_start(load_case(request.case_path), "EXECUTE")
        release.wait(5)
        observer.on_verdict(Verdict("NO_CALL_NEEDED", "NO_ACTION_REQUIRED", ()))

    monkeypatch.setattr(server_module, "resolve", blocking_resolve)
    with api_server_and_backend() as (base_url, backend):
        status, first, _ = post(base_url, "/api/resolutions", live_payload(), headers=live_headers())
        assert status == 202
        assert entered.wait(2)

        fake_status, fake_body, _ = post(
            base_url,
            "/api/resolutions",
            {"case": CASE, "execution_mode": "fake", "scenario": "no-call"},
        )
        assert fake_status == 202
        assert fake_body["mode"] == "fake"
        assert await_resolution(base_url, fake_body["id"])["state"] == "completed"

        second_status, second_body, _ = post(
            base_url, "/api/resolutions", live_payload(), headers=live_headers()
        )
        assert second_status == 429
        assert second_body["error"]["code"] == "live_capacity_reached"

        release.set()
        assert await_resolution(base_url, first["id"])["state"] == "completed"
        third_status, third, _ = post(
            base_url, "/api/resolutions", live_payload(), headers=live_headers()
        )
        assert third_status == 202
        assert await_resolution(base_url, third["id"])["state"] == "completed"
        assert backend.creates == 0


def test_live_capacity_releases_after_worker_exception(monkeypatch: pytest.MonkeyPatch) -> None:
    import api.server as server_module

    def failing_resolve(*_: Any, **__: Any) -> None:
        raise RuntimeError("private worker detail")

    monkeypatch.setattr(server_module, "resolve", failing_resolve)
    with api_server_and_backend() as (base_url, _):
        status, first, _ = post(base_url, "/api/resolutions", live_payload(), headers=live_headers())
        assert status == 202
        assert await_resolution(base_url, first["id"])["error"]["code"] == "calle_network_error"

        monkeypatch.setattr(server_module, "resolve", _no_call_resolve)
        status, second, _ = post(base_url, "/api/resolutions", live_payload(), headers=live_headers())
        assert status == 202
        assert await_resolution(base_url, second["id"])["state"] == "completed"


def test_live_capacity_releases_when_submit_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    import api.server as server_module

    original_submit = ThreadPoolExecutor.submit
    calls = 0

    def fail_first_submit(self: ThreadPoolExecutor, *args: Any, **kwargs: Any):
        nonlocal calls
        if calls == 0:
            calls += 1
            raise RuntimeError("submit failed")
        return original_submit(self, *args, **kwargs)

    monkeypatch.setattr(ThreadPoolExecutor, "submit", fail_first_submit)
    monkeypatch.setattr(server_module, "resolve", _no_call_resolve)
    with api_server_and_backend() as (base_url, _):
        status, body, _ = post(base_url, "/api/resolutions", live_payload(), headers=live_headers())
        assert status == 503
        assert body["error"]["code"] == "resolution_submit_failed"

        monkeypatch.setattr(ThreadPoolExecutor, "submit", original_submit)
        status, queued, _ = post(base_url, "/api/resolutions", live_payload(), headers=live_headers())
        assert status == 202
        assert await_resolution(base_url, queued["id"])["state"] == "completed"
