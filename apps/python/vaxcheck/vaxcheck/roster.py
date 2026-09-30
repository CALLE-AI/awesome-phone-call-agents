"""Roster loading and validation."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .task import Session, Student


class RosterError(ValueError):
    pass


def load(path: str | Path) -> tuple[Session, list[Student]]:
    p = Path(path)
    if not p.is_file():
        raise RosterError(f"roster file not found: {p}")
    try:
        raw: Any = json.loads(p.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise RosterError(f"roster is not valid JSON: {exc}") from exc

    if not isinstance(raw, dict):
        raise RosterError("roster must be a JSON object")

    try:
        session = Session.from_dict(raw.get("session") or {})
    except ValueError as exc:
        raise RosterError(str(exc)) from exc

    entries = raw.get("students")
    if not isinstance(entries, list) or not entries:
        raise RosterError("roster needs a non-empty 'students' array")

    students: list[Student] = []
    seen: set[str] = set()
    for i, entry in enumerate(entries):
        if not isinstance(entry, dict):
            raise RosterError(f"students[{i}] must be an object")
        try:
            student = Student.from_dict(entry)
        except ValueError as exc:
            raise RosterError(f"students[{i}]: {exc}") from exc
        if student.student_id in seen:
            # Duplicate ids would produce duplicate idempotency keys and a
            # second call to the same family.
            raise RosterError(f"duplicate student_id: {student.student_id}")
        seen.add(student.student_id)
        students.append(student)

    return session, students
