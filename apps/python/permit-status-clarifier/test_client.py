import importlib.util
import json
import subprocess
import sys
from pathlib import Path


APP_ROOT = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("permit_status_client", APP_ROOT / "client.py")
assert SPEC and SPEC.loader
client_module = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = client_module
SPEC.loader.exec_module(client_module)


def valid_payload() -> dict:
    return {
        "workflow_id": "permit-demo-2026-001",
        "phone": "+12025550123",
        "caller_has_authority": True,
        "recipient_is_public_department_number": True,
        "organization_display_name": "Example Build Co",
        "jurisdiction": "Example City",
        "department": "Building and Safety Permit Desk",
        "permit_reference": "BLD-2026-00421",
        "project_type": "Interior commercial renovation",
        "region": "US",
        "locale": "en-US",
        "questions": [
            "current_status",
            "blocking_items",
            "next_action",
            "response_deadline",
            "resubmission_channel",
            "followup_contact",
        ],
    }


def test_preview_masks_recipient_and_reference(tmp_path):
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
    assert "BLD-2026-00421" not in result.stdout
    parsed = json.loads(result.stdout)
    assert parsed["creates_phone_call"] is False
    assert parsed["call_arguments"]["idempotency_key"] == "permitstatus-permit-demo-2026-001"


def test_live_mode_requires_two_separate_confirmations(tmp_path):
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
    assert "--confirm-authority and --confirm-public-number" in result.stderr


def test_request_rejects_missing_authority_private_number_and_personal_reference():
    for key in ("caller_has_authority", "recipient_is_public_department_number"):
        payload = valid_payload()
        payload[key] = False
        try:
            client_module.parse_request(payload)
        except ValueError as exc:
            assert key in str(exc)
        else:
            raise AssertionError(f"{key}=false was accepted")

    payload = valid_payload()
    payload["permit_reference"] = "person@example.com"
    try:
        client_module.parse_request(payload)
    except ValueError as exc:
        assert "unsupported characters" in str(exc) or "must not contain" in str(exc)
    else:
        raise AssertionError("personal permit reference was accepted")


def test_task_has_information_only_boundaries():
    request = client_module.parse_request(valid_payload())
    task = client_module.build_task(request)
    assert "identify yourself as an AI" in task
    assert "Do not request legal interpretation" in task
    assert "authorize or pay a fee" in task
    assert "Ask only these questions" in task


class FakeCalls:
    def __init__(self):
        self.created = None

    def create(self, **kwargs):
        self.created = kwargs
        return {"id": "call_permit_demo"}

    def wait_for_result(self, call_id, **kwargs):
        assert call_id == "call_permit_demo"
        assert kwargs == {"timeout_seconds": 30, "interval_seconds": 2}
        return {
            "status": "completed",
            "task_completed": True,
            "completion_confidence": {"score": 0.9, "label": "high"},
            "structured_result": {
                "reached_correct_department": "yes",
                "current_status": "corrections_required",
                "blocker_summary": "Upload the revised plan set.",
                "next_action": "Use the applicant portal.",
                "response_deadline": "Unknown",
                "resubmission_channel": "Applicant portal",
                "fee_information_only": "No fee stated",
                "followup_contact": "Plans review team",
                "followup_reference": "Follow-up by public line +12025550123",
                "evidence_summary": "The desk confirmed person@example.com should use the portal.",
            },
        }


class FakeClient:
    def __init__(self):
        self.calls = FakeCalls()


def test_execute_calls_calle_once_with_idempotency_and_redacts_result():
    request = client_module.parse_request(valid_payload())
    fake = FakeClient()
    result = client_module.execute(request, fake, timeout_seconds=30)
    assert fake.calls.created["idempotency_key"] == "permitstatus-permit-demo-2026-001"
    assert fake.calls.created["recipients"] == [
        {"phones": ["+12025550123"], "region": "US", "locale": "en-US"}
    ]
    assert result["structured_result"]["followup_reference"].endswith("[phone-redacted]")
    assert "[email-redacted]" in result["structured_result"]["evidence_summary"]


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
