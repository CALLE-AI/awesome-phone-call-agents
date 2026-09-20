"""Live CALL-E execution via the official Python SDK.

This is the only path that places real phone calls. It is never the default and
is guarded twice: an explicit `--execute` flag and an explicit
`--confirm-consent` acknowledgement.

Every request carries a deterministic `Idempotency-Key` derived from the school,
session date, and student id, so re-running a roster after a crash resumes
rather than re-calling families who were already reached.
"""

from __future__ import annotations

from typing import Any

from .origins import OriginError, approved_base_url
from .phone import redact
from .schema import RECIPIENT_RESULT_SCHEMA
from .task import Session, Student, build_task, idempotency_key


class LiveClientError(RuntimeError):
    pass


def _client(api_key: str, base_url: str | None):
    try:
        from calle import CalleClient
    except ImportError as exc:  # pragma: no cover - depends on optional install
        raise LiveClientError(
            "the CALL-E SDK is not installed. Run: pip install 'calle-ai>=0.7.0'"
        ) from exc
    try:
        origin = approved_base_url(base_url)
    except OriginError as exc:
        raise LiveClientError(str(exc)) from exc
    return CalleClient(api_key=api_key, base_url=origin)


def bind_resumed_call(call: dict[str, Any], session: Session, student: Student) -> dict[str, Any]:
    """Accept a fetched call only if its metadata names this student and session.

    Never matches by phone: siblings share a guardian's number, and a call id
    typed by hand could belong to another roster. The binding is the metadata
    this app wrote when it created the call.
    """
    meta = call.get("metadata") if isinstance(call.get("metadata"), dict) else {}
    expected = {
        "app": "vaxcheck",
        "student_id": student.student_id,
        "school": session.school_name,
        "session_date": session.session_date,
    }
    mismatched = [k for k, v in expected.items() if meta.get(k) != v]
    if mismatched:
        raise LiveClientError(
            f"call {call.get('id')} is not bound to student {student.student_id} in this "
            f"session (metadata mismatch on: {', '.join(mismatched)}). Nothing was resumed."
        )
    return call


def call_student(
    session: Session,
    student: Student,
    *,
    api_key: str,
    base_url: str | None = None,
    timeout_seconds: float = 900.0,
    webhook_url: str | None = None,
    client: Any | None = None,
) -> dict[str, Any]:
    """Place one real call for one student and wait for its terminal result.

    One task per student: the script names that child, the confidence score backs
    that child's decision, and the idempotency key is stable per child.
    """
    client = client or _client(api_key, base_url)

    try:
        call = client.calls.create(
            task=build_task(session, student),
            recipients=[
                {
                    "phones": [student.guardian_phone],
                    "region": session.region,
                }
            ],
            result_schema=RECIPIENT_RESULT_SCHEMA,
            recipient_result_schema=RECIPIENT_RESULT_SCHEMA,
            metadata={
                "app": "vaxcheck",
                "school": session.school_name,
                "session_date": session.session_date,
                "vaccine": session.vaccine_name,
                "student_id": student.student_id,
            },
            webhook_url=webhook_url,
            idempotency_key=idempotency_key(session, student),
        )
    except Exception as exc:  # noqa: BLE001 - surfaced to the operator verbatim
        raise LiveClientError(
            f"CALL-E create failed for {student.student_id}: {redact(str(exc))}"
        ) from exc

    call_id = call.get("id")
    if not call_id:
        raise LiveClientError(f"CALL-E returned no call id for {student.student_id}")

    try:
        return client.calls.wait_for_result(call_id, timeout_seconds=timeout_seconds)
    except Exception as exc:  # noqa: BLE001
        raise LiveClientError(
            f"call {call_id} for {student.student_id} started but waiting failed: "
            f"{redact(str(exc))}. Resume with: --resume {call_id} --student {student.student_id}"
        ) from exc


def run_session(
    session: Session,
    students: list[Student],
    *,
    api_key: str,
    base_url: str | None = None,
    timeout_seconds: float = 900.0,
    webhook_url: str | None = None,
    on_progress: Any | None = None,
    client: Any | None = None,
) -> list[tuple[Student, dict[str, Any]]]:
    """Call every guardian on the roster, one task each.

    Calls run sequentially and a failure stops the run. A partial roster of real
    results is recoverable; a half-finished burst of calls to families is not.
    Re-running resumes safely because each key is deterministic.
    """
    if not students:
        raise LiveClientError("roster is empty")

    client = client or _client(api_key, base_url)
    pairs: list[tuple[Student, dict[str, Any]]] = []
    for student in students:
        if on_progress:
            on_progress(student)
        call = call_student(
            session,
            student,
            api_key=api_key,
            base_url=base_url,
            timeout_seconds=timeout_seconds,
            webhook_url=webhook_url,
            client=client,
        )
        pairs.append((student, call))
    return pairs


def fetch_call(call_id: str, *, api_key: str, base_url: str | None = None) -> dict[str, Any]:
    client = _client(api_key, base_url)
    try:
        return client.calls.get(call_id)
    except Exception as exc:  # noqa: BLE001
        raise LiveClientError(f"could not fetch call {call_id}: {redact(str(exc))}") from exc
