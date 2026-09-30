"""Fixture replay - no network, no credentials, no phone call.

This is the default execution path for development and for the demo. It builds
CALL-E-shaped task payloads from conversation fixtures and feeds them through the
same sanitiser, triage, and report code the live path uses, so the logic being
exercised is the real logic.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .task import Student

FIXTURE_DIR = Path(__file__).resolve().parent.parent / "fixtures"


def load_fixture(name_or_path: str) -> dict[str, Any]:
    p = Path(name_or_path)
    if not p.is_file():
        p = FIXTURE_DIR / name_or_path
    if not p.is_file() and not str(name_or_path).endswith(".json"):
        p = FIXTURE_DIR / f"{name_or_path}.json"
    if not p.is_file():
        raise FileNotFoundError(f"fixture not found: {name_or_path}")
    return json.loads(p.read_text(encoding="utf-8"))


def build_call(student: Student, fixture: dict[str, Any], index: int = 0) -> dict[str, Any]:
    """Assemble one CALL-E `call_task`-shaped payload for one student."""
    confidence = fixture.get("completion_confidence")
    return {
        "id": f"call_mock_{index}",
        "object": "call_task",
        "status": "completed",
        "task_completed": fixture.get("task_completed"),
        "completion_confidence": (
            {"score": float(confidence), "label": "mock"}
            if isinstance(confidence, (int, float))
            else None
        ),
        "evidence": [e for e in (fixture.get("evidence") or []) if isinstance(e, str)],
        "summary": fixture.get("summary"),
        "recipients": [
            {
                "id": f"rcp_mock_{index}",
                "phones": [student.guardian_phone],
                "status": fixture.get("recipient_status", "completed"),
                "structured_result": fixture.get("structured_result"),
                "summary": fixture.get("summary"),
                "attempts": fixture.get("attempts", []),
            }
        ],
    }


def build_calls(
    students: list[Student], fixtures: list[dict[str, Any]]
) -> list[tuple[Student, dict[str, Any]]]:
    """Pair each student with a replayed call.

    Fixtures are applied in roster order and cycled when there are fewer fixtures
    than students, which keeps demo rosters easy to vary.
    """
    if not fixtures:
        raise ValueError("at least one fixture is required")
    return [
        (student, build_call(student, fixtures[i % len(fixtures)], i))
        for i, student in enumerate(students)
    ]
