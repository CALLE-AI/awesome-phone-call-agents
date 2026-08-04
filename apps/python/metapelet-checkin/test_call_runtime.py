import importlib.util
import json
import sys
from pathlib import Path

import pytest

APP_ROOT = Path(__file__).resolve().parent


def load_module(name: str, filename: str):
    spec = importlib.util.spec_from_file_location(name, APP_ROOT / filename)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


call_runtime = load_module("metapelet_call_runtime", "call_runtime.py")
task_builder = load_module("metapelet_task_builder", "task_builder.py")


class FakeCalls:
    def __init__(self):
        self.create_args = None
        self.wait_args = None

    def create(self, **kwargs):
        self.create_args = kwargs
        return {"id": "call_demo_123"}

    def wait_for_result(self, call_id, **kwargs):
        self.wait_args = (call_id, kwargs)
        return {
            "status": "completed",
            "task_completed": True,
            "structured_result": {
                "mood": "Calm; mentioned +12025550123 briefly.",
                "topics": ["family", "garden"],
                "wants_repeat_call": "yes",
            },
        }


class FakeClient:
    def __init__(self):
        self.calls = FakeCalls()


def test_normalize_trusted_base_url_rejects_http():
    with pytest.raises(ValueError, match="https"):
        call_runtime.normalize_trusted_base_url("http://api.heycall-e.com")


def test_structured_result_withheld_until_completed():
    withheld = task_builder.structured_result_for_export(
        {"status": "running", "task_completed": False, "structured_result": {"mood": "x"}}
    )
    assert withheld is None
    released = task_builder.structured_result_for_export(
        {
            "status": "completed",
            "task_completed": True,
            "structured_result": {"mood": "Call +15550100000", "topics": [], "wants_repeat_call": "yes"},
        }
    )
    assert released is not None
    assert "+15550100000" not in json.dumps(released)


def test_execute_live_writes_checkpoint_and_redacts_result(tmp_path, monkeypatch):
    monkeypatch.setattr(call_runtime, "STATE_DIR", tmp_path / "state")
    request = task_builder.validate_request(
        {
            "workflow_id": "demo-checkin-001",
            "phone": "+15550100000",
            "region": "US",
            "locale": "en-US",
            "recipient_consented": True,
            "user_name": "Demo",
            "language": "en",
        }
    )
    task = task_builder.build_task(request)
    schema = task_builder.load_result_schema()
    key = task_builder.idempotency_key(request, task, schema)
    fake = FakeClient()
    payload = call_runtime.execute_live(
        request,
        fake,
        task=task,
        schema=schema,
        idempotency_key=key,
        timeout_seconds=30,
    )
    assert payload["structured_result_released"] is True
    assert "+12025550123" not in json.dumps(payload["structured_result"])
    checkpoint = call_runtime.checkpoint_path(key)
    assert checkpoint.is_file()
    saved = json.loads(checkpoint.read_text(encoding="utf-8"))
    assert saved["phase"] == "finished"
    assert saved["call_id"] == "call_demo_123"
    assert "+15550100000" not in checkpoint.read_text(encoding="utf-8")


def test_execute_live_resumes_from_accepted_checkpoint_without_second_create(tmp_path, monkeypatch):
    monkeypatch.setattr(call_runtime, "STATE_DIR", tmp_path / "state")
    request = task_builder.validate_request(
        {
            "workflow_id": "demo-checkin-002",
            "phone": "+15550100000",
            "region": "US",
            "locale": "en-US",
            "recipient_consented": True,
            "user_name": "Demo",
            "language": "en",
        }
    )
    task = task_builder.build_task(request)
    schema = task_builder.load_result_schema()
    key = task_builder.idempotency_key(request, task, schema)
    checkpoint = call_runtime.checkpoint_path(key)
    call_runtime.write_checkpoint(
        checkpoint,
        {
            "version": 1,
            "phase": "accepted",
            "idempotency_key": key,
            "workflow_id": request["workflow_id"],
            "masked_phone": "+1******000",
            "call_id": "call_existing_999",
        },
    )
    fake = FakeClient()
    call_runtime.execute_live(
        request,
        fake,
        task=task,
        schema=schema,
        idempotency_key=key,
        timeout_seconds=30,
    )
    assert fake.calls.create_args is None
    assert fake.calls.wait_args[0] == "call_existing_999"


def test_build_task_includes_crisis_guidance():
    request = task_builder.validate_request(
        {
            "workflow_id": "demo-checkin-003",
            "phone": "+15550100000",
            "region": "US",
            "locale": "en-US",
            "recipient_consented": True,
            "user_name": "Demo",
            "language": "en",
        }
    )
    task = task_builder.build_task(request)
    assert "Crisis and emergency" in task
    assert "emergency services" in task.lower()
