import json
from pathlib import Path

import pytest

from task_builder import build_task, preview_plan


def test_preview_masks_phone():
    req = {
        "workflow_id": "t1",
        "phone": "+972501234567",
        "recipient_consented": True,
        "user_name": "Test",
        "language": "ru",
    }
    plan = preview_plan(req)
    assert "501234567" not in plan["masked_phone"]
    assert "task_preview" in plan


def test_build_task_includes_phone_and_persona():
    req = {
        "workflow_id": "t2",
        "phone": "+15550100000",
        "recipient_consented": True,
        "user_name": "Sonya",
        "language": "ru",
        "max_minutes": 5,
    }
    task = build_task(req)
    assert "+15550100000" in task
    assert "Sonya" in task
    assert "медицин" in task.lower() or "medical" in task.lower()


def test_example_request_is_valid_json():
    path = Path("example_request.json")
    data = json.loads(path.read_text(encoding="utf-8"))
    assert data["recipient_consented"] is True
