import importlib.util
import json
import subprocess
import sys
from datetime import date, timedelta
from pathlib import Path


APP_ROOT = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location(
    "callback_window_client", APP_ROOT / "client.py"
)
assert SPEC and SPEC.loader
client_module = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = client_module
SPEC.loader.exec_module(client_module)


def valid_payload() -> dict:
    return {
        "workflow_id": "demo-2026-001",
        "phone": "+12025550123",
        "recipient_has_requested_callback": True,
        "business_display_name": "Example Service Desk",
        "callback_purpose": "Choose a convenient time for a requested support callback",
        "callback_date": (date.today() + timedelta(days=2)).isoformat(),
        "timezone": "America/New_York",
        "locale": "en-US",
        "available_windows": [
            {"id": "morning", "label": "09:00-11:00"},
            {"id": "afternoon", "label": "14:00-16:00"},
        ],
    }


def test_preview_masks_phone_and_never_requires_api_key(tmp_path):
    request_path = tmp_path / "request.json"
    request_path.write_text(json.dumps(valid_payload()), encoding="utf-8")
    result = subprocess.run(
        [sys.executable, "client.py", "--request", str(request_path)],
        cwd=APP_ROOT,
        text=True,
        capture_output=True,
        timeout=10,
    )
    assert result.returncode == 0, result.stderr
    assert "+12025550123" not in result.stdout
    assert "+12******123" in result.stdout
    parsed = json.loads(result.stdout)
    assert parsed["mode"] == "preview"
    assert parsed["creates_phone_call"] is False


def test_execute_requires_separate_opt_in_confirmation(tmp_path):
    request_path = tmp_path / "request.json"
    request_path.write_text(json.dumps(valid_payload()), encoding="utf-8")
    result = subprocess.run(
        [sys.executable, "client.py", "--request", str(request_path), "--execute"],
        cwd=APP_ROOT,
        text=True,
        capture_output=True,
        timeout=10,
    )
    assert result.returncode == 2
    assert "--confirm-recipient-opt-in" in result.stderr


def test_request_rejects_missing_consent_and_bad_timezone():
    payload = valid_payload()
    payload["recipient_has_requested_callback"] = False
    try:
        client_module.parse_request(payload)
    except ValueError as exc:
        assert "must be true" in str(exc)
    else:
        raise AssertionError("missing opt-in was accepted")

    payload = valid_payload()
    payload["timezone"] = "EST"
    try:
        client_module.parse_request(payload)
    except ValueError as exc:
        assert "IANA timezone" in str(exc)
    else:
        raise AssertionError("timezone abbreviation was accepted")


class FakeCalls:
    def __init__(self):
        self.created = None

    def create(self, **kwargs):
        self.created = kwargs
        return {"id": "call_demo_123"}

    def wait_for_result(self, call_id, **kwargs):
        assert call_id == "call_demo_123"
        assert kwargs == {"timeout_seconds": 30, "interval_seconds": 2}
        return {
            "status": "completed",
            "task_completed": True,
            "completion_confidence": {"score": 0.91, "label": "high"},
            "structured_result": {
                "right_person": "yes",
                "continued_after_ai_disclosure": "yes",
                "preferred_window_id": "morning",
                "voicemail_allowed": "no",
                "evidence_summary": "Confirmed +12025550123 and selected morning.",
            },
        }


class FakeClient:
    def __init__(self):
        self.calls = FakeCalls()


def test_execute_uses_stable_idempotency_and_redacts_result_phone():
    request = client_module.parse_request(valid_payload())
    fake = FakeClient()
    result = client_module.execute(request, fake, timeout_seconds=30)
    assert fake.calls.created["idempotency_key"] == "callwindow-demo-2026-001"
    assert fake.calls.created["recipients"] == [
        {"phones": ["+12025550123"], "locale": "en-US"}
    ]
    assert (
        result["structured_result"]["evidence_summary"]
        == "Confirmed [phone-redacted] and selected morning."
    )
    schema = fake.calls.created["result_schema"]
    assert schema["properties"]["preferred_window_id"]["enum"] == [
        "morning",
        "afternoon",
        "decline",
        "unknown",
    ]


def test_output_refuses_overwrite(tmp_path):
    path = tmp_path / "result.json"
    path.write_text("keep me", encoding="utf-8")
    try:
        client_module.write_output(path, {"ok": True})
    except FileExistsError:
        pass
    else:
        raise AssertionError("existing output was overwritten")
    assert path.read_text(encoding="utf-8") == "keep me"
