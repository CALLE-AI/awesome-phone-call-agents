"""Offline and fake-provider coverage for normalized custom cases."""

from __future__ import annotations

import json
import threading
import time
import urllib.error
import urllib.request
from collections.abc import Iterator
from contextlib import contextmanager
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import pytest

from api.custom_case import CustomCaseValidationError, parse_custom_case


def custom_payload(**overrides: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "name": "Synthetic logistics confirmation",
        "use_case": "factual_state_confirmation",
        "deadline": "2026-09-11T08:00:00Z",
        "decision_deadline_threshold_hours": 24,
        "decision_options": {
            "if_confirmed": "KEEP_DELIVERY_PLAN",
            "if_cancelled": "ASSIGN_BACKUP_DRIVER",
        },
        "call_task_hint": "Ask the assigned driver to confirm whether the delivery plan remains feasible.",
        "evidence": [
            {
                "source": "dispatch-system",
                "type": "structured",
                "freshness_hours": 2,
                "claim": "driver assigned and delivery confirmed for 08:00",
                "ambiguity": "low",
            },
            {
                "source": "driver-message",
                "type": "human",
                "freshness_hours": 1,
                "claim": "vehicle issue, I might not be able to complete the delivery",
                "ambiguity": "high",
            },
        ],
    }
    payload.update(overrides)
    return payload


def test_custom_case_parser_returns_the_existing_engine_model() -> None:
    case = parse_custom_case(custom_payload())

    assert case.name == "Synthetic logistics confirmation"
    assert case.use_case == "factual_state_confirmation"
    assert case.decision_options["if_confirmed"] == "KEEP_DELIVERY_PLAN"
    assert len(case.evidence.items) == 2


@pytest.mark.parametrize(
    ("field", "value", "code"),
    [
        ("deadline", "tomorrow", "invalid_custom_deadline"),
        ("use_case", "medical_decision", "unsupported_custom_use_case"),
        ("call_phone", "+١٢٠٢٥٥٥٠١٨٧", "invalid_custom_phone"),
        ("evidence", [], "invalid_custom_evidence"),
    ],
)
def test_custom_case_parser_rejects_invalid_inputs(field: str, value: Any, code: str) -> None:
    with pytest.raises(CustomCaseValidationError) as error:
        parse_custom_case(custom_payload(**{field: value}))
    assert error.value.code == code


def test_custom_case_parser_rejects_oversized_evidence() -> None:
    evidence = custom_payload()["evidence"] * 11
    with pytest.raises(CustomCaseValidationError) as error:
        parse_custom_case(custom_payload(evidence=evidence))
    assert error.value.code == "custom_case_too_large"


@contextmanager
def api_server_and_backend() -> Iterator[tuple[str, Any]]:
    from api.backend import FakeCallBackend
    from api.server import MAX_WORKERS, create_server

    backend = FakeCallBackend()
    backend.start()
    executor = ThreadPoolExecutor(max_workers=MAX_WORKERS)
    server = create_server("127.0.0.1", 0, backend=backend, executor=executor)
    thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.0005}, daemon=True)
    thread.start()
    host, port = server.server_address[:2]
    try:
        yield f"http://{host}:{port}", backend
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)
        executor.shutdown(wait=True)
        backend.stop()


def post(base_url: str, payload: dict[str, Any]) -> tuple[int, Any]:
    request = urllib.request.Request(
        f"{base_url}/api/resolutions",
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            return response.status, json.loads(response.read())
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read())


def get(base_url: str, resolution_id: str) -> tuple[int, Any]:
    try:
        with urllib.request.urlopen(f"{base_url}/api/resolutions/{resolution_id}", timeout=15) as response:
            return response.status, json.loads(response.read())
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read())


def await_terminal(base_url: str, resolution_id: str) -> dict[str, Any]:
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        status, body = get(base_url, resolution_id)
        assert status == 200
        if body["state"] in {"completed", "failed"}:
            return body
        time.sleep(0.005)
    raise AssertionError("custom resolution did not reach a terminal state")


def resolve_custom(base_url: str, **fields: Any) -> dict[str, Any]:
    payload = {"case": "custom", "execution_mode": "fake", "custom_case": custom_payload()}
    payload.update(fields)
    status, created = post(base_url, payload)
    assert status == 202, created
    assert created["state"] == "queued"
    return await_terminal(base_url, created["id"])


def test_custom_confirmed_uses_real_engine_and_dynamic_action() -> None:
    with api_server_and_backend() as (base_url, backend):
        result = resolve_custom(base_url, scenario="confirmed")

        assert result["state"] == "completed"
        assert result["reasoning"]["decision_critical"] is True
        assert result["call_decision"] == "CALL_JUSTIFIED"
        assert result["verdict"] == {"status": "RESOLVED", "action": "KEEP_DELIVERY_PLAN"}
        assert backend.creates == 1
        assert "+10000000003" not in json.dumps(result)


def test_custom_cancelled_and_voicemail_use_provider_scenarios() -> None:
    with api_server_and_backend() as (base_url, _):
        cancelled = resolve_custom(base_url, scenario="cancelled")
        voicemail = resolve_custom(base_url, scenario="voicemail")

        assert cancelled["verdict"] == {"status": "RESOLVED_ALT", "action": "ASSIGN_BACKUP_DRIVER"}
        assert voicemail["verdict"] == {"status": "UNRESOLVED_AMBIGUOUS", "action": "HUMAN_REVIEW"}


def test_custom_no_call_and_blocked_never_reach_provider() -> None:
    with api_server_and_backend() as (base_url, backend):
        no_call = resolve_custom(base_url, scenario="no-call")
        blocked = resolve_custom(base_url, scenario="blocked")

        assert no_call["verdict"] == {"status": "NO_CALL_NEEDED", "action": "NO_ACTION_REQUIRED"}
        assert blocked["verdict"] == {"status": "UNRESOLVED_CALL_BLOCKED", "action": "RETRY_WHEN_PERMITTED"}
        assert backend.creates == 0


def test_custom_case_requires_strict_top_level_contract() -> None:
    with api_server_and_backend() as (base_url, _):
        status, body = post(
            base_url,
            {
                "case": "custom",
                "execution_mode": "fake",
                "custom_case": custom_payload(unexpected="nope"),
            },
        )
        assert status == 422
        assert body["error"]["code"] == "unknown_custom_case_field"


def test_custom_live_still_requires_per_request_api_key() -> None:
    with api_server_and_backend() as (base_url, _):
        status, body = post(
            base_url,
            {
                "case": "custom",
                "execution_mode": "live",
                "custom_case": custom_payload(),
                "destination": "+12025550187",
                "authorize_destination": "+12025550187",
                "gdpr_basis_documented": True,
            },
        )
        assert status == 401
        assert body["error"]["code"] == "missing_api_key"
