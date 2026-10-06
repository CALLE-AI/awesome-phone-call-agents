"""Shared test helpers: synthetic CALL-E call_task dicts."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))


def make_call(
    status: str = "completed",
    structured_result: dict | None = None,
    task_completed: bool | None = None,
    turns: list[tuple[str, str]] | None = None,
    summary: str | None = None,
) -> dict:
    return {
        "object": "call_task",
        "id": "call_test",
        "status": status,
        "task": "test task",
        "recipients": [
            {
                "id": "rcpt_test",
                "phones": ["+15555550100"],
                "status": "completed",
                "structured_result": structured_result,
                "summary": summary,
                "attempts": [
                    {
                        "id": "attempt_test",
                        "phone": "+15555550100",
                        "status": "completed" if turns else "no_answer",
                        "transcript_turns": [
                            {"offset_seconds": i * 5, "speaker": s, "text": t}
                            for i, (s, t) in enumerate(turns or [])
                        ],
                    }
                ],
            }
        ],
        "structured_result": structured_result,
        "summary": summary,
        "task_completed": task_completed,
        "completion_confidence": None,
        "evidence": [],
        "metadata": {},
        "failure_code": None,
        "failure_message": None,
    }
