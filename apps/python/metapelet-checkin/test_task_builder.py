import importlib.util
import json
import subprocess
import sys
from pathlib import Path

import pytest

APP_ROOT = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("metapelet_task_builder", APP_ROOT / "task_builder.py")
assert SPEC and SPEC.loader
task_builder = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = task_builder
SPEC.loader.exec_module(task_builder)


def valid_request(**overrides) -> dict:
    base = {
        "workflow_id": "demo-checkin-001",
        "phone": "+15550100000",
        "region": "US",
        "locale": "en-US",
        "recipient_consented": True,
        "user_name": "Demo",
        "language": "en",
        "max_minutes": 5,
        "include_demo_profile": True,
    }
    base.update(overrides)
    return task_builder.validate_request(base)


def test_validate_request_rejects_bad_e164():
    with pytest.raises(ValueError, match="E.164"):
        task_builder.validate_request(
            {
                "workflow_id": "demo-001",
                "phone": "5550100000",
                "region": "US",
                "locale": "en-US",
                "recipient_consented": True,
                "user_name": "Demo",
                "language": "en",
            }
        )


def test_preview_masks_phone_and_hides_full_number_in_stdout(tmp_path):
    request_path = tmp_path / "request.json"
    request_path.write_text(json.dumps(valid_request()), encoding="utf-8")
    result = subprocess.run(
        [sys.executable, "client.py", "--request", str(request_path)],
        cwd=APP_ROOT,
        text=True,
        capture_output=True,
        timeout=15,
    )
    assert result.returncode == 0, result.stderr
    assert "+15550100000" not in result.stdout
    parsed = json.loads(result.stdout.split("Preview only")[0].strip())
    assert parsed["mode"] == "preview"
    assert parsed["creates_phone_call"] is False
    assert "5550100000" not in parsed["task_preview"]


def test_idempotency_changes_when_phone_or_task_changes():
    req_a = valid_request()
    req_b = valid_request(phone="+15550100001")
    task_a = task_builder.build_task(req_a)
    schema = task_builder.load_result_schema()
    key_a = task_builder.idempotency_key(req_a, task_a, schema)
    key_b = task_builder.idempotency_key(req_b, task_builder.build_task(req_b), schema)
    assert key_a != key_b
    key_a_retry = task_builder.idempotency_key(req_a, task_a, schema)
    assert key_a == key_a_retry


def test_build_task_uses_explicit_region_not_phone_guess():
    req = valid_request(phone="+972501234567", region="IL", locale="he-IL", language="he")
    recipients = task_builder.build_recipients(req)
    assert recipients == [{"phones": ["+972501234567"], "region": "IL", "locale": "he-IL"}]


def test_example_request_is_valid_json():
    path = APP_ROOT / "example_request.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    parsed = task_builder.validate_request(data)
    assert parsed["recipient_consented"] is True
