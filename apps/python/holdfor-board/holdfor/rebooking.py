"""Call two: the practice's own booking line, on the patient's behalf.

Everything here happens after a Release and inside its Booking Envelope. The agent may
accept an offer while reception waits, because CALL-E has no callback during a call and
somebody has to answer her; what the agent accepted is then read again by `match_offer`,
deterministically, against the release row that authorised the call. See docs/adr/0007.

The two readings are not the same check twice. The first exists for the receptionist: it
is what lets the call move at the speed of a conversation. The second exists for the
practice: it is what makes "the agent only accepts inside the envelope" a property of
this module rather than a request made of a model.
"""

from __future__ import annotations

import os
import re
import sqlite3
from datetime import date, datetime, time, timedelta

from . import db, review
from .checkin import PRACTICE_NAME
from .models import (
    AppointmentMode,
    CallKind,
    CallRequest,
    CallState,
    RebookingScope,
    ReviewStatus,
    TimeOfDay,
    Turn,
)
from .outcomes import review_status_for

BOOKING_LINE = "HOLDFOR_BOOKING_LINE"

# A practice books inside these hours, so a bare clock time has only one reading a
# surgery would ever offer. We do not use this to guess a missing am or pm: the model
# transcribes the time it heard, and these hours are what catches it transcribing 21:10
# for "ten past nine". A time outside them is flagged, never quietly corrected.
# See docs/adr/0008.
PRACTICE_OPENS = time(8, 0)
PRACTICE_CLOSES = time(18, 30)
AFTERNOON_FROM = time(12, 0)

# The longest envelope the day match can serve. Beyond a month, two of the same
# day-of-month fall inside it and the ambiguity we avoided comes back. A Reviewer
# authorising five weeks has not narrowed anything, so this is a limit on the Release
# rather than a shortcoming of the matcher.
MAX_ENVELOPE_DAYS = 31

INSIDE = "inside"
OUTSIDE = "outside"
UNREADABLE = "unreadable"

SLOT_OFFERED = "slot_offered"
REFUSED_THIRD_PARTY = "refused_third_party"
NO_SLOTS = "no_slots"
UNCLEAR = "unclear"

RECEPTION = "other"
COMPLETED = "COMPLETED"

NO_BOOKING_LINE = "no_booking_line"
NOT_RELEASED = "not_released"
ENVELOPE_TOO_WIDE = "envelope_too_wide"

FIXED_LINE = (
    "I'm only able to pass on what she said. The practice has the rest on file."
)

WEEKDAYS = {
    "monday": 0,
    "tuesday": 1,
    "wednesday": 2,
    "thursday": 3,
    "friday": 4,
    "saturday": 5,
    "sunday": 6,
}

_DAY_OF_MONTH = re.compile(r"\b([0-9]{1,2})(?:st|nd|rd|th)?\b")

# What the second call is allowed to report. `offers` is a list because reception
# revises: the Binding Acceptance is the last accepted entry, and the earlier ones are
# kept as evidence rather than overwritten. See docs/adr/0012.
RESULT_SCHEMA = {
    "type": "object",
    "properties": {
        "offers": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "turn": {
                        "type": "integer",
                        "description": (
                            "Index of the reception turn this offer was spoken in. "
                            "Never a turn you spoke yourself."
                        ),
                    },
                    "time": {
                        "type": ["string", "null"],
                        "description": (
                            "The clock time as 24-hour HH:MM, transcribed from what "
                            "she said. Null if she named a day but no time."
                        ),
                    },
                    "accepted": {
                        "type": "boolean",
                        "description": "Whether you said yes to this offer.",
                    },
                },
                "required": ["turn", "accepted"],
            },
        },
        "reception_outcome": {
            "enum": [SLOT_OFFERED, REFUSED_THIRD_PARTY, NO_SLOTS, UNCLEAR],
            "description": "How the call ended in words. Use unclear over guessing.",
        },
        "reception_outcome_turn": {"type": ["integer", "null"]},
    },
    "required": ["offers", "reception_outcome"],
}


class Refused(Exception):
    """A Rebooking Call this module declines to place, and the reason."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


def idempotency_key(release_id: int) -> str:
    return f"rebooking:{release_id}"


def booking_line() -> str | None:
    """The practice's booking line, from the environment or nowhere.

    No default, on purpose. An absent number means no Rebooking Call can be placed,
    which is the right failure: a wrong default here dials a real practice.
    """
    number = (os.environ.get(BOOKING_LINE) or "").strip()
    return number or None


def envelope_days(earliest: str, latest: str) -> list[date]:
    first = date.fromisoformat(earliest)
    last = date.fromisoformat(latest)
    span = (last - first).days
    if span < 0:
        return []
    if span + 1 > MAX_ENVELOPE_DAYS:
        raise Refused(ENVELOPE_TOO_WIDE)
    return [first + timedelta(days=offset) for offset in range(span + 1)]


def day_tokens(text: str) -> tuple[set[int], set[int]]:
    """Day-of-month numbers and weekday indices named in one turn.

    Deliberately tolerant and deliberately dumb: we are not resolving a date, only
    reading which days were named, so the envelope can be asked whether it holds one.
    """
    lowered = text.casefold()
    days = {
        int(match.group(1))
        for match in _DAY_OF_MONTH.finditer(lowered)
        if 1 <= int(match.group(1)) <= 31
    }
    weekdays = {index for name, index in WEEKDAYS.items() if name in lowered}
    return days, weekdays


def match_day(text: str, earliest: str, latest: str) -> tuple[str, date | None]:
    """Ask the envelope whether it holds a day this turn named.

    Never the other way round. Resolving "Tuesday the 26th" into a date needs a year, a
    month, and a rule for what Tuesday means today; asking a fortnight of candidate
    dates which one is both a Tuesday and a 26th needs none of them. See docs/adr/0008.
    """
    days, weekdays = day_tokens(text)
    if not days and not weekdays:
        return UNREADABLE, None

    candidates = envelope_days(earliest, latest)
    if days:
        candidates = [day for day in candidates if day.day in days]
    if weekdays:
        candidates = [day for day in candidates if day.weekday() in weekdays]

    if not candidates:
        return OUTSIDE, None
    if len(candidates) > 1:
        # A weekday with no day-of-month, inside an envelope longer than a week. Two
        # Tuesdays are two different appointments, so we take neither.
        return UNREADABLE, None
    return INSIDE, candidates[0]


def parse_clock(value: str | None) -> time | None:
    if not value:
        return None
    try:
        return datetime.strptime(str(value).strip(), "%H:%M").time()
    except ValueError:
        return None


def match_time(clock: time | None, wanted: str) -> str:
    """Check a transcribed clock time against practice hours, then the envelope."""
    if clock is None:
        # She named a day and no time. Where the Reviewer asked for a half of the day,
        # an offer with no time in it cannot be shown to satisfy that, so it is not
        # claimed to. Where they asked for any, there is nothing left to check.
        return INSIDE if wanted == TimeOfDay.ANY.value else UNREADABLE
    if clock < PRACTICE_OPENS or clock > PRACTICE_CLOSES:
        return UNREADABLE
    if wanted == TimeOfDay.ANY.value:
        return INSIDE
    half = (
        TimeOfDay.AFTERNOON.value
        if clock >= AFTERNOON_FROM
        else TimeOfDay.MORNING.value
    )
    return INSIDE if half == wanted else OUTSIDE


def match_offer(
    turn_text: str, clock_text: str | None, release: sqlite3.Row
) -> tuple[str, date | None, time | None]:
    """The Envelope Match for one offer. Returns a verdict, never a booking."""
    verdict, day = match_day(turn_text, release["earliest_date"], release["latest_date"])
    if verdict != INSIDE:
        return verdict, None, None

    clock = parse_clock(clock_text)
    time_verdict = match_time(clock, release["time_of_day"])
    if time_verdict != INSIDE:
        return time_verdict, day, clock
    return INSIDE, day, clock


def spoken_constraints(release: sqlite3.Row) -> list[str]:
    """The envelope in English, and only the parts a Reviewer actually narrowed.

    A field left open needs no confirmation from reception; a field narrowed must be
    heard aloud. That keeps the call short for the practice that did not care and
    strict for the one that did. See docs/adr/0003, amendment.
    """
    lines = [
        "Accept an appointment on or after "
        f"{release['earliest_date']} and on or before {release['latest_date']}."
    ]
    if release["time_of_day"] != TimeOfDay.ANY.value:
        lines.append(f"It must be in the {release['time_of_day']}.")
    if release["mode"] != AppointmentMode.ANY.value:
        spoken = (
            "face to face"
            if release["mode"] == AppointmentMode.IN_PERSON.value
            else "by telephone"
        )
        lines.append(
            f"It must be {spoken}. Only accept if you hear them say so. If they do not "
            "say it, do not assume it and do not accept."
        )
    if release["clinician"]:
        lines.append(
            f"It must be with {release['clinician']}. Only accept if you hear them say "
            "so. If they do not say it, do not assume it and do not accept."
        )
    lines.append(
        "Anything outside that is not acceptable. Say you cannot take it, say it will "
        "be passed back to the practice, and thank them. Never ask for something else, "
        "never explain why, never negotiate."
    )
    return lines


def build_task_text(scope: RebookingScope, release: sqlite3.Row) -> str:
    """What the agent may say, written as a whitelist. See docs/adr/0011."""
    lines = [
        f"Call the appointments line at {PRACTICE_NAME}.",
        "Say you are an automated assistant calling for the practice, about a patient "
        "following a check-in call.",
        f"Give her name: {scope.first_name} {scope.surname}.",
        f"If you are asked for her date of birth, give it: {scope.dob}. Do not give it "
        "before you are asked.",
        "Say she would like to be seen again.",
    ]
    if release["approved_words"]:
        lines.append(
            "Say these are her own words, then read them exactly as written and add "
            f'nothing to them: "{release["approved_words"]}"'
        )
    lines += spoken_constraints(release)
    lines += [
        "You may speak about three things only: this practice, what is written in "
        "these instructions, and her name and date of birth. If you are asked anything "
        "else, including what is wrong with her, whether she is with you, or who you "
        f'are, say exactly this and nothing more: "{FIXED_LINE}" Then return to '
        "arranging the appointment.",
        "Never answer a medical question. Never describe her condition. Never say "
        "anything about her that is not written above.",
        "If you are asked to wait or to hold, wait quietly. Do not speak again until "
        "somebody speaks to you.",
        "If they say they cannot book on behalf of another person, thank them and end "
        "the call. Do not argue, do not ask again, do not offer to call back.",
    ]
    return "\n".join(lines)


def release_row(conn: sqlite3.Connection, release_id: int) -> sqlite3.Row | None:
    return conn.execute(
        """
        SELECT release.*,
               review_item.id                 AS review_item_id,
               review_item.status             AS review_status,
               call_attempt.appointment_id    AS appointment_id,
               patient.first_name             AS first_name,
               patient.surname                AS surname,
               patient.dob                    AS dob
        FROM release
        JOIN review_item  ON review_item.id = release.review_item_id
        JOIN call_attempt ON call_attempt.id = review_item.call_attempt_id
        JOIN appointment  ON appointment.id = call_attempt.appointment_id
        JOIN patient      ON patient.id = appointment.patient_id
        WHERE release.id = ?
        """,
        (release_id,),
    ).fetchone()


def existing_attempt(conn: sqlite3.Connection, key: str) -> sqlite3.Row | None:
    return conn.execute(
        "SELECT * FROM call_attempt WHERE idempotency_key = ?", (key,)
    ).fetchone()


def reserve(conn: sqlite3.Connection, release_id: int) -> int:
    """Claim the one call this Release grants, without placing it.

    Returning an existing row rather than raising is what makes a second press
    harmless: no code path from here dials a practice twice for one Release.
    See docs/adr/0006, amendment.
    """
    row = release_row(conn, release_id)
    if row is None:
        raise LookupError(f"No release {release_id}")
    if row["review_status"] != ReviewStatus.RELEASED.value:
        raise Refused(NOT_RELEASED)

    key = idempotency_key(release_id)
    already = existing_attempt(conn, key)
    if already is not None:
        return already["id"]

    stamp = db.now_iso()
    try:
        cursor = conn.execute(
            """
            INSERT INTO call_attempt
                (appointment_id, kind, idempotency_key, state, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                row["appointment_id"],
                CallKind.REBOOKING.value,
                key,
                CallState.RESERVED.value,
                stamp,
                stamp,
            ),
        )
        conn.commit()
    except sqlite3.IntegrityError:
        conn.rollback()
        already = existing_attempt(conn, key)
        if already is None:
            raise
        return already["id"]
    return cursor.lastrowid


def _turn(turns: list[Turn], index) -> Turn | None:
    if not isinstance(index, int) or isinstance(index, bool):
        return None
    return next((turn for turn in turns if turn.index == index), None)


def record_offers(
    conn: sqlite3.Connection,
    attempt_id: int,
    turns: list[Turn],
    offers: list,
    release: sqlite3.Row,
) -> tuple[str, date | None, time | None]:
    """Store every offer with its verdict, and return the Binding Acceptance.

    An offer's text is read from the transcript at the turn the model pointed to, never
    taken from the model's own account of it: an unanchored claim is exactly what the
    second reading exists to catch. See docs/adr/0012.
    """
    binding = (UNREADABLE, None, None)
    for offer in offers or []:
        if not isinstance(offer, dict):
            continue
        turn = _turn(turns, offer.get("turn"))
        if turn is None or turn.speaker != RECEPTION:
            # A claim pointing at nothing, or at something the agent said itself.
            verdict, day, clock, spoken, index = UNREADABLE, None, None, "", -1
        else:
            spoken, index = turn.text, turn.index
            verdict, day, clock = match_offer(spoken, offer.get("time"), release)

        accepted = bool(offer.get("accepted"))
        conn.execute(
            """
            INSERT INTO rebooking_offer
                (call_attempt_id, turn_index, spoken_text, accepted,
                 matched_date, matched_time, verdict, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                attempt_id,
                index,
                spoken,
                int(accepted),
                day.isoformat() if day else None,
                clock.strftime("%H:%M") if clock else None,
                verdict,
                db.now_iso(),
            ),
        )
        if accepted:
            binding = (verdict, day, clock)
    conn.commit()
    return binding


def accepted_anything(offers: list) -> bool:
    return any(
        bool(offer.get("accepted")) for offer in offers or [] if isinstance(offer, dict)
    )


def status_for(
    outcome: str | None,
    reception_outcome: str | None,
    reception_turn_ok: bool,
    binding_verdict: str,
    any_accepted: bool,
) -> ReviewStatus:
    """The one place a finished Rebooking Call becomes a word on the board."""
    if outcome is not None and outcome != COMPLETED:
        # The line rejected us, or nobody picked up. Never the patient declining: on
        # this call she was not even on it. See docs/adr/0010.
        return review_status_for(outcome, CallKind.REBOOKING)
    if reception_outcome == REFUSED_THIRD_PARTY and reception_turn_ok:
        return ReviewStatus.RECEPTION_DECLINED
    if not any_accepted:
        # No slots, an unclear ending, or every offer outside the envelope. None of
        # these is reception refusing us, and none may be filed as one.
        return ReviewStatus.NEEDS_REVIEW
    if binding_verdict == INSIDE:
        return ReviewStatus.BOOKED
    # The agent accepted something the envelope does not allow. Worse than a refusal,
    # because reception believes a booking exists, so it goes back to a human named.
    return ReviewStatus.NEEDS_REVIEW


def run(conn: sqlite3.Connection, provider, release_id: int) -> dict:
    """Place the one call this Release granted, then read what happened.

    `followup_booked` is never written, whatever reception says. The board records that
    she said she booked it, which is a fact about a phone call; whether an appointment
    exists is a fact about the practice's own book, and not ours to claim.
    See docs/adr/0001, amendment.
    """
    row = release_row(conn, release_id)
    if row is None:
        raise LookupError(f"No release {release_id}")

    # Read before judging. A call that has already gone out has moved the item off
    # `released`, so checking the status first would answer a second press with
    # "not released" about the very Release that placed the call. The honest answer to
    # pressing Run twice is what happened the first time.
    key = idempotency_key(release_id)
    placed = existing_attempt(conn, key)
    if placed is not None and placed["provider_run_id"]:
        # Never a second dial. The way out of an uncertain submission is
        # `calle call recover`, never a redial. See docs/adr/0006, amendment.
        return {
            "attempt_id": placed["id"],
            "state": placed["state"],
            "status": row["review_status"],
            "placed": False,
        }

    if row["review_status"] != ReviewStatus.RELEASED.value:
        raise Refused(NOT_RELEASED)

    number = booking_line()
    if number is None:
        raise Refused(NO_BOOKING_LINE)

    attempt_id = reserve(conn, release_id)

    scope = RebookingScope(
        first_name=row["first_name"],
        surname=row["surname"],
        dob=row["dob"],
        phone_e164=number,
    )
    request = CallRequest(
        to_e164=number,
        task_text=build_task_text(scope, row),
        result_schema=RESULT_SCHEMA,
        idempotency_key=key,
    )
    run_id = provider.place(request)
    result = provider.poll(run_id)

    getter = getattr(provider, "transcript_path", None)
    conn.execute(
        """
        UPDATE call_attempt
        SET provider_run_id = ?, state = ?, transcript_path = ?, updated_at = ?
        WHERE id = ?
        """,
        (
            run_id,
            result.state.value,
            getter(run_id) if getter else None,
            db.now_iso(),
            attempt_id,
        ),
    )
    conn.commit()

    structured = result.structured or {}
    offers = structured.get("offers") or []
    verdict, day, clock = record_offers(conn, attempt_id, result.transcript, offers, row)
    reception_turn = _turn(result.transcript, structured.get("reception_outcome_turn"))
    status = status_for(
        outcome=result.outcome,
        reception_outcome=structured.get("reception_outcome"),
        reception_turn_ok=(
            reception_turn is not None and reception_turn.speaker == RECEPTION
        ),
        binding_verdict=verdict,
        any_accepted=accepted_anything(offers),
    )
    review.settle_rebooking(conn, row["review_item_id"], status)

    booked = status is ReviewStatus.BOOKED
    return {
        "attempt_id": attempt_id,
        "state": result.state.value,
        "status": status.value,
        "placed": True,
        "booked_date": day.isoformat() if booked and day else None,
        "booked_time": clock.strftime("%H:%M") if booked and clock else None,
    }
