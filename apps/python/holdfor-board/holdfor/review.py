"""The board: what auto-closes, what a Reviewer sees, and what a Release may carry.

A Review Item is created needing a human. Auto-closing is an active step taken
afterwards, never the default — if this module were never called, every call would
wait for a person, which is the failure we can live with.

The narrowing rule lives here rather than in the form, because it is the product and
not a UI nicety. See docs/adr/0003-a-release-grants-a-bounded-authority.md.
"""

from __future__ import annotations

import json
import sqlite3
from datetime import date
from pathlib import Path

from . import db
from .models import AppointmentMode, ReviewStatus, TimeOfDay, Turn

APP_ROOT = Path(__file__).resolve().parents[1]

SETTLED_FEELINGS = frozenset({"better", "same"})

# What blocks a person from acting on an item twice: Release, Close, Ring them myself.
# Deliberately not the same as "nothing more can happen" — a released item is still
# waiting for its call, and that call has an outcome to write. See docs/adr/0010.
#
# reception_declined and not_reached are absent on purpose. Both are the board asking a
# human to ring, so both must stay actionable; an item nobody can touch is not a handover.
HUMAN_SETTLED = frozenset(
    {
        ReviewStatus.AUTO_CLOSED.value,
        ReviewStatus.RELEASED.value,
        ReviewStatus.CLOSED.value,
        ReviewStatus.RANG_MANUALLY.value,
        ReviewStatus.BOOKED.value,
    }
)

# Where a Rebooking Call outcome may move an item, and the only statuses that may be
# written by the code that placed it rather than by a person.
REBOOKING_OUTCOMES = frozenset(
    {
        ReviewStatus.BOOKED.value,
        ReviewStatus.RECEPTION_DECLINED.value,
        ReviewStatus.NOT_REACHED.value,
        ReviewStatus.NEEDS_REVIEW.value,
    }
)

# Which agent question each answer came from. Tolerant fragments, not the whole
# sentence: the wording is authored in the skill's call-task.md and may be improved
# there without breaking the board. A fragment that stops matching costs one missing
# anchor, never an exception, and never a wrong anchor.
QUESTION_MARKERS = {
    "feeling": "better, about the same, or worse",
    "medication_ok": "getting on alright",
    "wants_seen": "see you again",
}

PATIENT = "other"
AGENT = "agent"


class Rejected(Exception):
    """A Release the board refuses to write, and the code the caller returns."""

    def __init__(self, status: int, code: str) -> None:
        super().__init__(code)
        self.status = status
        self.code = code


def auto_closes(item) -> bool:
    """Exact. Anything not satisfying all four clauses waits for a person.

    The gate is deliberately narrow. A wider one would auto-close precisely the calls
    that were worth making: a woman who says she feels worse, or who would like to be
    seen, or whose answer could not be mapped, is the reason the call was placed.
    """
    return (
        not item["stop_condition"]
        and item["feeling"] in SETTLED_FEELINGS
        and item["wants_seen"] == "no"
        and item["medication_ok"] is not None
    )


def settle(conn: sqlite3.Connection, review_item_id: int) -> str:
    """Apply the auto-close gate to one freshly created Review Item."""
    item = fetch(conn, review_item_id)
    if item is None:
        raise LookupError(f"No review item {review_item_id}")
    if item["status"] != ReviewStatus.NEEDS_REVIEW.value:
        return item["status"]
    if not auto_closes(item):
        return item["status"]

    conn.execute(
        "UPDATE review_item SET status = ? WHERE id = ?",
        (ReviewStatus.AUTO_CLOSED.value, review_item_id),
    )
    conn.commit()
    return ReviewStatus.AUTO_CLOSED.value


def fetch(conn: sqlite3.Connection, review_item_id: int) -> sqlite3.Row | None:
    return conn.execute(
        """
        SELECT review_item.*,
               call_attempt.transcript_path AS transcript_path,
               appointment.seen_on          AS seen_on,
               appointment.appointment_type AS appointment_type,
               patient.first_name           AS first_name,
               patient.surname              AS surname
        FROM review_item
        JOIN call_attempt ON call_attempt.id = review_item.call_attempt_id
        JOIN appointment  ON appointment.id  = call_attempt.appointment_id
        JOIN patient      ON patient.id      = appointment.patient_id
        WHERE review_item.id = ?
        """,
        (review_item_id,),
    ).fetchone()


def load_turns(transcript_path: str | None) -> list[Turn]:
    """Read the stored transcript. A missing file is an empty call, not a crash."""
    if not transcript_path:
        return []
    path = Path(transcript_path)
    if not path.is_absolute():
        path = APP_ROOT / path
    if not path.is_file():
        return []
    payload = json.loads(path.read_text(encoding="utf-8"))
    return [Turn(**turn) for turn in payload.get("turns", [])]


def anchors(item, turns: list[Turn]) -> dict[str, int]:
    """Which turn each answer came from, so a Reviewer can check one field alone.

    Without this a Reviewer has to read the whole call to trust a single word, and a
    board nobody trusts gets skimmed.
    """
    found: dict[str, int] = {}
    for field, marker in QUESTION_MARKERS.items():
        if item[field] is None:
            continue
        index = _answer_index(turns, marker)
        if index is not None:
            found[field] = index

    if item["carried_words_turn"] is not None:
        found["carried_words_text"] = item["carried_words_turn"]
    return found


def _answer_index(turns: list[Turn], marker: str) -> int | None:
    asked = False
    for turn in turns:
        if turn.speaker == AGENT and marker in turn.text.casefold():
            asked = True
            continue
        if asked and turn.speaker == PATIENT:
            return turn.index
    return None


def release(
    conn: sqlite3.Connection,
    review_item_id: int,
    body: dict,
) -> int:
    """Grant one bounded authority, and record who granted it.

    Every refusal here is a refusal to let a call happen, which is the safe direction.
    """
    item = fetch(conn, review_item_id)
    if item is None:
        raise LookupError(f"No review item {review_item_id}")
    if _existing_release(conn, review_item_id) is not None:
        raise Rejected(409, "already_released")
    if item["status"] in HUMAN_SETTLED:
        raise Rejected(409, "already_released")

    reviewer_name = str(body.get("reviewer_name") or "").strip()
    if not reviewer_name:
        raise Rejected(422, "reviewer_required")

    approved_words = _narrowed_words(item["carried_words_text"], body)
    envelope = _envelope(body)

    cursor = conn.execute(
        """
        INSERT INTO release
            (review_item_id, reviewer_name, released_at,
             earliest_date, latest_date, time_of_day, mode, clinician, approved_words)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            review_item_id,
            reviewer_name,
            db.now_iso(),
            envelope["earliest_date"],
            envelope["latest_date"],
            envelope["time_of_day"],
            envelope["mode"],
            envelope["clinician"],
            approved_words,
        ),
    )
    conn.execute(
        "UPDATE review_item SET status = ? WHERE id = ?",
        (ReviewStatus.RELEASED.value, review_item_id),
    )
    conn.commit()
    return cursor.lastrowid


def _narrowed_words(carried: str | None, body: dict) -> str:
    """A Reviewer may narrow the quote and may never widen it.

    Enforced on the substring, server-side. A widened quote would be spoken aloud to
    a receptionist as the Patient's own words, which is a third party being told she
    said something she did not.
    """
    approved = str(body.get("approved_words") or "")
    if carried is None:
        # Nothing was carried, so there is nothing to approve. An empty string is the
        # only honest Release here; words cannot be conjured from a call without them.
        if approved.strip():
            raise Rejected(422, "words_widened")
        return ""
    if approved not in carried:
        raise Rejected(422, "words_widened")
    return approved


def _envelope(body: dict) -> dict:
    earliest = _iso_date(body.get("earliest_date"))
    latest = _iso_date(body.get("latest_date"))
    if earliest > latest:
        raise Rejected(422, "envelope_invalid")

    time_of_day = str(body.get("time_of_day") or "")
    mode = str(body.get("mode") or "")
    if time_of_day not in {member.value for member in TimeOfDay}:
        raise Rejected(422, "envelope_invalid")
    if mode not in {member.value for member in AppointmentMode}:
        raise Rejected(422, "envelope_invalid")

    clinician = body.get("clinician")
    clinician = str(clinician).strip() if clinician else None

    return {
        "earliest_date": earliest.isoformat(),
        "latest_date": latest.isoformat(),
        "time_of_day": time_of_day,
        "mode": mode,
        "clinician": clinician or None,
    }


def _iso_date(value) -> date:
    try:
        return date.fromisoformat(str(value))
    except (TypeError, ValueError):
        raise Rejected(422, "envelope_invalid") from None


def _existing_release(conn: sqlite3.Connection, review_item_id: int) -> int | None:
    row = conn.execute(
        "SELECT id FROM release WHERE review_item_id = ?", (review_item_id,)
    ).fetchone()
    return row["id"] if row else None


def terminate(
    conn: sqlite3.Connection, review_item_id: int, status: ReviewStatus
) -> str:
    """Close an item, or take it off the agent entirely. Neither writes a Release."""
    item = fetch(conn, review_item_id)
    if item is None:
        raise LookupError(f"No review item {review_item_id}")
    if item["status"] in HUMAN_SETTLED:
        raise Rejected(409, "already_settled")

    conn.execute(
        "UPDATE review_item SET status = ? WHERE id = ?",
        (status.value, review_item_id),
    )
    conn.commit()
    return status.value


def settle_rebooking(
    conn: sqlite3.Connection, review_item_id: int, status: ReviewStatus
) -> str:
    """Write a Rebooking Call's outcome onto the item that authorised it.

    Only ever from `released`, and only ever by the code that placed the call. The two
    guards are a pair: `terminate` refuses an item that is already released, and this
    refuses an item that is anything else. Without both, a Release would be the last
    thing that could happen to a Review Item and the call it authorised would have
    nowhere to land. See docs/adr/0010.
    """
    if status.value not in REBOOKING_OUTCOMES:
        raise Rejected(422, "not_a_rebooking_outcome")

    item = fetch(conn, review_item_id)
    if item is None:
        raise LookupError(f"No review item {review_item_id}")
    if item["status"] != ReviewStatus.RELEASED.value:
        raise Rejected(409, "not_released")

    conn.execute(
        "UPDATE review_item SET status = ? WHERE id = ?",
        (status.value, review_item_id),
    )
    conn.commit()
    return status.value


def released_awaiting_call(conn: sqlite3.Connection) -> list[sqlite3.Row]:
    """Items a Reviewer has released whose Rebooking Call has not been placed.

    A released item is not on the queue and not settled either, so without this it is
    invisible: nobody can see it waiting and nothing can place its call. See
    docs/adr/0006, amendment.
    """
    return conn.execute(
        """
        SELECT review_item.id            AS id,
               patient.first_name        AS first_name,
               patient.surname           AS surname,
               release.id                AS release_id,
               release.earliest_date     AS earliest_date,
               release.latest_date       AS latest_date,
               release.time_of_day       AS time_of_day,
               release.mode              AS mode,
               release.clinician         AS clinician,
               release.approved_words    AS approved_words,
               release.reviewer_name     AS reviewer_name,
               rebooking.id              AS rebooking_attempt_id,
               rebooking.state           AS rebooking_state
        FROM review_item
        JOIN release      ON release.review_item_id = review_item.id
        JOIN call_attempt AS checkin_call
                          ON checkin_call.id = review_item.call_attempt_id
        JOIN appointment  ON appointment.id = checkin_call.appointment_id
        JOIN patient      ON patient.id = appointment.patient_id
        LEFT JOIN call_attempt AS rebooking
                          ON rebooking.idempotency_key = 'rebooking:' || release.id
        WHERE review_item.status = ?
        ORDER BY release.released_at DESC, review_item.id DESC
        """,
        (ReviewStatus.RELEASED.value,),
    ).fetchall()
