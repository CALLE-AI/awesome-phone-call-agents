"""CLI integration tests for the Callback Coordinator.

Runs the client.py entrypoint in subprocess for preview/validation paths that do
not require CALL-E credentials or network access.
"""

import json
import subprocess
import sys
from pathlib import Path


APP_ROOT = Path(__file__).resolve().parent


def valid_intake() -> dict:
    return {
        "workflow_id": "demo-cli-001",
        "phone": "+12025550123",
        "source": "web_form",
        "business_display_name": "Example Service Desk",
        "request_reason_hint": "",
        "timezone": "America/New_York",
        "locale": "en-US",
        "consent": True,
    }


def _run(tmp_path, *extra):
    request_path = tmp_path / "request.json"
    request_path.write_text(json.dumps(valid_intake()), encoding="utf-8")
    return subprocess.run(
        [sys.executable, "client.py", "--request", str(request_path), *extra],
        cwd=APP_ROOT,
        text=True,
        capture_output=True,
        timeout=15,
    )


def test_preview_masks_phone_and_needs_no_credentials(tmp_path):
    # Deterministic daytime timestamp so the quiet-hours gate does not depend on
    # the wall clock when the suite runs.
    result = _run(tmp_path, "--now", "2026-08-10T14:00:00-04:00")
    assert result.returncode == 0, result.stderr
    assert "+12025550123" not in result.stdout
    assert "+12******123" in result.stdout
    parsed = json.loads(result.stdout)
    assert parsed["mode"] == "preview"
    assert parsed["creates_phone_call"] is False
    assert parsed["gate"]["attempt"] is True


def test_preview_honors_now_for_quiet_hours(tmp_path):
    result = _run(tmp_path, "--now", "2026-08-10T22:00:00-04:00")
    assert result.returncode == 0, result.stderr
    parsed = json.loads(result.stdout)
    assert parsed["gate"]["attempt"] is False
    assert parsed["gate"]["reason"] == "quiet_hours"


def test_check_api_requires_api_key(tmp_path):
    request_path = tmp_path / "request.json"
    request_path.write_text(json.dumps(valid_intake()), encoding="utf-8")
    result = subprocess.run(
        [sys.executable, "client.py", "--request", str(request_path), "--check-api"],
        cwd=APP_ROOT,
        text=True,
        capture_output=True,
        timeout=15,
        env={},
    )
    assert result.returncode == 2
    assert "CALLE_API_KEY" in result.stderr


def test_execute_requires_confirm_consent(tmp_path):
    result = _run(tmp_path, "--execute")
    assert result.returncode == 2
    assert "--confirm-consent" in result.stderr


def test_execute_requires_api_key_even_with_consent(tmp_path):
    result = _run(tmp_path, "--execute", "--confirm-consent")
    assert result.returncode == 2
    assert "CALLE_API_KEY" in result.stderr


def test_request_rejects_bad_phone(tmp_path):
    request_path = tmp_path / "request.json"
    payload = valid_intake()
    payload["phone"] = "1-555-555-0123"  # passes length, not E.164
    request_path.write_text(json.dumps(payload), encoding="utf-8")
    result = subprocess.run(
        [sys.executable, "client.py", "--request", str(request_path)],
        cwd=APP_ROOT,
        text=True,
        capture_output=True,
        timeout=15,
    )
    assert result.returncode == 2
    assert "E.164" in result.stderr


def test_request_rejects_plus_zero(tmp_path):
    request_path = tmp_path / "request.json"
    payload = valid_intake()
    payload["phone"] = "+0123456789"
    request_path.write_text(json.dumps(payload), encoding="utf-8")
    result = subprocess.run(
        [sys.executable, "client.py", "--request", str(request_path)],
        cwd=APP_ROOT,
        text=True,
        capture_output=True,
        timeout=15,
    )
    assert result.returncode == 2
    assert "E.164" in result.stderr


def test_request_requires_consent_field(tmp_path):
    request_path = tmp_path / "request.json"
    payload = valid_intake()
    payload.pop("consent")
    request_path.write_text(json.dumps(payload), encoding="utf-8")
    result = subprocess.run(
        [sys.executable, "client.py", "--request", str(request_path)],
        cwd=APP_ROOT,
        text=True,
        capture_output=True,
        timeout=15,
    )
    assert result.returncode == 2
    assert "consent" in result.stderr.lower()


def test_output_written_to_0600_file(tmp_path):
    request_path = tmp_path / "request.json"
    request_path.write_text(json.dumps(valid_intake()), encoding="utf-8")
    out = tmp_path / "plan.json"
    result = subprocess.run(
        [sys.executable, "client.py", "--request", str(request_path), "--output", str(out)],
        cwd=APP_ROOT,
        text=True,
        capture_output=True,
        timeout=15,
    )
    assert result.returncode == 0, result.stderr
    assert out.exists()
    mode = oct(out.stat().st_mode & 0o777)
    assert mode == "0o600"


def test_rejects_untrusted_base_url(tmp_path):
    request_path = tmp_path / "request.json"
    request_path.write_text(json.dumps(valid_intake()), encoding="utf-8")
    result = subprocess.run(
        [
            sys.executable,
            "client.py",
            "--request",
            str(request_path),
            "--base-url",
            "https://evil.example.com",
        ],
        cwd=APP_ROOT,
        text=True,
        capture_output=True,
        timeout=15,
    )
    assert result.returncode == 2
    assert "api.heycall-e.com" in result.stderr.lower() or "base_url" in result.stderr.lower()
