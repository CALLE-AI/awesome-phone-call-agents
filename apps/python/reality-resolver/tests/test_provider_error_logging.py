"""Offline coverage for provider-safe CALL-E HTTP error logging."""

from __future__ import annotations

import io
import json
import urllib.error

import pytest

import client as client_module
from client import CallEAPIError, CallEClient


def _http_error(
    message: str,
    *,
    code: str = "invalid_request",
    details: object | None = None,
    status: int = 422,
) -> urllib.error.HTTPError:
    error: dict[str, object] = {"code": code, "message": message}
    if details is not None:
        error["details"] = details
    body = json.dumps({"error": error}).encode("utf-8")
    return urllib.error.HTTPError(
        "https://api.invalid/v1/calls",
        status,
        "unprocessable",
        {},
        io.BytesIO(body),
    )


def _run_failed_post(monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str], error: urllib.error.HTTPError) -> str:
    def fail(*args: object, **kwargs: object) -> None:
        raise error

    monkeypatch.setattr(client_module.urllib.request, "urlopen", fail)
    with pytest.raises(CallEAPIError):
        CallEClient("https://api.invalid", "offline-test-key").create_call(task="offline test")
    return capsys.readouterr().out


def test_provider_error_log_keeps_normal_code_and_omits_details(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    output = _run_failed_post(
        monkeypatch,
        capsys,
        _http_error("payload was rejected", details={"field": "task", "secret": "do-not-log"}),
    )

    assert "CALL-E provider_error status=422 code=invalid_request message=payload was rejected" in output
    assert "do-not-log" not in output
    assert "details" not in output
    assert "offline-test-key" not in output
    assert "Authorization" not in output


@pytest.mark.parametrize(
    ("message", "forbidden_fragment", "expected_fragment"),
    [
        ("recipient +12025550187 is unsupported", "+12025550187", "+...0187"),
        ("request used Bearer super_secret_token_value", "super_secret_token_value", "[redacted]"),
        ("api_key=iams_live_fake_key_value", "iams_live_fake_key_value", "[redacted]"),
        ("token=plausible-secret-token-value", "plausible-secret-token-value", "[redacted]"),
    ],
)
def test_provider_error_log_masks_sensitive_message_content(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    message: str,
    forbidden_fragment: str,
    expected_fragment: str,
) -> None:
    output = _run_failed_post(monkeypatch, capsys, _http_error(message))

    assert forbidden_fragment not in output
    assert expected_fragment in output


def test_provider_error_log_escapes_controls_and_bounds_message(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    message = "first\r\nsecond\x00" + ("x" * 2000)
    output = _run_failed_post(monkeypatch, capsys, _http_error(message))

    log_line = next(line for line in output.splitlines() if line.startswith("CALL-E provider_error"))
    assert "\r" not in log_line
    assert "\x00" not in log_line
    assert "\\r" in log_line
    assert "\\n" in log_line
    assert "\\x00" in log_line
    assert "truncated" in log_line
    assert len(log_line.split("message=", 1)[1]) <= 1000


def test_provider_error_log_never_includes_details_even_when_they_contain_secrets(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    details = {"phone": "+12025550187", "token": "iams_live_details_secret"}
    output = _run_failed_post(monkeypatch, capsys, _http_error("invalid recipient", details=details))

    assert "12025550187" not in output
    assert "iams_live_details_secret" not in output
    assert "details" not in output


def test_invalid_json_error_body_logs_only_fixed_safe_diagnostic(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    invalid_body = io.BytesIO(b"not-json-with-a-fake-token")
    error = urllib.error.HTTPError("https://api.invalid/v1/calls", 502, "bad gateway", {}, invalid_body)

    def fail(*args: object, **kwargs: object) -> None:
        raise error

    monkeypatch.setattr(client_module.urllib.request, "urlopen", fail)
    with pytest.raises(RuntimeError, match="body that is not valid JSON"):
        CallEClient("https://api.invalid", "offline-test-key").create_call(task="offline test")

    output = capsys.readouterr().out
    assert "CALL-E provider_error status=502 code=invalid_error_body message=provider error body was not valid JSON" in output
    assert "fake-token" not in output
