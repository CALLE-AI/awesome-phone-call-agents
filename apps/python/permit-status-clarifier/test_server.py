import importlib.util
import sys
from pathlib import Path


APP_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(APP_ROOT))
SPEC = importlib.util.spec_from_file_location("permit_status_server", APP_ROOT / "server.py")
assert SPEC and SPEC.loader
server_module = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = server_module
SPEC.loader.exec_module(server_module)


def valid_payload() -> dict:
    return {
        "workflow_id": "web-demo-001",
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
        "questions": ["current_status", "blocking_items", "next_action"],
    }


def test_web_preview_is_no_call_and_masked():
    result = server_module.preview_payload(valid_payload())
    assert result["creates_phone_call"] is False
    rendered = str(result)
    assert "+12025550123" not in rendered
    assert "BLD-2026-00421" not in rendered


class FakeCalls:
    def __init__(self):
        self.count = 0

    def create(self, **kwargs):
        self.count += 1
        return {"id": "call_web_demo"}

    def wait_for_result(self, call_id, **kwargs):
        return {"status": "completed", "structured_result": {"current_status": "under_review"}}


class FakeClient:
    def __init__(self):
        self.calls = FakeCalls()


def test_web_live_requires_all_confirmations_and_calls_once():
    request = valid_payload()
    for missing in ("authority", "public_number", "live_call"):
        confirmations = {"authority": True, "public_number": True, "live_call": True}
        confirmations[missing] = False
        try:
            server_module.execute_payload({"request": request, "confirmations": confirmations}, FakeClient())
        except ValueError as exc:
            assert "all three" in str(exc)
        else:
            raise AssertionError(f"missing {missing} confirmation was accepted")

    fake = FakeClient()
    result = server_module.execute_payload(
        {"request": request, "confirmations": {"authority": True, "public_number": True, "live_call": True}},
        fake,
        timeout_seconds=10,
    )
    assert result["creates_phone_call"] is True
    assert fake.calls.count == 1
