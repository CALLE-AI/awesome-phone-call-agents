"""Turn a CALL-E call task into per-student records.

CALL-E reports task-level judgement (`task_completed`, `completion_confidence`,
`evidence`) and per-recipient structured results. This module joins the two, so
every student record carries both what the guardian said and how much CALL-E
trusts its own reading of the call.

Unknown enum values are dropped rather than coerced. A value the schema did not
define is not a signal we understand, and triage treats absence as "route to a
human" - which is the behaviour we want.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from .phone import redact
from .schema import enum_for, recipient_fields
from .task import Student
from .triage import Triage, triage_record


@dataclass
class StudentRecord:
    student_id: str
    student_name: str
    class_name: str
    masked_phone: str
    result: dict[str, Any] = field(default_factory=dict)
    triage: Triage = field(default_factory=lambda: Triage("unreachable", ["not run"]))
    confidence: float | None = None
    task_completed: bool | None = None
    evidence: list[str] = field(default_factory=list)
    summary: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "student_id": self.student_id,
            "student_name": self.student_name,
            "class_name": self.class_name,
            "guardian_phone": self.masked_phone,
            "disposition": self.triage.disposition,
            "reasons": list(self.triage.reasons),
            "task_completed": self.task_completed,
            "completion_confidence": self.confidence,
            "result": dict(self.result),
            "evidence": list(self.evidence),
            "summary": self.summary,
        }


def sanitize(raw: Any) -> dict[str, Any]:
    """Keep only schema-defined fields with schema-legal values."""
    if not isinstance(raw, dict):
        return {}
    clean: dict[str, Any] = {}
    for key in recipient_fields():
        if key not in raw:
            continue
        value = raw[key]
        allowed = enum_for(key)
        if allowed is None:
            if isinstance(value, str):
                clean[key] = redact(value.strip())
        elif isinstance(value, str) and value.strip() in allowed:
            clean[key] = value.strip()
    return clean


def _confidence(call: dict[str, Any]) -> float | None:
    conf = call.get("completion_confidence")
    if isinstance(conf, dict):
        score = conf.get("score")
        if isinstance(score, (int, float)):
            return float(score)
    elif isinstance(conf, (int, float)):
        return float(conf)
    return None


def record_from_call(
    call: dict[str, Any],
    student: Student,
    *,
    min_confidence: float | None = None,
) -> StudentRecord:
    """Build one student record from that student's own call task."""
    task_completed = call.get("task_completed")
    confidence = _confidence(call)
    evidence = [redact(e) for e in (call.get("evidence") or []) if isinstance(e, str)]

    # One task per student, so the task's single recipient is this student. Fall
    # back to the task-level structured result if the recipient row is absent.
    recipient: dict[str, Any] = {}
    for candidate in call.get("recipients") or []:
        if isinstance(candidate, dict):
            recipient = candidate
            break

    raw = recipient.get("structured_result")
    if not raw:
        raw = call.get("structured_result")
    result = sanitize(raw)

    kwargs = {} if min_confidence is None else {"min_confidence": min_confidence}
    return StudentRecord(
        student_id=student.student_id,
        student_name=student.student_name,
        class_name=student.class_name,
        masked_phone=student.masked_phone,
        result=result,
        triage=triage_record(
            result,
            task_completed=task_completed,
            confidence=confidence,
            **kwargs,
        ),
        confidence=confidence,
        task_completed=task_completed,
        evidence=evidence,
        summary=redact(recipient.get("summary") or call.get("summary")) or None,
    )


def records_from_calls(
    pairs: list[tuple[Student, dict[str, Any]]],
    *,
    min_confidence: float | None = None,
) -> list[StudentRecord]:
    """Build records for a roster, preserving roster order."""
    return [
        record_from_call(call, student, min_confidence=min_confidence)
        for student, call in pairs
    ]
