from __future__ import annotations

import json
import sqlite3
from dataclasses import replace
from datetime import date
from pathlib import Path

from . import db, redflags
from .extract import extract
from .models import (
    CallKind,
    CallRequest,
    CallState,
    CheckinScope,
    Extraction,
    Patient,
    ReviewStatus,
)
from .scan import RED_FLAG_PHRASE, extract_carried_words, scan

NO_CONSENT = "no_consent"
DECLINED = "declined"
OUTSIDE_READING_WINDOW = "outside_reading_window"

PRACTICE_NAME = "Ashgrove Medical Practice"

SKILL_DIR = (
    Path(__file__).resolve().parents[4] / "skills" / "holdfor-post-visit-followup"
)
RESULT_SCHEMA_PATH = SKILL_DIR / "result-schema.json"

WEEKDAYS = (
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
)


def result_schema() -> dict:
    """The published schema, read from the skill rather than restated here.

    One shape, two consumers. A schema copied into the app would drift from the one
    the skill documents, and the drift would show up as a field the board cannot read.
    """
    return json.loads(RESULT_SCHEMA_PATH.read_text(encoding="utf-8"))


# Pinned by tests. Each of these sentences carries a promise to the person on the
# line, so none of them is phrasing that may be improved in passing. The authored
# source is skills/holdfor-post-visit-followup/references/call-task.md.
#
# No dashes, no parentheses, no typography in anything spoken. These strings are read
# aloud by a text-to-speech engine, and punctuation it cannot pronounce is punctuation
# it may say out loud or pause in the wrong place for. Prose in the surrounding
# instructions is free to use whatever it likes; a spoken line is not.
DISCLOSURE = (
    f"This is an automated call from {PRACTICE_NAME}. I'm a computer, not a person, "
    "so I'll keep this short."
)
NEVER_ASK_PROMISE = (
    "I won't ask you for your date of birth, your address, your bank details or "
    "anything like that. I don't need them, and nobody from the practice will ever "
    "ask you for them over the phone. If anyone does, it isn't us."
)
CLOSING = (
    "Someone at the practice will read this today, and if you need another "
    "appointment they'll sort that out for you, so you won't have to ring in and "
    "wait on hold."
)
SAFETY_LINE = (
    "Thank you for telling me. That's something a person needs to hear, not a "
    "computer, so I'm going to stop here rather than get it wrong. Please ring 111 "
    "and tell them what you've just told me. They're there day and night, and "
    "they'll decide what happens next. If it feels like an emergency, ring 999. "
    "I'm letting the practice know we spoke, and someone there will see this today."
)


def weekday_of(seen_on: str) -> str:
    return WEEKDAYS[date.fromisoformat(seen_on).weekday()]


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


def build_task_text(
    scope: CheckinScope, medication_changed: bool, weekday: str
) -> str:
    """Render the authored script for one Patient.

    The red-flag phrases come from the same loader `scan()` uses. They are not
    hand-copied here, because a prompt list and a scanner list that were maintained
    separately would eventually disagree, and the call where they disagreed would be
    the one that needed both.
    """
    lines = [
        f"You are calling {scope.first_name} on behalf of {PRACTICE_NAME}, three days "
        "after an appointment. Speak slowly and plainly. Ask one question at a time "
        "and wait. Do not fill silence, and do not stack two questions together.",
        "",
        "OPENING — say these, in this order, before asking anything:",
        f'1. "Hello, is that {scope.first_name}?"',
        f'2. "{DISCLOSURE}"',
        f'3. "You saw someone here on {weekday}, and the practice asked me to check '
        'how you\'ve been getting on since."',
        f'4. "{NEVER_ASK_PROMISE}"',
        '5. "Is now a good time? If it isn\'t, just say so and I\'ll leave you be."',
        "",
        "If she says it is not a good time, thank her, say you will leave her be, and "
        "end the call. That is a complete outcome. Do not ask again and do not "
        "persuade her. Return declined set to true and leave the answers out; do not "
        "set stop_condition, because nothing went wrong.",
        "",
        "QUESTIONS — one at a time, in this order:",
        f'1. "Since {weekday}, are you feeling better, about the same, or worse?" '
        "-> feeling",
    ]
    if medication_changed:
        lines.append(
            '2. "Are you getting on alright with what they gave you?" -> medication_ok'
        )
    else:
        lines.append(
            "2. Skipped. Her medication was not changed, so do not ask about it. "
            'Record medication_ok as "not_asked".'
        )
    lines += [
        '3. "Is there anything worrying you?" -> her own words, verbatim',
        '4. "Would you like the surgery to see you again?" -> wants_seen',
        "",
        "Question 3 is the only source of the quote. Store a substring of what she "
        "actually said, with the turn it came from. Never summarise it, correct her "
        "English, or write a quote she did not say. If there is no clean span, record "
        "nothing — that is a valid answer, and a person will read the call instead.",
        "",
        f'CLOSING — say: "Thank you, {scope.first_name}. {CLOSING} Take care."',
        "",
        "NEVER ask her to confirm her surname, date of birth, address, postcode, NHS "
        "number, or anything resembling payment. You do not need any of it. If she "
        "offers such a detail, do not repeat it back and do not record it.",
        "",
        "NEVER answer anything clinical. You have no clinical knowledge and no access "
        "to her record. Do not reassure her, do not alarm her, and do not say whether "
        "something sounds normal or serious.",
        "",
        "STOP the call and read the line below, word for word, if any of these "
        "happens: she says anything on the list that follows; she asks you for "
        "clinical advice; somebody else comes on the line; or you have asked the same "
        "question three times without a usable answer.",
        "",
        "Stop if she says anything like:",
        redflags.prompt_block(),
        "",
        "THE LINE, word for word, then end the call:",
        f'"{SAFETY_LINE}"',
        "",
        "Read it exactly. Do not add to it, do not adapt it to what she said, and do "
        "not offer an opinion on what she told you.",
    ]
    return "\n".join(lines)


def recover_carried_words(result, extraction) -> Extraction:
    """Find her words deterministically when the agent chose none.

    Only fills a gap; it never overrides a span the agent already returned, and it
    never touches a refused extraction — a call refused for a fabricated quote does
    not get a better quote grafted onto it.

    The gap is worth closing because a Review Item with no quote gives a Reviewer
    less to release, and the second call is then one where she has to explain herself
    a third time. The recovered span is sliced out of her own turn, so nothing here
    can produce words she did not say.
    """
    if extraction.stop_reason is not None:
        return extraction
    if extraction.carried_words_text is not None:
        return extraction

    found = extract_carried_words(result.transcript)
    if found is None:
        return extraction

    text, index = found
    return replace(extraction, carried_words_text=text, carried_words_turn=index)


def settle_stop_condition(result, extraction) -> tuple[bool, str | None]:
    """Reconcile what the agent said about itself with what the transcript shows.

    The scanner runs whatever the agent reported, and a call the agent completed
    cleanly can still be flagged here. That asymmetry is the whole point of
    docs/adr/0005-stop-conditions-are-enforced-twice.md: the prompt layer serves the
    Patient, this layer serves the Practice, and only one of them can be the record.

    A red flag always takes the reason slot, because it is what a Reviewer must see
    first. Otherwise an existing, more specific reason is kept — a fabricated quote
    tells a Reviewer something that "unmappable" would bury.

    A decline returns before any of that. She was reached and she said not now, so
    there are no answers to map and their absence says nothing about her health.
    Routing it through the scanner would label her "unmappable", put a flagged Review
    Item in front of a Reviewer, and invite exactly the callback she declined. The
    prompt already calls a decline a complete outcome; this is that same call being
    recorded as one.
    """
    if result.structured and result.structured.get("declined"):
        return False, DECLINED

    flagged, reason = scan(
        result.transcript,
        {
            "feeling": extraction.feeling,
            "medication_ok": extraction.medication_ok,
            "wants_seen": extraction.wants_seen,
        },
    )
    if not flagged:
        return extraction.stop_condition, extraction.stop_reason
    if reason == RED_FLAG_PHRASE or extraction.stop_reason is None:
        return True, reason
    return True, extraction.stop_reason


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
        task_text=build_task_text(
            patient.checkin_scope(),
            appointment.medication_changed,
            weekday_of(appointment.seen_on),
        ),
        result_schema=result_schema(),
        idempotency_key=key,
    )
    run_id = provider.place(request)
    result = provider.poll(run_id)
    extraction = recover_carried_words(
        result, extract(result, appointment.medication_changed)
    )
    stop_condition, stop_reason = settle_stop_condition(result, extraction)

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
            int(stop_condition),
            stop_reason,
            ReviewStatus.NEEDS_REVIEW.value,
            db.now_iso(),
        ),
    )
    conn.commit()
    return review.lastrowid
