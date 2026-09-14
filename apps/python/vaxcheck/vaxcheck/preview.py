"""Preview the plan without contacting anyone."""

from __future__ import annotations

import json

from .schema import RECIPIENT_RESULT_SCHEMA
from .task import Session, Student, build_task, idempotency_key


def render(session: Session, students: list[Student], *, show_task: bool = True) -> str:
    lines: list[str] = []
    add = lines.append

    add("=" * 70)
    add("PREVIEW - no call is placed, no credentials are used")
    add("=" * 70)
    add(f"School   : {session.school_name}")
    add(f"Vaccine  : {session.vaccine_name}")
    add(f"Session  : {session.session_date}")
    add(f"Corridor : {session.region} / {session.language}")
    add(f"Students : {len(students)}")
    add("")
    add("--- recipients (masked) ---")
    for s in students:
        add(
            f"  [{s.student_id}] {s.student_name} ({s.class_name}) "
            f"guardian {s.guardian_name} {s.masked_phone}"
        )
        add(f"        idempotency-key: {idempotency_key(session, s)}")

    if show_task:
        add("")
        add("--- call script sent to CALL-E (first student) ---")
        add(build_task(session, students[0]))

    add("--- result schema sent with every call ---")
    add(json.dumps(RECIPIENT_RESULT_SCHEMA, indent=2))
    add("")
    add(f"One CALL-E task per student: {len(students)} tasks, {len(students)} calls.")
    return "\n".join(lines)
