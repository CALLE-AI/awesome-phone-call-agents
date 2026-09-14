"""Offline coverage for live provider payloads, phases, and timeouts."""

from __future__ import annotations

import json
from typing import Any

import pytest

import api.server as server_module
import client as client_module
from api.progress import StoreObserver
from api.store import ResolutionStore
from client import CallEAPIError, CallEClient, build_recipient
from compliance.dispatcher import resolve_jurisdiction_chain, resolve_locale_and_region
from pipeline import ResolutionRequest
from verdict import subject_intent_result_schema


def _seeded_store() -> tuple[ResolutionStore, str]:
    store = ResolutionStore()
    resolution_id = "res_offline_diagnostics"
    store.put(resolution_id, {"state": "queued", "call": {"placed": False}})
    return store, resolution_id


def test_us_payload_uses_en_us_and_only_supported_create_fields(monkeypatch: pytest.MonkeyPatch) -> None:
    chain = resolve_jurisdiction_chain("+12760000000")
    locale, region, _ = resolve_locale_and_region(chain)
    assert chain == ("us_federal",)
    assert (locale, region) == ("en-US", "US")

    captured: dict[str, Any] = {}

    def fake_request(
        _client: CallEClient,
        method: str,
        path: str,
        headers: dict[str, str],
        body: bytes | None,
    ) -> dict[str, Any]:
        captured.update(
            {
                "method": method,
                "path": path,
                "headers": headers,
                "body": json.loads((body or b"{}").decode("utf-8")),
            }
        )
        return {"id": "call_offline", "status": "queued"}

    monkeypatch.setattr(CallEClient, "_request", fake_request)
    client = CallEClient("http://127.0.0.1:9", "local-dev-placeholder")
    client.create_call(
        task="offline task",
        recipients=[build_recipient("+12760000000", locale, region)],
        result_schema=subject_intent_result_schema(),
        idempotency_key="offline-idempotency",
    )

    assert captured["method"] == "POST"
    assert captured["path"] == "/v1/calls"
    body = captured["body"]
    assert set(body) == {"task", "recipients", "result_schema"}
    assert body["recipients"] == [{"phones": ["+12760000000"], "locale": "en-US", "region": "US"}]
    assert "fr-FR" not in json.dumps(body)
    assert '"region": "FR"' not in json.dumps(body)


def test_french_routing_remains_french() -> None:
    chain = resolve_jurisdiction_chain("+33155550123")
    assert resolve_locale_and_region(chain)[:2] == ("fr-FR", "FR")


def test_poll_timeout_diagnostic_is_phase_aware_and_provider_safe(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    store, resolution_id = _seeded_store()

    def fake_resolve(request: ResolutionRequest, observer: Any) -> None:
        observer.on_call_preview({})
        observer.on_call_created("call_offline", "queued")
        observer.on_poll({"status": "in_progress"})
        raise TimeoutError("provider poll deadline")

    monkeypatch.setattr(server_module, "resolve", fake_resolve)
    server_module._run_resolution(
        store,
        resolution_id,
        ResolutionRequest(case_path="", base_url="https://api.heycall-e.com", allow_live=True),
    )

    result = store.get(resolution_id)
    assert result["state"] == "failed"
    assert result["error"]["code"] == "calle_timeout"
    assert result["verdict"] is None
    assert result["call"]["placed"] is True

    rendered = capsys.readouterr().out
    assert "CALL-E resolution_error code=calle_timeout phase=poll call_id_present=true last_provider_status=in_progress" in rendered
    assert "provider poll deadline" not in rendered


def test_post_http_422_is_api_error_in_create_phase_and_does_not_poll(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    store, resolution_id = _seeded_store()
    events: list[str] = []

    def fake_resolve(request: ResolutionRequest, observer: Any) -> None:
        events.append("create")
        observer.on_call_preview({})
        raise CallEAPIError(422, "call_not_ready", "provider rejected request", {})

    monkeypatch.setattr(server_module, "resolve", fake_resolve)
    server_module._run_resolution(
        store,
        resolution_id,
        ResolutionRequest(case_path="", base_url="https://api.heycall-e.com", allow_live=True),
    )

    result = store.get(resolution_id)
    assert events == ["create"]
    assert result["error"]["code"] == "calle_api_error"
    assert result["error"]["code"] != "calle_timeout"
    rendered = capsys.readouterr().out
    assert "phase=create call_id_present=false" in rendered
    assert "last_provider_status" not in rendered


def test_post_socket_timeout_is_one_attempt_and_never_starts_polling(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    attempts = 0

    def fake_urlopen(request: Any, timeout: float | None = None) -> None:
        nonlocal attempts
        attempts += 1
        raise TimeoutError("offline socket timeout")

    monkeypatch.setattr(client_module.urllib.request, "urlopen", fake_urlopen)
    client = CallEClient("http://127.0.0.1:9", "local-dev-placeholder")
    with pytest.raises(RuntimeError):
        client.create_call(task="offline task", idempotency_key="offline-idempotency")
    assert attempts == 1


def test_success_without_provider_id_is_safe_create_failure(monkeypatch: pytest.MonkeyPatch, capsys) -> None:
    store, resolution_id = _seeded_store()
    polled = False

    def fake_resolve(request: ResolutionRequest, observer: Any) -> None:
        nonlocal polled
        observer.on_call_preview({})
        created: dict[str, Any] = {"status": "queued"}
        _ = created["id"]
        polled = True

    monkeypatch.setattr(server_module, "resolve", fake_resolve)
    server_module._run_resolution(
        store,
        resolution_id,
        ResolutionRequest(case_path="", base_url="https://api.heycall-e.com", allow_live=True),
    )
    result = store.get(resolution_id)
    assert result["state"] == "failed"
    assert result["error"]["code"] == "calle_network_error"
    assert result["call"]["placed"] is False
    assert polled is False
    assert "phase=create call_id_present=false" in capsys.readouterr().out


def test_fake_and_live_poll_budgets_are_separate() -> None:
    assert server_module.MAX_POLL_SECONDS == 10.0
    assert server_module.MAX_LIVE_POLL_SECONDS == 180.0
    source = open(server_module.__file__, encoding="utf-8").read()
    assert "poll_timeout_seconds=MAX_LIVE_POLL_SECONDS if live else MAX_POLL_SECONDS" in source
