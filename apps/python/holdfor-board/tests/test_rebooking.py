"""The Rebooking Call: the goal text, the Envelope Match, and what lands on the board.

Every test here runs against a recorded transcript. Nothing in this file can place a
call, and `never_live` in conftest makes that true however the machine is configured.

The dates matter. 26 August 2026 is a Wednesday; 25 August is the Tuesday, and the PRD
names it a public holiday. 11 September 2026 is a Friday. Those three facts are the
whole of the arithmetic below, and getting them wrong is what the matcher exists to
catch — see the postscript on docs/adr/0008.
"""

from __future__ import annotations

import json
from datetime import date, time

import pytest

from holdfor import db, rebooking, review
from holdfor.models import CallKind, RebookingScope, ReviewStatus
from holdfor.providers import FakeProvider

QUOTE = "it is still weeping and I cannot keep the dressing on"

EARLIEST = "2026-08-24"
LATEST = "2026-08-28"


# ---------------------------------------------------------------- the day inversion


@pytest.mark.parametrize(
    "spoken, expected_verdict, expected_day",
    [
        ("I can do Wednesday the 26th at ten past nine", rebooking.INSIDE, date(2026, 8, 26)),
        ("the 27th, if that suits", rebooking.INSIDE, date(2026, 8, 27)),
        ("Thursday", rebooking.INSIDE, date(2026, 8, 27)),
        # A Tuesday inside this envelope is the 25th, so the two tokens disagree and
        # neither is taken. This is the PRD's own original script.
        ("Tuesday the 26th", rebooking.OUTSIDE, None),
        ("earliest I have got is Friday the 11th of September", rebooking.OUTSIDE, None),
        ("bear with me, love", rebooking.UNREADABLE, None),
    ],
)
def test_the_envelope_is_asked_which_of_its_days_were_named(
    spoken, expected_verdict, expected_day
):
    verdict, day = rebooking.match_day(spoken, EARLIEST, LATEST)
    assert verdict == expected_verdict
    assert day == expected_day


def test_a_weekday_alone_is_ambiguous_once_the_envelope_holds_two_of_them():
    """A fortnight holds two Tuesdays, and two Tuesdays are two appointments."""
    verdict, day = rebooking.match_day("how about Tuesday?", "2026-08-24", "2026-09-05")
    assert verdict == rebooking.UNREADABLE
    assert day is None


def test_an_envelope_wider_than_a_month_is_refused_rather_than_guessed():
    with pytest.raises(rebooking.Refused) as refused:
        rebooking.match_day("the 26th", "2026-08-01", "2026-10-01")
    assert refused.value.reason == rebooking.ENVELOPE_TOO_WIDE


# ------------------------------------------------------------------- practice hours


@pytest.mark.parametrize(
    "clock, wanted, expected",
    [
        ("09:10", "morning", rebooking.INSIDE),
        ("08:50", "morning", rebooking.INSIDE),
        ("16:30", "afternoon", rebooking.INSIDE),
        ("16:30", "morning", rebooking.OUTSIDE),
        ("09:10", "afternoon", rebooking.OUTSIDE),
        ("12:00", "afternoon", rebooking.INSIDE),
        # No surgery offers this, so it is a transcription we refuse to trust rather
        # than an offer we refuse to take.
        ("21:10", "any", rebooking.UNREADABLE),
        ("07:15", "any", rebooking.UNREADABLE),
    ],
)
def test_practice_hours_check_the_clock_rather_than_guessing_it(clock, wanted, expected):
    assert rebooking.match_time(rebooking.parse_clock(clock), wanted) == expected


def test_a_day_with_no_time_cannot_satisfy_a_narrowed_half_of_the_day():
    assert rebooking.match_time(None, "any") == rebooking.INSIDE
    assert rebooking.match_time(None, "morning") == rebooking.UNREADABLE


def test_an_unparseable_clock_is_not_silently_dropped():
    assert rebooking.parse_clock("ten past nine") is None
    assert rebooking.parse_clock(None) is None


# ------------------------------------------------------- what the agent may say


def scope() -> RebookingScope:
    return RebookingScope(
        first_name="Margaret",
        surname="Ellery",
        dob="1941-03-17",
        phone_e164="+447700900999",
    )


def release_stub(**overrides):
    row = {
        "earliest_date": EARLIEST,
        "latest_date": LATEST,
        "time_of_day": "morning",
        "mode": "any",
        "clinician": None,
        "approved_words": QUOTE,
    }
    row.update(overrides)
    return row


def test_the_name_goes_out_and_the_date_of_birth_waits_to_be_asked():
    text = rebooking.build_task_text(scope(), release_stub())
    assert "Margaret Ellery" in text
    assert "1941-03-17" in text
    assert "If you are asked for her date of birth" in text
    assert "Do not give it before you are asked" in text


def test_the_fixed_line_is_carried_and_medical_questions_are_refused():
    text = rebooking.build_task_text(scope(), release_stub())
    assert rebooking.FIXED_LINE in text
    assert "Never answer a medical question" in text


def test_the_agent_is_told_to_wait_quietly_and_never_to_argue():
    text = rebooking.build_task_text(scope(), release_stub())
    assert "wait quietly" in text
    assert "Do not argue" in text


def test_an_empty_release_speaks_no_quote_at_all():
    text = rebooking.build_task_text(scope(), release_stub(approved_words=""))
    assert QUOTE not in text
    assert "her own words" not in text


def test_only_a_narrowed_field_is_put_to_reception():
    open_envelope = rebooking.spoken_constraints(
        release_stub(time_of_day="any", mode="any", clinician=None)
    )
    joined = " ".join(open_envelope)
    assert "face to face" not in joined
    assert "must be with" not in joined

    narrowed = " ".join(
        rebooking.spoken_constraints(
            release_stub(time_of_day="morning", mode="in_person", clinician="Dr Okafor")
        )
    )
    assert "in the morning" in narrowed
    assert "face to face" in narrowed
    assert "Dr Okafor" in narrowed
    assert narrowed.count("Only accept if you hear them say so") == 2


# -------------------------------------------------------------- placing the call


def transcript(offers, reception_outcome="slot_offered", outcome="COMPLETED", turn=5):
    return {
        "state": "terminal_verified",
        "turns": [
            {
                "index": 0,
                "speaker": "agent",
                "text": "Automated assistant for Fieldgate Surgery. Margaret Ellery.",
            },
            {"index": 1, "speaker": "other", "text": "Date of birth?"},
            {"index": 2, "speaker": "agent", "text": "17 March 1941."},
            {"index": 3, "speaker": "other", "text": "What does she need?"},
            {"index": 4, "speaker": "agent", "text": "She would like to be seen again."},
            {
                "index": 5,
                "speaker": "other",
                "text": "I can do Wednesday the 26th at ten past nine.",
            },
            {"index": 6, "speaker": "agent", "text": "That is fine, please book that."},
            {
                "index": 7,
                "speaker": "other",
                "text": "Oh, hang on, that has gone. Ten to nine on the 26th?",
            },
            {
                "index": 8,
                "speaker": "other",
                "text": "Earliest after that is Friday the 11th of September.",
            },
            {
                "index": 9,
                "speaker": "other",
                "text": "I cannot book for someone else, she will have to ring herself.",
            },
        ],
        "structured": {
            "offers": offers,
            "reception_outcome": reception_outcome,
            "reception_outcome_turn": turn,
        },
        "outcome": outcome,
    }


@pytest.fixture
def released(conn):
    """One Review Item, released with a morning envelope over 24-28 August."""
    stamp = db.now_iso()
    attempt = conn.execute(
        """
        INSERT INTO call_attempt
            (appointment_id, kind, idempotency_key, state, created_at, updated_at)
        VALUES (1, 'checkin', 'checkin:rebooking-test', 'terminal_verified', ?, ?)
        """,
        (stamp, stamp),
    )
    item = conn.execute(
        """
        INSERT INTO review_item
            (call_attempt_id, feeling, medication_ok, wants_seen,
             carried_words_text, carried_words_turn,
             stop_condition, stop_reason, status, created_at)
        VALUES (?, 'same', 'not_asked', 'yes', ?, 7, 0, NULL, ?, ?)
        """,
        (attempt.lastrowid, QUOTE, ReviewStatus.NEEDS_REVIEW.value, stamp),
    )
    conn.commit()
    release_id = review.release(
        conn,
        item.lastrowid,
        {
            "earliest_date": EARLIEST,
            "latest_date": LATEST,
            "time_of_day": "morning",
            "mode": "any",
            "clinician": None,
            "approved_words": QUOTE,
            "reviewer_name": "Sister Okonjo",
        },
    )
    return {"review_item_id": item.lastrowid, "release_id": release_id}


@pytest.fixture
def line(monkeypatch):
    monkeypatch.setenv(rebooking.BOOKING_LINE, "+447700900500")


def provider_for(tmp_path, release_id, payload):
    name = "reception.json"
    (tmp_path / name).write_text(json.dumps(payload), encoding="utf-8")
    return FakeProvider(
        fixtures_dir=tmp_path, route={rebooking.idempotency_key(release_id): name}
    )


def test_no_booking_line_means_no_call(conn, released, tmp_path):
    provider = provider_for(tmp_path, released["release_id"], transcript([]))
    with pytest.raises(rebooking.Refused) as refused:
        rebooking.run(conn, provider, released["release_id"])
    assert refused.value.reason == rebooking.NO_BOOKING_LINE


def test_an_offer_inside_the_envelope_is_booked(conn, released, line, tmp_path):
    provider = provider_for(
        tmp_path,
        released["release_id"],
        transcript([{"turn": 5, "time": "09:10", "accepted": True}]),
    )
    outcome = rebooking.run(conn, provider, released["release_id"])
    assert outcome["status"] == ReviewStatus.BOOKED.value
    assert outcome["booked_date"] == "2026-08-26"
    assert outcome["booked_time"] == "09:10"


def test_the_last_acceptance_binds_and_the_withdrawn_one_is_kept(
    conn, released, line, tmp_path
):
    provider = provider_for(
        tmp_path,
        released["release_id"],
        transcript(
            [
                {"turn": 5, "time": "09:10", "accepted": True},
                {"turn": 7, "time": "08:50", "accepted": True},
            ]
        ),
    )
    outcome = rebooking.run(conn, provider, released["release_id"])
    assert outcome["status"] == ReviewStatus.BOOKED.value
    assert outcome["booked_time"] == "08:50"

    rows = conn.execute(
        "SELECT turn_index, matched_time, accepted, verdict FROM rebooking_offer"
        " ORDER BY id"
    ).fetchall()
    assert [row["matched_time"] for row in rows] == ["09:10", "08:50"]
    assert all(row["verdict"] == rebooking.INSIDE for row in rows)


def test_an_acceptance_outside_the_envelope_is_not_a_booking(
    conn, released, line, tmp_path
):
    """The agent said yes to 11 September. The board must not call that booked."""
    provider = provider_for(
        tmp_path,
        released["release_id"],
        transcript([{"turn": 8, "time": "09:00", "accepted": True}]),
    )
    outcome = rebooking.run(conn, provider, released["release_id"])
    assert outcome["status"] == ReviewStatus.NEEDS_REVIEW.value
    assert outcome["booked_date"] is None

    row = conn.execute("SELECT verdict, accepted FROM rebooking_offer").fetchone()
    assert row["verdict"] == rebooking.OUTSIDE
    assert row["accepted"] == 1


def test_an_offer_pointing_at_the_agents_own_turn_is_unreadable(
    conn, released, line, tmp_path
):
    provider = provider_for(
        tmp_path,
        released["release_id"],
        transcript([{"turn": 6, "time": "09:10", "accepted": True}]),
    )
    outcome = rebooking.run(conn, provider, released["release_id"])
    assert outcome["status"] == ReviewStatus.NEEDS_REVIEW.value
    row = conn.execute("SELECT verdict FROM rebooking_offer").fetchone()
    assert row["verdict"] == rebooking.UNREADABLE


def test_a_spoken_refusal_is_filed_as_reception_declining(
    conn, released, line, tmp_path
):
    provider = provider_for(
        tmp_path,
        released["release_id"],
        transcript([], reception_outcome=rebooking.REFUSED_THIRD_PARTY, turn=9),
    )
    outcome = rebooking.run(conn, provider, released["release_id"])
    assert outcome["status"] == ReviewStatus.RECEPTION_DECLINED.value


def test_a_refusal_claim_that_does_not_anchor_reaches_a_human_instead(
    conn, released, line, tmp_path
):
    provider = provider_for(
        tmp_path,
        released["release_id"],
        transcript([], reception_outcome=rebooking.REFUSED_THIRD_PARTY, turn=6),
    )
    outcome = rebooking.run(conn, provider, released["release_id"])
    assert outcome["status"] == ReviewStatus.NEEDS_REVIEW.value


def test_no_slots_is_not_recorded_as_a_refusal(conn, released, line, tmp_path):
    provider = provider_for(
        tmp_path,
        released["release_id"],
        transcript([], reception_outcome=rebooking.NO_SLOTS, turn=8),
    )
    outcome = rebooking.run(conn, provider, released["release_id"])
    assert outcome["status"] == ReviewStatus.NEEDS_REVIEW.value


# ---------------------------------------------------------- one Release, one call


def test_reserving_twice_claims_the_same_call(conn, released):
    first = rebooking.reserve(conn, released["release_id"])
    second = rebooking.reserve(conn, released["release_id"])
    assert first == second
    count = conn.execute(
        "SELECT COUNT(*) AS n FROM call_attempt WHERE kind = ?",
        (CallKind.REBOOKING.value,),
    ).fetchone()["n"]
    assert count == 1


def test_running_twice_never_places_a_second_call(conn, released, line, tmp_path):
    provider = provider_for(
        tmp_path,
        released["release_id"],
        transcript([{"turn": 5, "time": "09:10", "accepted": True}]),
    )
    first = rebooking.run(conn, provider, released["release_id"])
    second = rebooking.run(conn, provider, released["release_id"])
    assert first["placed"] is True
    assert second["placed"] is False
    assert (
        conn.execute(
            "SELECT COUNT(*) AS n FROM call_attempt WHERE kind = ?",
            (CallKind.REBOOKING.value,),
        ).fetchone()["n"]
        == 1
    )


def test_a_release_can_hold_only_one_release_row(conn, released):
    """The UNIQUE index, not the SELECT before the INSERT, is what guarantees this."""
    import sqlite3

    with pytest.raises(sqlite3.IntegrityError):
        conn.execute(
            """
            INSERT INTO release
                (review_item_id, reviewer_name, released_at, earliest_date,
                 latest_date, time_of_day, mode, clinician, approved_words)
            VALUES (?, 'Someone Else', ?, ?, ?, 'any', 'any', NULL, '')
            """,
            (released["review_item_id"], db.now_iso(), EARLIEST, LATEST),
        )


def test_an_unreleased_item_cannot_be_called(conn, line, tmp_path):
    with pytest.raises(LookupError):
        rebooking.run(conn, FakeProvider(fixtures_dir=tmp_path), 9999)


# --------------------------------------------------------- what the board records


def test_the_two_terminal_meanings_are_not_the_same_set():
    assert ReviewStatus.RELEASED.value in review.HUMAN_SETTLED
    assert ReviewStatus.RELEASED.value not in review.REBOOKING_OUTCOMES
    for status in (ReviewStatus.RECEPTION_DECLINED, ReviewStatus.NOT_REACHED):
        assert status.value not in review.HUMAN_SETTLED, (
            f"{status.value} asks a human to ring, so it must stay actionable"
        )


def test_a_person_cannot_write_a_rebooking_outcome(conn, released):
    with pytest.raises(review.Rejected) as rejected:
        review.terminate(conn, released["review_item_id"], ReviewStatus.CLOSED)
    assert rejected.value.code == "already_settled"


def test_a_rebooking_outcome_only_moves_a_released_item(conn, released):
    assert (
        review.settle_rebooking(
            conn, released["review_item_id"], ReviewStatus.BOOKED
        )
        == ReviewStatus.BOOKED.value
    )
    with pytest.raises(review.Rejected) as rejected:
        review.settle_rebooking(
            conn, released["review_item_id"], ReviewStatus.NOT_REACHED
        )
    assert rejected.value.code == "not_released"


def test_a_status_outside_the_rebooking_set_is_refused(conn, released):
    with pytest.raises(review.Rejected) as rejected:
        review.settle_rebooking(
            conn, released["review_item_id"], ReviewStatus.RANG_MANUALLY
        )
    assert rejected.value.code == "not_a_rebooking_outcome"


def test_followup_booked_is_never_written_however_the_call_went(
    conn, released, line, tmp_path
):
    """docs/adr/0001, amendment. The board knows what reception said, not what is."""
    before = conn.execute(
        "SELECT followup_booked FROM appointment WHERE id = 1"
    ).fetchone()["followup_booked"]
    provider = provider_for(
        tmp_path,
        released["release_id"],
        transcript([{"turn": 5, "time": "09:10", "accepted": True}]),
    )
    outcome = rebooking.run(conn, provider, released["release_id"])
    assert outcome["status"] == ReviewStatus.BOOKED.value
    after = conn.execute(
        "SELECT followup_booked FROM appointment WHERE id = 1"
    ).fetchone()["followup_booked"]
    assert after == before


def test_a_released_item_is_visible_and_carries_its_run_control(conn, released):
    rows = review.released_awaiting_call(conn)
    assert len(rows) == 1
    row = rows[0]
    assert row["release_id"] == released["release_id"]
    assert row["reviewer_name"] == "Sister Okonjo"
    assert row["rebooking_attempt_id"] is None


def test_a_released_item_stops_offering_run_once_the_call_is_placed(
    conn, released, line, tmp_path
):
    provider = provider_for(
        tmp_path,
        released["release_id"],
        transcript([{"turn": 5, "time": "09:10", "accepted": True}]),
    )
    rebooking.run(conn, provider, released["release_id"])
    assert review.released_awaiting_call(conn) == []


# ------------------------------------------------------------------ the board form


def test_the_release_form_starts_with_an_empty_words_box():
    """docs/adr/0009. Inattention must speak nothing, not everything."""
    from pathlib import Path

    template = (
        Path(rebooking.__file__).parent / "templates" / "_item.html"
    ).read_text(encoding="utf-8")
    assert 'name="approved_words"' in template
    assert 'name="approved_words">{{ item.carried_words_text' not in template


def test_the_release_form_offers_any_as_an_appointment_mode():
    from pathlib import Path

    template = (
        Path(rebooking.__file__).parent / "templates" / "_item.html"
    ).read_text(encoding="utf-8")
    assert '<option value="any">any</option>' in template


def test_practice_hours_are_a_working_day_rather_than_a_clock_face():
    assert rebooking.PRACTICE_OPENS == time(8, 0)
    assert rebooking.PRACTICE_CLOSES == time(18, 30)
    assert rebooking.AFTERNOON_FROM == time(12, 0)


# --- a live call, which carries no reading of itself -------------------------------


class Live(FakeProvider):
    """A provider that connects and returns no structured block, which is every live
    call: `calle call start` cannot carry a result schema."""

    live = True

    def poll(self, run_id):
        from dataclasses import replace

        return replace(super().poll(run_id), structured=None)


def test_a_live_call_reads_its_offers_back_out_of_the_transcript(
    conn, released, line, tmp_path, monkeypatch
):
    """The bug that made a working Rebooking Call look broken.

    Reception offered a slot inside the envelope and the agent accepted it. The offer
    lived only in the transcript, `offers` came off a block that was never there, and
    what reached the board was `unreadable` with no offer rows at all.
    """
    spoken = transcript([{"turn": 5, "time": "09:10", "accepted": True}])
    provider = Live(
        fixtures_dir=tmp_path,
        route={rebooking.idempotency_key(released["release_id"]): "reception.json"},
    )
    (tmp_path / "reception.json").write_text(json.dumps(spoken), encoding="utf-8")
    monkeypatch.setattr(
        rebooking.reextract,
        "offers_from",
        lambda turns: {
            "offers": [{"turn": 5, "time": "09:10", "accepted": True}],
            "reception_outcome": rebooking.SLOT_OFFERED,
            "reception_outcome_turn": 5,
        },
    )

    rebooking.run(conn, provider, released["release_id"])

    rows = conn.execute("SELECT * FROM rebooking_offer").fetchall()
    assert [row["turn_index"] for row in rows] == [5]
    assert rows[0]["verdict"] == rebooking.INSIDE


def test_a_live_call_nobody_can_read_lands_exactly_where_it_did_before(
    conn, released, line, tmp_path, monkeypatch
):
    """No key, no library, no answer. Not a new state and not a worse one."""
    spoken = transcript([{"turn": 5, "time": "09:10", "accepted": True}])
    provider = Live(
        fixtures_dir=tmp_path,
        route={rebooking.idempotency_key(released["release_id"]): "reception.json"},
    )
    (tmp_path / "reception.json").write_text(json.dumps(spoken), encoding="utf-8")
    monkeypatch.setattr(rebooking.reextract, "offers_from", lambda turns: None)

    rebooking.run(conn, provider, released["release_id"])

    assert conn.execute("SELECT COUNT(*) n FROM rebooking_offer").fetchone()["n"] == 0


# --- the budget -------------------------------------------------------------------


def test_a_rebooking_call_spends_one_of_the_twenty(
    conn, released, line, tmp_path, monkeypatch
):
    """It was not counted at all. Three check-ins and two rebookings read as three on
    the board, and under-counting is the direction that costs a call somebody needed."""
    provider = Live(
        fixtures_dir=tmp_path,
        route={rebooking.idempotency_key(released["release_id"]): "reception.json"},
    )
    (tmp_path / "reception.json").write_text(
        json.dumps(transcript([])), encoding="utf-8"
    )
    monkeypatch.setattr(rebooking.reextract, "offers_from", lambda turns: None)

    rebooking.run(conn, provider, released["release_id"])

    assert conn.execute("SELECT COUNT(*) n FROM live_call").fetchone()["n"] == 1


def test_a_second_press_never_spends_a_second_call(
    conn, released, line, tmp_path, monkeypatch
):
    """`reserve` returns the existing attempt on a second press, so the count needs its
    guarantee in the index rather than upstream."""
    provider = Live(
        fixtures_dir=tmp_path,
        route={rebooking.idempotency_key(released["release_id"]): "reception.json"},
    )
    (tmp_path / "reception.json").write_text(
        json.dumps(transcript([])), encoding="utf-8"
    )
    monkeypatch.setattr(rebooking.reextract, "offers_from", lambda turns: None)

    rebooking.run(conn, provider, released["release_id"])
    rebooking.run(conn, provider, released["release_id"])

    assert conn.execute("SELECT COUNT(*) n FROM live_call").fetchone()["n"] == 1


def test_a_fake_call_spends_nothing(conn, released, line, tmp_path):
    provider = provider_for(tmp_path, released["release_id"], transcript([]))

    rebooking.run(conn, provider, released["release_id"])

    assert conn.execute("SELECT COUNT(*) n FROM live_call").fetchone()["n"] == 0


# --- what the agent is told when it cannot make out a word ------------------------


def test_the_agent_is_told_what_to_do_with_an_offer(conn, released):
    """The turn-5 failure: a slot offered in plain words, answered with the line about
    passing on what she said. An offer is not a question and it has to be told so."""
    row = rebooking.release_row(conn, released["release_id"])
    said = rebooking.build_task_text(
        rebooking.RebookingScope("Margaret", "Ellery", "1944-02-11", "+447700900500"),
        row,
    )

    assert "is an offer, not a question" in said
    assert "Never answer an offer with the line" in said


def test_the_agent_is_told_to_ask_again_rather_than_repeat_itself(conn, released):
    """It had one verbatim string and it was scoped to being asked something it may not
    answer. Given "ok, right, wise regarding" it had no other instruction."""
    row = rebooking.release_row(conn, released["release_id"])
    said = rebooking.build_task_text(
        rebooking.RebookingScope("Margaret", "Ellery", "1944-02-11", "+447700900500"),
        row,
    )

    assert rebooking.DIDNT_CATCH in said
    assert rebooking.PASSING_BACK in said
    assert f"may ask that {rebooking.ASK_AGAIN_LIMIT} times" in said


def test_nothing_spoken_carries_punctuation_a_voice_cannot_read():
    """Read aloud by a text-to-speech engine, which may say a dash out loud or pause in
    the wrong place for a bracket."""
    for line in (rebooking.DIDNT_CATCH, rebooking.PASSING_BACK, rebooking.FIXED_LINE):
        assert not set(line) & set("—–()[]{}*_/")
