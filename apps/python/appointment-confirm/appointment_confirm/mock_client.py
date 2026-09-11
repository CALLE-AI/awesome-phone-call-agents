"""In-process CALL-E stand-in driven by a conversation fixture."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .extract import evidence_from_turns, extract_from_turns


class MockCalleClient:
    """Implements create_and_wait using a local transcript fixture."""

    def __init__(self, fixture: dict[str, Any], intake: dict[str, Any]):
        self.fixture = fixture
        self.intake = intake

    def create_and_wait(self, **kwargs: Any) -> dict[str, Any]:
        turns = self.fixture.get("transcript_turns") or []
        if not isinstance(turns, list):
            raise ValueError("fixture transcript_turns must be a list")
        structured = extract_from_turns(turns, self.intake)
        expected = self.fixture.get("expected_structured_result")
        if isinstance(expected, dict):
            # Fixture author can pin the schema fields; extractor still runs in tests.
            for key in ("can_attend", "confirmed_time", "requested_time", "disposition"):
                if key in expected:
                    structured[key] = expected[key]
        evidence = self.fixture.get("evidence") or evidence_from_turns(turns)
        confidence = self.fixture.get(
            "completion_confidence", {"score": 0.93, "label": "high"}
        )
        call_id = self.fixture.get("call_id", "call_mock_appointment_confirm")
        return {
            "id": call_id,
            "status": self.fixture.get("status", "completed"),
            "task_completed": self.fixture.get("task_completed", True),
            "completion_confidence": confidence,
            "evidence": evidence,
            "structured_result": {"completed_count": 1},
            "recipients": [
                {
                    "phones": [self.intake["phone"]],
                    "region": self.intake["region"],
                    "locale": self.intake["locale"],
                    "structured_result": structured,
                    "attempts": [{"transcript_turns": turns}],
                }
            ],
            "metadata": kwargs.get("metadata") or {},
        }


def load_fixture(path: Path) -> dict[str, Any]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError("fixture must be a JSON object")
    return data
