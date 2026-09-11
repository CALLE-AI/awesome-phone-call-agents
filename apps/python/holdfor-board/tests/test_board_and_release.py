"""T3: the queue, the detail view, and the Release.

Review Items are inserted directly here rather than produced by a call, so the board
is tested against the shapes it actually reads and needs no recorded transcript.
"""

from __future__ import annotations

import json
from datetime import date
from itertools import count

import pytest
from fastapi.testclient import TestClient

from holdfor import db, review, window
from holdfor.app import create_app
from holdfor.models import ReviewStatus
from holdfor.scan import (
    RED_FLAG_NOT_TOLD,
    RED_FLAG_PHRASE,
    REPEATED_NON_ANSWER,
    THIRD_PARTY,
    UNMAPPABLE,
)

QUOTE = "I have to hold the worktop for a minute when I get up in the morning"

TRANSCRIPT = {
    "state": "terminal_verified",
    "turns": [
        {"index": 0, "speaker": "agent", "text": "Hello, is that Margaret?"},
        {"index": 1, "speaker": "other", "text": "Yes, speaking."},
        {
            "index": 2,
            "speaker": "agent",
            "text": "Since Monday, are you feeling better, about the same, or worse?",
        },
        {"index": 3, "speaker": "other", "text": "About the same."},
        {
            "index": 4,
            "speaker": "agent",
            "text": "Are you getting on alright with what they gave you?",
        },
        {"index": 5, "speaker": "other", "text": "I think so, yes."},
        {"index": 6, "speaker": "agent", "text": "Is there anything worrying you?"},
        {"index": 7, "speaker": "other", "text": f"Well, {QUOTE}."},
        {
            "index": 8,
            "speaker": "agent",
            "text": "Would you like the surgery to see you again?",
        },
        {"index": 9, "speaker": "other", "text": "Yes, I would."},
    ],
}

keys = count(1)


@pytest.fixture
def transcript_file(tmp_path):
    path = tmp_path / "margaret.json"
    path.write_text(json.dumps(TRANSCRIPT), encoding="utf-8")
    return str(path)


@pytest.fixture
def client(db_path, now):
    """On the pinned clock, because `db_path` seeds against the pinned date.

    Without it the board asked the real calendar which Appointments were due and the
    ledger answered for the week of `today`, so every due-list assertion here passed
    during one week of 2026 and failed every week after it.
    """
    return TestClient(create_app(db_path=db_path, clock=lambda: now))


def add_item(
    conn,
    *,
    feeling="same",
    medication_ok="not_asked",
    wants_seen="no",
    carried=QUOTE,
    carried_turn=7,
    stop=False,
    reason=None,
    transcript_path=None,
    status=ReviewStatus.NEEDS_REVIEW,
    when_easier=None,
) -> int:
    stamp = db.now_iso()
    attempt = conn.execute(
        """
        INSERT INTO call_attempt
            (appointment_id, kind, idempotency_key, state, transcript_path,
             created_at, updated_at)
        VALUES (1, 'checkin', ?, 'terminal_verified', ?, ?, ?)
        """,
        (f"test:{next(keys)}", transcript_path, stamp, stamp),
    )
    item = conn.execute(
        """
        INSERT INTO review_item
            (call_attempt_id, feeling, medication_ok, wants_seen, when_easier,
             carried_words_text, carried_words_turn,
             stop_condition, stop_reason, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            attempt.lastrowid,
            feeling,
            medication_ok,
            wants_seen,
            when_easier,
            carried,
            carried_turn,
            int(stop),
            reason,
            status.value,
            stamp,
        ),
    )
    conn.commit()
    return item.lastrowid


def envelope(**overrides) -> dict:
    body = {
        "earliest_date": "2026-08-24",
        "latest_date": "2026-08-28",
        "time_of_day": "morning",
        "mode": "in_person",
        "clinician": None,
        "approved_words": QUOTE,
        "reviewer_name": "Sister Okonjo",
    }
    return body | overrides


# --- auto-close: narrow on purpose ------------------------------------------------


def test_a_settled_call_closes_without_anyone_reading_it(conn):
    item_id = add_item(conn, feeling="better", wants_seen="no")

    assert review.settle(conn, item_id) == ReviewStatus.AUTO_CLOSED.value


def test_a_stop_condition_alone_keeps_it_in_the_queue(conn):
    item_id = add_item(conn, feeling="better", stop=True, reason="red_flag_phrase")

    assert review.settle(conn, item_id) == ReviewStatus.NEEDS_REVIEW.value


def test_feeling_worse_alone_keeps_it_in_the_queue(conn):
    item_id = add_item(conn, feeling="worse")

    assert review.settle(conn, item_id) == ReviewStatus.NEEDS_REVIEW.value


def test_feeling_unsure_alone_keeps_it_in_the_queue(conn):
    item_id = add_item(conn, feeling="unsure")

    assert review.settle(conn, item_id) == ReviewStatus.NEEDS_REVIEW.value


def test_wanting_to_be_seen_alone_keeps_it_in_the_queue(conn):
    item_id = add_item(conn, feeling="better", wants_seen="yes")

    assert review.settle(conn, item_id) == ReviewStatus.NEEDS_REVIEW.value


def test_an_unanswered_medication_question_alone_keeps_it_in_the_queue(conn):
    item_id = add_item(conn, feeling="better", medication_ok=None)

    assert review.settle(conn, item_id) == ReviewStatus.NEEDS_REVIEW.value


def test_not_asked_counts_as_answered(conn):
    """The question was never put to her, which is a complete state, not a gap."""
    item_id = add_item(conn, feeling="better", medication_ok="not_asked")

    assert review.settle(conn, item_id) == ReviewStatus.AUTO_CLOSED.value


# --- the queue --------------------------------------------------------------------


def test_the_queue_counts_the_day_and_lists_only_what_needs_a_person(conn, client):
    add_item(conn, feeling="better", status=ReviewStatus.AUTO_CLOSED)
    add_item(conn, feeling="better", status=ReviewStatus.AUTO_CLOSED)
    needs_you = add_item(conn, feeling="worse")

    payload = client.get("/board").json()

    assert payload["today"] == 3
    assert payload["auto_closed"] == 2
    assert payload["needs_review"] == 1
    assert [item["id"] for item in payload["items"]] == [needs_you]


def test_the_queue_page_leads_with_the_number_that_needs_a_person(conn, client):
    add_item(conn, feeling="worse")

    page = client.get("/")

    assert page.status_code == 200
    assert "Need you" in page.text
    assert "Margaret" in page.text


# --- the detail view --------------------------------------------------------------


def test_the_detail_view_anchors_each_answer_to_the_turn_it_came_from(
    conn, client, transcript_file
):
    item_id = add_item(conn, wants_seen="yes", transcript_path=transcript_file)

    payload = client.get(f"/review-items/{item_id}").json()

    assert [turn["index"] for turn in payload["turns"]] == list(range(10))
    assert payload["anchors"] == {
        "feeling": 3,
        "medication_ok": 5,
        "wants_seen": 9,
        "carried_words_text": 7,
    }


def test_an_answer_that_was_never_given_gets_no_anchor(
    conn, client, transcript_file
):
    item_id = add_item(
        conn, wants_seen=None, carried=None, carried_turn=None,
        transcript_path=transcript_file,
    )

    anchors = client.get(f"/review-items/{item_id}").json()["anchors"]

    assert "wants_seen" not in anchors
    assert "carried_words_text" not in anchors
    assert anchors["feeling"] == 3


def test_a_missing_transcript_is_an_empty_call_not_a_crash(conn, client):
    item_id = add_item(conn, transcript_path="fixtures/transcripts/gone.json")

    payload = client.get(f"/review-items/{item_id}").json()

    assert payload["turns"] == []
    assert payload["anchors"] == {"carried_words_text": 7}


def test_the_detail_page_shows_the_transcript_beside_the_answers(
    conn, client, transcript_file
):
    item_id = add_item(conn, transcript_path=transcript_file)

    page = client.get(f"/review-items/{item_id}/view")

    assert page.status_code == 200
    assert QUOTE in page.text
    assert "Would you like the surgery to see you again?" in page.text
    assert "Release for rebooking" in page.text


def test_an_unknown_review_item_is_a_404(client):
    assert client.get("/review-items/9999").status_code == 404


# --- the sheet --------------------------------------------------------------------
#
# One Review Item read over the top of the queue rather than instead of it. A Reviewer
# decides by comparing: this row against the five above it, what was heard against what
# was recorded. Sending her to a page of her own took the comparison away and made
# getting back a navigation. `?open=` keeps the queue behind her and keeps Back honest.


def test_a_patient_name_opens_the_sheet_rather_than_leaving_the_board(conn, client):
    """The link she actually clicks. Nothing in the queue navigates away from it."""
    item_id = add_item(conn)

    board = client.get("/").text

    assert f'href="/?open={item_id}"' in board
    assert "/view" not in board


def test_the_sheet_carries_the_whole_item_and_leaves_the_queue_behind(
    conn, client, transcript_file
):
    item_id = add_item(conn, transcript_path=transcript_file)

    page = client.get(f"/?open={item_id}").text

    assert 'class="sheet"' in page
    assert "Hello, is that Margaret?" in page
    assert "Release for rebooking" in page
    assert "Review queue" in page


def test_the_plain_queue_carries_no_sheet(conn, client, transcript_file):
    """The transcript is a file read and the board reloads itself while a call is in
    the air. Nothing is fetched for a sheet nobody asked for."""
    add_item(conn, transcript_path=transcript_file)

    page = client.get("/").text

    assert 'class="sheet"' not in page
    assert "Release for rebooking" not in page
    assert "Hello, is that Margaret?" not in page


def test_the_sheet_closes_two_ways_and_neither_is_script(conn, client):
    """Click away or press Close, and both are links to the queue. That is also what
    makes the browser's own Back button the way out."""
    item_id = add_item(conn)

    page = client.get(f"/?open={item_id}").text

    assert '<a class="scrim" href="/"' in page
    assert '<a class="shut" href="/"' in page
    assert "<script" not in page


def test_the_release_form_in_the_sheet_still_offers_today(conn, client):
    """`today` on the board is how many calls went out; `today_iso` is the date the
    envelope starts on. The sheet renders inside the board's context, so the two names
    have to stay apart or the date input silently receives a count."""
    item_id = add_item(conn)

    page = client.get(f"/?open={item_id}").text

    assert f'name="earliest_date" value="{date.today().isoformat()}"' in page


def test_opening_an_item_that_is_not_there_is_a_404(client):
    assert client.get("/?open=9999").status_code == 404


# --- the Release ------------------------------------------------------------------


def test_a_release_records_who_granted_it_and_when(conn, client):
    item_id = add_item(conn, wants_seen="yes")

    response = client.post(f"/review-items/{item_id}/release", json=envelope())

    assert response.status_code == 201
    row = conn.execute(
        "SELECT * FROM release WHERE id = ?", (response.json()["release_id"],)
    ).fetchone()
    assert row["reviewer_name"] == "Sister Okonjo"
    assert row["released_at"]
    assert row["review_item_id"] == item_id


def test_a_release_carries_the_whole_booking_envelope(conn, client):
    item_id = add_item(conn, wants_seen="yes")

    release_id = client.post(
        f"/review-items/{item_id}/release",
        json=envelope(clinician="Dr Whitfield", mode="phone", time_of_day="afternoon"),
    ).json()["release_id"]

    row = conn.execute("SELECT * FROM release WHERE id = ?", (release_id,)).fetchone()
    assert row["earliest_date"] == "2026-08-24"
    assert row["latest_date"] == "2026-08-28"
    assert row["time_of_day"] == "afternoon"
    assert row["mode"] == "phone"
    assert row["clinician"] == "Dr Whitfield"


def test_a_release_moves_the_item_out_of_the_queue(conn, client):
    item_id = add_item(conn, wants_seen="yes")

    client.post(f"/review-items/{item_id}/release", json=envelope())

    status = conn.execute(
        "SELECT status FROM review_item WHERE id = ?", (item_id,)
    ).fetchone()["status"]
    assert status == ReviewStatus.RELEASED.value


def test_narrowing_the_quote_is_accepted(conn, client):
    item_id = add_item(conn, wants_seen="yes")
    narrowed = "hold the worktop for a minute"

    release_id = client.post(
        f"/review-items/{item_id}/release", json=envelope(approved_words=narrowed)
    ).json()["release_id"]

    row = conn.execute("SELECT * FROM release WHERE id = ?", (release_id,)).fetchone()
    assert row["approved_words"] == narrowed


def test_widening_the_quote_is_refused(conn, client):
    item_id = add_item(conn, wants_seen="yes")
    widened = QUOTE + " and I nearly fell"

    response = client.post(
        f"/review-items/{item_id}/release", json=envelope(approved_words=widened)
    )

    assert response.status_code == 422
    assert response.json() == {"error": "words_widened"}
    assert conn.execute("SELECT COUNT(*) AS n FROM release").fetchone()["n"] == 0


def test_words_cannot_be_approved_for_a_call_that_carried_none(conn, client):
    item_id = add_item(conn, carried=None, carried_turn=None, feeling="worse")

    response = client.post(
        f"/review-items/{item_id}/release",
        json=envelope(approved_words="she mentioned her knee"),
    )

    assert response.status_code == 422
    assert response.json() == {"error": "words_widened"}


def test_a_release_with_no_quote_at_all_is_allowed(conn, client):
    item_id = add_item(conn, carried=None, carried_turn=None, feeling="worse")

    response = client.post(
        f"/review-items/{item_id}/release", json=envelope(approved_words="")
    )

    assert response.status_code == 201


def test_a_release_without_a_named_reviewer_is_refused(conn, client):
    item_id = add_item(conn, wants_seen="yes")

    response = client.post(
        f"/review-items/{item_id}/release", json=envelope(reviewer_name="  ")
    )

    assert response.status_code == 422
    assert response.json() == {"error": "reviewer_required"}


def test_an_envelope_that_ends_before_it_starts_is_refused(conn, client):
    item_id = add_item(conn, wants_seen="yes")

    response = client.post(
        f"/review-items/{item_id}/release",
        json=envelope(earliest_date="2026-08-28", latest_date="2026-08-24"),
    )

    assert response.status_code == 422
    assert response.json() == {"error": "envelope_invalid"}


def test_an_unknown_appointment_mode_is_refused(conn, client):
    item_id = add_item(conn, wants_seen="yes")

    response = client.post(
        f"/review-items/{item_id}/release", json=envelope(mode="video")
    )

    assert response.status_code == 422
    assert response.json() == {"error": "envelope_invalid"}


# --- a red flag is not something a machine may act on ------------------------------
#
# The agent on the phone stops rather than offer an appointment to somebody describing
# chest pain. Until these ran, the board then offered a Reviewer one button to have a
# second agent ring reception on her behalf, carrying her own words about it: the exact
# call the first agent correctly declined to set up, one layer up, with the refusal
# already spent. `auto_closes` had always gated on `stop_condition`; `release` had not.


# --- when she is free, and what was booked ----------------------------------------


def test_her_own_answer_is_what_the_time_of_day_starts_on(conn, client):
    """The envelope used to be authored from nothing she had ever been asked.

    She says yes to being seen, a Reviewer picks a window, an agent books inside it,
    and the first she hears of the time is when she is expected. Her answer is the
    default now; the Reviewer may still change it, the way she may narrow the quote.
    """
    item_id = add_item(conn, wants_seen="yes", when_easier="afternoon")

    page = client.get(f"/?open={item_id}").text

    assert '<option value="afternoon" selected>afternoon</option>' in page
    assert "They said afternoons are easier" in page


def test_a_reviewer_is_told_when_the_window_is_her_own_judgement(conn, client):
    item_id = add_item(conn, wants_seen="yes", when_easier=None)

    page = client.get(f"/?open={item_id}").text

    assert '<option value="any" selected>any</option>' in page
    assert "so the times below are your judgement" in page


def test_an_easier_time_nobody_asked_for_is_not_shown_as_a_missing_answer(conn, client):
    """She said no, so there is no gap here. `not_asked`, like the medication."""
    item_id = add_item(conn, wants_seen="no", when_easier="not_asked")

    page = client.get(f"/?open={item_id}").text

    assert "not asked" in page


def test_the_board_shows_what_reception_actually_offered(conn, client):
    """`rebooking.run` computed the date and time, returned them, and no page read them.

    A board reading `booked` could not say what had been booked, so nobody could tell
    the patient — who is told by nothing else in this system either.
    """
    item_id = add_item(conn, wants_seen="yes")
    client.post(f"/review-items/{item_id}/release", json=envelope())
    release_id = conn.execute("SELECT id FROM release").fetchone()["id"]
    stamp = db.now_iso()
    attempt = conn.execute(
        """
        INSERT INTO call_attempt
            (appointment_id, kind, idempotency_key, state, created_at, updated_at)
        VALUES (1, 'rebooking', ?, 'terminal_verified', ?, ?)
        """,
        (f"rebooking:{release_id}", stamp, stamp),
    )
    conn.execute(
        """
        INSERT INTO rebooking_offer
            (call_attempt_id, turn_index, spoken_text, accepted,
             matched_date, matched_time, verdict, created_at)
        VALUES (?, 4, 'I can do Thursday the 27th at ten past nine.', 1,
                '2026-08-27', '09:10', 'inside', ?)
        """,
        (attempt.lastrowid, stamp),
    )
    conn.commit()

    page = client.get(f"/?open={item_id}").text

    assert "2026-08-27" in page
    assert "09:10" in page
    assert "Thursday the 27th at ten past nine" in page
    assert "not an appointment this board holds" in page


def test_an_offer_the_envelope_refused_is_not_shown_as_a_booking(conn, client):
    """Only the Binding Acceptance. An offer nobody accepted booked nothing."""
    item_id = add_item(conn, wants_seen="yes")
    client.post(f"/review-items/{item_id}/release", json=envelope())
    release_id = conn.execute("SELECT id FROM release").fetchone()["id"]
    stamp = db.now_iso()
    attempt = conn.execute(
        """
        INSERT INTO call_attempt
            (appointment_id, kind, idempotency_key, state, created_at, updated_at)
        VALUES (1, 'rebooking', ?, 'terminal_verified', ?, ?)
        """,
        (f"rebooking:{release_id}", stamp, stamp),
    )
    conn.execute(
        """
        INSERT INTO rebooking_offer
            (call_attempt_id, turn_index, spoken_text, accepted,
             matched_date, matched_time, verdict, created_at)
        VALUES (?, 4, 'We could do the fifteenth of September.', 0,
                '2026-09-15', '11:00', 'outside', ?)
        """,
        (attempt.lastrowid, stamp),
    )
    conn.commit()

    page = client.get(f"/?open={item_id}").text

    assert "2026-09-15" not in page
    assert "Reception offered" not in page


def test_a_red_flagged_item_cannot_be_released_for_a_rebooking_call(conn, client):
    item_id = add_item(conn, wants_seen="yes", stop=True, reason=RED_FLAG_PHRASE)

    response = client.post(f"/review-items/{item_id}/release", json=envelope())

    assert response.status_code == 409
    assert response.json() == {"error": "flagged_needs_a_person"}
    assert conn.execute("SELECT COUNT(*) AS n FROM release").fetchone()["n"] == 0


def test_an_item_where_nobody_told_her_anything_cannot_be_released_either(conn, client):
    item_id = add_item(conn, wants_seen="yes", stop=True, reason=RED_FLAG_NOT_TOLD)

    response = client.post(f"/review-items/{item_id}/release", json=envelope())

    assert response.status_code == 409
    assert response.json() == {"error": "flagged_needs_a_person"}


def test_a_call_that_merely_did_not_work_may_still_be_released(conn, client):
    """Narrow on purpose. These mean the call failed, not that anybody is unwell.

    A muddled call is often exactly the one worth rebooking, and a gate wide enough to
    catch `unmappable` would refuse a Reviewer the thing she is there to do.
    """
    for reason in (UNMAPPABLE, THIRD_PARTY, REPEATED_NON_ANSWER):
        item_id = add_item(conn, wants_seen="yes", stop=True, reason=reason)

        response = client.post(f"/review-items/{item_id}/release", json=envelope())

        assert response.status_code == 201, reason


def test_a_flagged_item_is_offered_no_release_form_at_all(conn, client):
    """Refused server-side and not offered client-side. Both, deliberately.

    A form the server rejects is a Reviewer typing out a booking envelope, naming
    herself, pressing the button, and getting a JSON error back.
    """
    item_id = add_item(conn, wants_seen="yes", stop=True, reason=RED_FLAG_PHRASE)

    page = client.get(f"/?open={item_id}").text

    assert "Release for rebooking" not in page
    assert "This one is not for a machine" in page
    assert "Ring them myself" in page


def test_a_flagged_item_says_whether_she_was_told_where_to_turn(conn, client):
    told = add_item(conn, stop=True, reason=RED_FLAG_PHRASE)
    untold = add_item(conn, stop=True, reason=RED_FLAG_NOT_TOLD)

    assert "have been told to ring 111" in client.get(f"/?open={told}").text
    assert "have not been told where to turn" in client.get(f"/?open={untold}").text


def test_the_patient_nobody_told_sorts_above_everything_else_waiting(conn, client):
    add_item(conn, wants_seen="yes")
    add_item(conn, stop=True, reason=RED_FLAG_PHRASE)
    untold = add_item(conn, stop=True, reason=RED_FLAG_NOT_TOLD)

    first = client.get("/board").json()["items"][0]

    assert first["id"] == untold


def test_releasing_twice_does_not_authorise_two_calls(conn, client):
    item_id = add_item(conn, wants_seen="yes")

    first = client.post(f"/review-items/{item_id}/release", json=envelope())
    second = client.post(f"/review-items/{item_id}/release", json=envelope())

    assert first.status_code == 201
    assert second.status_code == 409
    assert second.json() == {"error": "already_released"}
    assert conn.execute("SELECT COUNT(*) AS n FROM release").fetchone()["n"] == 1


# --- the other two actions --------------------------------------------------------


def test_closing_an_item_authorises_nothing(conn, client):
    item_id = add_item(conn, feeling="worse")

    response = client.post(f"/review-items/{item_id}/close", json={})

    assert response.status_code == 201
    assert _status(conn, item_id) == ReviewStatus.CLOSED.value
    assert conn.execute("SELECT COUNT(*) AS n FROM release").fetchone()["n"] == 0


def test_ringing_them_myself_takes_it_off_the_agent(conn, client):
    item_id = add_item(conn, feeling="worse")

    response = client.post(f"/review-items/{item_id}/manual", json={})

    assert response.status_code == 201
    assert _status(conn, item_id) == ReviewStatus.RANG_MANUALLY.value
    assert conn.execute("SELECT COUNT(*) AS n FROM release").fetchone()["n"] == 0


def test_a_closed_item_cannot_then_be_released(conn, client):
    item_id = add_item(conn, wants_seen="yes")
    client.post(f"/review-items/{item_id}/close", json={})

    response = client.post(f"/review-items/{item_id}/release", json=envelope())

    assert response.status_code == 409
    assert conn.execute("SELECT COUNT(*) AS n FROM release").fetchone()["n"] == 0


def test_a_settled_item_cannot_be_settled_again(conn, client):
    item_id = add_item(conn, feeling="worse")
    client.post(f"/review-items/{item_id}/close", json={})

    response = client.post(f"/review-items/{item_id}/manual", json={})

    assert response.status_code == 409
    assert response.json() == {"error": "already_settled"}


# --- the path a Reviewer actually uses -------------------------------------------


def test_the_submitted_form_releases_and_returns_to_the_queue(conn, client):
    """The form posts form-encoded, not JSON. Same rules, different content type.

    Back to the queue rather than back to the item: the Release has moved this one
    into "Released, awaiting the call", and the sheet it was granted from would
    otherwise reopen still offering to grant a second.
    """
    item_id = add_item(conn, wants_seen="yes")
    body = envelope(clinician="")
    body.pop("clinician")

    response = client.post(
        f"/review-items/{item_id}/release", data=body, follow_redirects=False
    )

    assert response.status_code == 303
    assert response.headers["location"] == "/"
    assert _status(conn, item_id) == ReviewStatus.RELEASED.value


def test_a_widened_quote_from_the_form_is_refused_too(conn, client):
    item_id = add_item(conn, wants_seen="yes")

    response = client.post(
        f"/review-items/{item_id}/release",
        data=envelope(approved_words=QUOTE + " and I nearly fell", clinician=""),
        follow_redirects=False,
    )

    assert response.status_code == 422
    assert conn.execute("SELECT COUNT(*) AS n FROM release").fetchone()["n"] == 0


def test_the_close_button_returns_to_the_queue(conn, client):
    item_id = add_item(conn, feeling="worse")

    response = client.post(
        f"/review-items/{item_id}/close", data={}, follow_redirects=False
    )

    assert response.status_code == 303
    assert response.headers["location"] == "/"
    assert _status(conn, item_id) == ReviewStatus.CLOSED.value


def _status(conn, item_id: int) -> str:
    return conn.execute(
        "SELECT status FROM review_item WHERE id = ?", (item_id,)
    ).fetchone()["status"]


def test_every_item_counted_today_is_accounted_for_by_a_counter(conn, client):
    """An item in a status no counter covers is invisible to the practice.

    `items` deliberately lists only what needs a person, so the counts are the
    only place a refusal shows up at all. See docs/adr/0006.
    """
    add_item(conn, status=ReviewStatus.NEEDS_REVIEW)
    add_item(conn, status=ReviewStatus.AUTO_CLOSED)
    add_item(conn, status=ReviewStatus.DECLINED)
    add_item(conn, status=ReviewStatus.NOT_REACHED)

    payload = client.get("/board").json()
    accounted = (
        payload["needs_review"]
        + payload["auto_closed"]
        + payload["declined"]
        + payload["not_reached"]
    )

    assert accounted == payload["today"] == 4


def test_a_refusal_is_visible_on_the_queue_page(conn, client):
    add_item(conn, status=ReviewStatus.DECLINED)

    page = client.get("/")

    assert "Refused the call" in page.text


def test_the_board_offers_todays_due_checkins_with_numbers_masked(conn, client):
    payload = client.get("/board").json()

    assert payload["due"], "nothing due, so the button would have nothing to place"
    for row in payload["due"]:
        assert "phone_e164" not in row, "a raw number reached the board payload"
        assert row["phone_masked"].count("*") >= 4


def test_a_patient_without_consent_is_never_offered_as_due(conn, client):
    payload = client.get("/board").json()

    withheld = conn.execute(
        "SELECT id FROM patient WHERE consent_to_call = 0"
    ).fetchall()
    assert withheld, "no patient withholds consent, so this proves nothing"
    offered = {row["appointment_id"] for row in payload["due"]}
    for patient in withheld:
        theirs = conn.execute(
            "SELECT id FROM appointment WHERE patient_id = ?", (patient["id"],)
        ).fetchall()
        for appointment in theirs:
            assert appointment["id"] not in offered


def test_placing_todays_checkins_twice_places_them_once(conn, db_path, now):
    """On the pinned clock, like everything else that places a call.

    On the real one this passed only on the one day the seeded Appointments come
    due, and `placed` was 0 on every other. The due day is the thing under test
    elsewhere, not a condition for running the suite.
    """
    client = TestClient(create_app(db_path=db_path, clock=lambda: now))
    first = client.post("/checkins", headers={"content-type": "application/json"})
    placed = first.json()["placed"]
    assert placed >= 1

    second = client.post("/checkins", headers={"content-type": "application/json"})

    assert second.json()["placed"] == 0
    assert client.get("/board").json()["due"] == []


def test_the_board_says_whether_a_button_spends_a_real_call(conn, client):
    page = client.get("/")

    assert "no call will be placed" in page.text
    assert "of 20 used" in page.text


# --- every call is readable, whichever kind it was ---------------------------------
#
# Two things made a transcript unreachable even once it was stored. The Rebooking Call
# is a second `call_attempt` joined by its idempotency key, and nothing ever read it —
# a Reviewer could see that reception had been rung and not one word of what was said.
# And an item that settled left the queue entirely, so its call became a number in the
# counts band and nothing else.

BOOKING_CALL = {
    "state": "terminal_verified",
    "turns": [
        {"index": 0, "speaker": "agent", "text": "I'm calling on behalf of a patient."},
        {"index": 1, "speaker": "other", "text": "Right, what's the name?"},
        {"index": 2, "speaker": "agent", "text": "Margaret Ellery."},
        {"index": 3, "speaker": "other", "text": "I can do Thursday at ten past nine."},
    ],
}


@pytest.fixture
def booking_transcript(tmp_path):
    path = tmp_path / "reception.json"
    path.write_text(json.dumps(BOOKING_CALL), encoding="utf-8")
    return str(path)


def rebook(conn, release_id: int, transcript_path: str) -> None:
    stamp = db.now_iso()
    conn.execute(
        """
        INSERT INTO call_attempt
            (appointment_id, kind, idempotency_key, state, transcript_path,
             created_at, updated_at)
        VALUES (1, 'rebooking', ?, 'terminal_verified', ?, ?, ?)
        """,
        (f"rebooking:{release_id}", transcript_path, stamp, stamp),
    )
    conn.commit()


def test_the_sheet_shows_what_reception_said(conn, client, booking_transcript):
    """The call she authorised, read the same way as the call she judged."""
    item_id = add_item(conn, wants_seen="yes")
    release_id = client.post(
        f"/review-items/{item_id}/release", json=envelope()
    ).json()["release_id"]
    rebook(conn, release_id, booking_transcript)

    page = client.get(f"/?open={item_id}").text

    assert "The call to the practice" in page
    assert "I can do Thursday at ten past nine." in page


def test_an_item_with_no_rebooking_call_shows_no_such_panel(conn, client):
    item_id = add_item(conn, wants_seen="yes")

    page = client.get(f"/?open={item_id}").text

    assert "The call to the practice" not in page


def test_a_rebooking_call_that_stored_nothing_says_so_rather_than_vanishing(
    conn, client
):
    """A placed call with no transcript is still a placed call. Hiding the panel would
    read as no call having been made."""
    item_id = add_item(conn, wants_seen="yes")
    release_id = client.post(
        f"/review-items/{item_id}/release", json=envelope()
    ).json()["release_id"]
    rebook(conn, release_id, None)

    page = client.get(f"/?open={item_id}").text

    assert "The call to the practice" in page
    assert "No transcript stored for this call." in page


def test_a_settled_call_is_still_reachable_from_the_board(conn, client):
    """It needs nobody, which is not the same as nobody being allowed to read it."""
    closed = add_item(conn, feeling="better", status=ReviewStatus.AUTO_CLOSED)
    needs_you = add_item(conn, feeling="worse")

    page = client.get("/").text

    assert "Settled today" in page
    assert f'href="/?open={closed}"' in page
    assert f'href="/?open={needs_you}"' in page


def test_a_settled_item_opens_the_same_sheet_as_any_other(
    conn, client, transcript_file
):
    item_id = add_item(
        conn,
        feeling="better",
        status=ReviewStatus.AUTO_CLOSED,
        transcript_path=transcript_file,
    )

    page = client.get(f"/?open={item_id}").text

    assert "Hello, is that Margaret?" in page


def test_a_board_with_nothing_settled_offers_no_such_list(conn, client):
    add_item(conn, feeling="worse")

    assert "Settled today" not in client.get("/").text


def test_the_sheet_says_when_the_board_read_the_answers_itself(conn, client):
    """A Reviewer looking at "worse" is entitled to know whether the agent on the call
    said so or whether this app decided it afterwards from the recording."""
    item_id = add_item(conn, feeling="worse")
    conn.execute(
        "UPDATE review_item SET answers_from = 'transcript' WHERE id = ?", (item_id,)
    )
    conn.commit()

    assert "This board read these three out of the transcript" in (
        client.get(f"/?open={item_id}").text
    )


def test_answers_the_call_reported_get_no_such_note(conn, client):
    """That is the baseline, and labelling it would make the exception invisible."""
    item_id = add_item(conn, feeling="worse")
    conn.execute(
        "UPDATE review_item SET answers_from = 'agent' WHERE id = ?", (item_id,)
    )
    conn.commit()

    assert "read these three out of the transcript" not in (
        client.get(f"/?open={item_id}").text
    )


def test_the_patient_on_the_row_is_not_assumed_to_be_a_woman(conn, client):
    """The copy was written when Margaret was the only patient in the fixtures, and
    every one of these sat above whichever name the row actually held."""
    item_id = add_item(conn, wants_seen="yes")

    sheet = client.get(f"/?open={item_id}").text
    board = client.get("/").text

    assert "What they said" in sheet
    assert "Their words" in sheet
    assert "on their behalf" in sheet
    assert "You may shorten what they said" in sheet
    assert "<th>Their words</th>" in board
    assert "What she said" not in sheet
    assert "Her words" not in board


# --- the clock the board is judged against ----------------------------------------


def test_a_pinned_clock_is_announced_on_the_board(db_path, monkeypatch):
    """It tells the app what time it is, which is the lever every test already uses.
    What it must never be is quiet — the day is the whole reason a call is allowed, so
    a board judged against a made-up clock says so where a reader, or a recording,
    cannot miss it."""
    monkeypatch.setenv("HOLDFOR_NOW", "11:00")
    page = TestClient(create_app(db_path=db_path)).get("/").text

    assert "The clock is pinned" in page
    assert "11:00" in page


def test_a_real_clock_says_nothing(db_path, monkeypatch):
    monkeypatch.delenv("HOLDFOR_NOW", raising=False)

    assert "The clock is pinned" not in (
        TestClient(create_app(db_path=db_path)).get("/").text
    )


def test_a_clock_nobody_can_read_fails_at_startup(db_path, monkeypatch):
    """Not a fallback to the real time. That would refuse a call for being outside the
    window while the setting meant to open it sat there misspelt."""
    monkeypatch.setenv("HOLDFOR_NOW", "lunchtime")

    with pytest.raises(ValueError, match="HOLDFOR_NOW"):
        create_app(db_path=db_path)


def test_a_bare_time_does_not_move_the_day(db_path, monkeypatch):
    """The due list is judged against this clock too, so pinning a whole date would
    quietly change which Appointments come due."""
    monkeypatch.setenv("HOLDFOR_NOW", "11:00")

    assert window.clock().date() == date.today()
