from __future__ import annotations

import sqlite3

from . import db
from .extract import extract
from .models import (
    CallKind,
    CallRequest,
    CallState,
    CheckinScope,
    Patient,
    ReviewStatus,
)

NO_CONSENT = "no_consent"
OUTSIDE_READING_WINDOW = "outside_reading_window"

RESULT_SCHEMA = {
    "type": "object",
    "properties": {
        "feeling": {"enum": ["better", "same", "worse", "unsure"]},
        "medication_ok": {"enum": ["yes", "no", "unsure", "not_asked"]},
        "wants_seen": {"enum": ["yes", "no", "unsure"]},
        "carried_words_text": {"type": ["string", "null"]},
        "carried_words_turn": {"type": ["integer", "null"]},
        "stop_condition": {"type": "boolean"},
        "stop_reason": {"type": ["string", "null"]},
    },
    "required": ["feeling", "wants_seen", "stop_condition"],
}


class Refused(Exception):
    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


def idempotency_key(appointment_id: int) -> str:
    return f"checkin:{appointment_id}"


def preflight(patient: Patient) -> str | None:
    if not patient.consent_to_call:
        return NO_CONSENT
    return None


def build_task_text(scope: CheckinScope, medication_changed: bool) -> str:
    lines = [
        f"Call {scope.first_name} on behalf of Ashgrove Medical Practice.",
        "Open by naming the practice and saying this is a follow-up on a recent appointment.",
        "Say you cannot answer questions and that the practice will read every answer.",
        "Say that hanging up ends the calls for good.",
        "Never ask them to confirm their surname, date of birth, address or any other detail.",
        "Ask whether they feel better, about the same, or worse.",
    ]
    if medication_changed:
        lines.append(
            "Ask whether they are managing to take the changed medication as prescribed."
        )
    lines += [
        "Ask whether there is anything they would like the practice to know.",
        "Ask whether they would like to be seen again about this.",
        "Close by saying someone at the practice will read this today.",
    ]
    return "\n".join(lines)


def _transcript_path(provider, run_id: str) -> str | None:
    getter = getattr(provider, "transcript_path", None)
    return getter(run_id) if getter else None


def existing_review_item(conn: sqlite3.Connection, key: str) -> int | None:
    row = conn.execute(
        """
        SELECT review_item.id AS id
        FROM call_attempt
        JOIN review_item ON review_item.call_attempt_id = call_attempt.id
        WHERE call_attempt.idempotency_key = ?
        """,
        (key,),
    ).fetchone()
    return row["id"] if row else None


def run(conn: sqlite3.Connection, provider, appointment_id: int) -> int:
    appointment = db.appointment(conn, appointment_id)
    if appointment is None:
        raise LookupError(f"No appointment {appointment_id}")
    patient = db.patient(conn, appointment.patient_id)
    if patient is None:
        raise LookupError(f"No patient {appointment.patient_id}")

    refusal = preflight(patient)
    if refusal:
        raise Refused(refusal)

    key = idempotency_key(appointment_id)
    already = existing_review_item(conn, key)
    if already is not None:
        return already

    stamp = db.now_iso()
    try:
        cursor = conn.execute(
            """
            INSERT INTO call_attempt
                (appointment_id, kind, idempotency_key, state, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                appointment_id,
                CallKind.CHECKIN.value,
                key,
                CallState.RESERVED.value,
                stamp,
                stamp,
            ),
        )
        conn.commit()
    except sqlite3.IntegrityError:
        conn.rollback()
        already = existing_review_item(conn, key)
        if already is None:
            raise
        return already

    attempt_id = cursor.lastrowid
    request = CallRequest(
        to_e164=patient.phone_e164,
        task_text=build_task_text(patient.checkin_scope(), appointment.medication_changed),
        result_schema=RESULT_SCHEMA,
        idempotency_key=key,
    )
    run_id = provider.place(request)
    result = provider.poll(run_id)
    extraction = extract(result, appointment.medication_changed)

    conn.execute(
        """
        UPDATE call_attempt
        SET provider_run_id = ?, state = ?, transcript_path = ?, updated_at = ?
        WHERE id = ?
        """,
        (
            run_id,
            result.state.value,
            _transcript_path(provider, run_id),
            db.now_iso(),
            attempt_id,
        ),
    )
    review = conn.execute(
        """
        INSERT INTO review_item
            (call_attempt_id, feeling, medication_ok, wants_seen,
             carried_words_text, carried_words_turn,
             stop_condition, stop_reason, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            attempt_id,
            extraction.feeling.value if extraction.feeling else None,
            extraction.medication_ok.value if extraction.medication_ok else None,
            extraction.wants_seen.value if extraction.wants_seen else None,
            extraction.carried_words_text,
            extraction.carried_words_turn,
            int(extraction.stop_condition),
            extraction.stop_reason,
            ReviewStatus.NEEDS_REVIEW.value,
            db.now_iso(),
        ),
    )
    conn.commit()
    return review.lastrowid
