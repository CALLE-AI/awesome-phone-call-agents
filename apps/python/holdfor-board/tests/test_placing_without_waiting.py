"""The page comes back while the phone is still ringing.

Placing a call used to be one blocking request: the browser held a spinner for the
length of a conversation, and the first thing the board said afterwards was whatever
the reader thought to reload. A real live call proved it — the page span until it was
refreshed by hand.

So `checkin.run` is now two halves. `start` submits and returns; `finish` waits. These
tests are about the gap between them being visible, honest, and impossible to turn
into a second phone call.
"""

from __future__ import annotations

import sqlite3

import pytest
from fastapi.testclient import TestClient

from holdfor import checkin, db
from holdfor.app import board_payload, create_app
from holdfor.models import CallState
from holdfor.providers import FakeProvider

CONSENTING = 1
FORM = {"content-type": "application/x-www-form-urlencoded"}
JSON = {"content-type": "application/json"}


class Held:
    """A background that remembers the work rather than doing it.

    A thread that finishes in a microsecond cannot show the state this change is
    about. Holding the work makes "call placed, nothing written yet" something a
    test can read, and running it later makes the landing deliberate.
    """

    def __init__(self) -> None:
        self.work: list = []

    def __call__(self, work) -> None:
        self.work.append(work)

    def land(self) -> None:
        held, self.work = self.work, []
        for work in held:
            work()


@pytest.fixture
def held():
    return Held()


@pytest.fixture
def board(db_path, provider, now, held):
    return TestClient(
        create_app(
            db_path=db_path, provider=provider, clock=lambda: now, background=held
        )
    )


def state_of(conn, appointment_id: int) -> sqlite3.Row:
    return conn.execute(
        """
        SELECT call_attempt.state       AS state,
               call_attempt.provider_run_id AS run_id,
               review_item.id           AS review_item_id
        FROM call_attempt
        LEFT JOIN review_item ON review_item.call_attempt_id = call_attempt.id
        WHERE call_attempt.appointment_id = ? AND call_attempt.kind = 'checkin'
        """,
        (appointment_id,),
    ).fetchone()


# ------------------------------------------------------- the response comes back first


def test_a_form_press_answers_before_anything_is_polled(board, held, conn):
    response = board.post(f"/checkins/{CONSENTING}", headers=FORM, follow_redirects=False)

    assert response.status_code == 303
    assert response.headers["location"] == "/"
    assert held.work, "the poll was not handed anywhere"
    assert state_of(conn, CONSENTING)["review_item_id"] is None


def test_the_call_is_named_before_the_page_is_returned(board, conn):
    """A submitted call must never be a call nothing has a record of.

    The reserve-then-bind order is what makes the early return safe: by the time
    the browser has the board, the run id is on the row and a person can look the
    call up whatever happens to the worker.
    """
    board.post(f"/checkins/{CONSENTING}", headers=FORM)
    row = state_of(conn, CONSENTING)

    assert row["state"] == CallState.ACCEPTED.value
    assert row["run_id"]


def test_the_review_item_appears_when_the_call_lands(board, held, conn):
    board.post(f"/checkins/{CONSENTING}", headers=FORM)
    held.land()

    assert state_of(conn, CONSENTING)["review_item_id"] is not None


def test_a_json_caller_still_waits_and_still_gets_the_outcome(board, held):
    """It asked for the result, not for a page. Nothing is handed to a worker."""
    response = board.post(f"/checkins/{CONSENTING}", headers=JSON)

    assert response.status_code == 201
    assert response.json()["review_item_id"]
    assert held.work == []


# ------------------------------------------------------------------ what the board says


def test_a_call_in_progress_is_not_awaiting_reconciliation(board, conn, today):
    """The banner it would otherwise show tells a Reviewer to go and reconcile a
    call she can still hear ringing."""
    board.post(f"/checkins/{CONSENTING}", headers=FORM)
    payload = board_payload(conn, due_on=today)

    assert len(payload["in_flight"]) == 1
    assert payload["in_flight"][0]["first_name"] == "Margaret"
    assert payload["awaiting_reconciliation"] == 0


def test_the_page_reloads_itself_only_while_a_call_is_in_flight(board, held):
    assert "http-equiv=\"refresh\"" not in board.get("/").text

    board.post(f"/checkins/{CONSENTING}", headers=FORM)
    ringing = board.get("/").text
    assert "http-equiv=\"refresh\"" in ringing
    assert "On the phone now" in ringing

    held.land()
    settled = board.get("/").text
    assert "http-equiv=\"refresh\"" not in settled
    assert "On the phone now" not in settled


def test_an_open_sheet_stops_the_board_reloading_underneath_it(board, held, conn):
    """The two features would otherwise fight.

    A reload every four seconds empties a half-typed Release to update a count behind
    it. Opening a sheet is a deliberate act on one item; the queue can wait until she
    closes it, and then it starts moving again.
    """
    board.post(f"/checkins/{CONSENTING}", headers=FORM)
    held.land()
    item_id = state_of(conn, CONSENTING)["review_item_id"]

    board.post("/checkins/2", headers=FORM)

    assert 'http-equiv="refresh"' in board.get("/").text
    assert 'http-equiv="refresh"' not in board.get(f"/?open={item_id}").text


def test_the_number_in_flight_is_masked_like_every_other(board, conn, today):
    board.post(f"/checkins/{CONSENTING}", headers=FORM)
    number = conn.execute(
        "SELECT phone_e164 FROM patient WHERE id = ?", (CONSENTING,)
    ).fetchone()["phone_e164"]

    payload = board_payload(conn, due_on=today)
    assert "phone_e164" not in payload["in_flight"][0]
    assert number not in board.get("/").text
    assert payload["in_flight"][0]["phone_masked"] in board.get("/").text


def test_a_call_nobody_is_waiting_for_any_more_needs_a_person(board, conn, today):
    """The hole the grace period closes.

    A worker dies, or the process holding it does, and an `accepted` row with a
    live poll behind it becomes an `accepted` row with nothing behind it. Left as
    "in progress" it would say a call was ringing for the rest of the day, and the
    page would reload every four seconds saying so.
    """
    board.post(f"/checkins/{CONSENTING}", headers=FORM)
    conn.execute("UPDATE call_attempt SET updated_at = '2020-01-01T00:00:00+00:00'")
    conn.commit()

    payload = board_payload(conn, due_on=today)
    assert payload["in_flight"] == []
    assert payload["awaiting_reconciliation"] == 1


# ----------------------------------------------------- one call, however it is pressed


def test_pressing_again_while_it_rings_places_nothing(db_path, fixtures_dir, now, held):
    class Counting(FakeProvider):
        def __init__(self, **kwargs):
            super().__init__(**kwargs)
            self.dialled: list[str] = []

        def place(self, req):
            self.dialled.append(req.to_e164)
            return super().place(req)

    counting = Counting(fixtures_dir=fixtures_dir)
    board = TestClient(
        create_app(
            db_path=db_path, provider=counting, clock=lambda: now, background=held
        )
    )

    board.post(f"/checkins/{CONSENTING}", headers=FORM)
    second = board.post(f"/checkins/{CONSENTING}", headers=FORM, follow_redirects=False)

    assert len(counting.dialled) == 1
    assert second.headers["location"] == "/?refused=accepted"


def test_finishing_twice_writes_one_review_item(conn, provider, now):
    """Two finishers can reach the same run: a worker and a restart, or a worker and
    the CLI. The index behind `review_item` settles it and the loser reads the row
    that won."""
    attempt_id = checkin.start(conn, provider, CONSENTING, now=now)

    first = checkin.finish(conn, provider, attempt_id)
    second = checkin.finish(conn, provider, attempt_id)

    assert first == second
    assert conn.execute(
        "SELECT COUNT(*) AS n FROM review_item WHERE call_attempt_id = ?",
        (attempt_id,),
    ).fetchone()["n"] == 1


def test_the_index_refuses_a_second_review_item_outright(conn, provider, now):
    """Belt to the braces above: the read `finish` does could be raced past."""
    attempt_id = checkin.start(conn, provider, CONSENTING, now=now)
    checkin.finish(conn, provider, attempt_id)

    with pytest.raises(sqlite3.IntegrityError):
        conn.execute(
            """
            INSERT INTO review_item
                (call_attempt_id, stop_condition, status, created_at)
            VALUES (?, 0, 'needs_review', ?)
            """,
            (attempt_id, db.now_iso()),
        )


# ------------------------------------------------------------------ the halves apart


def test_run_is_still_start_then_finish(conn, provider, now):
    """Every other caller — the CLI, the day's run, the whole suite — uses `run`."""
    review_item_id = checkin.run(conn, provider, CONSENTING, now=now)

    assert state_of(conn, CONSENTING)["review_item_id"] == review_item_id
    assert state_of(conn, CONSENTING)["state"] == CallState.TERMINAL_VERIFIED.value


def test_finish_never_places_a_call(conn, fixtures_dir, now):
    """It only ever reads a run that is already bound, which is what makes it safe
    to hand to a worker and safe to arrive twice."""

    class Counting(FakeProvider):
        def __init__(self, **kwargs):
            super().__init__(**kwargs)
            self.places = 0

        def place(self, req):
            self.places += 1
            return super().place(req)

    provider = Counting(fixtures_dir=fixtures_dir)
    attempt_id = checkin.start(conn, provider, CONSENTING, now=now)
    assert provider.places == 1

    checkin.finish(conn, provider, attempt_id)
    checkin.finish(conn, provider, attempt_id)
    assert provider.places == 1


def test_an_unbound_attempt_still_reaches_a_person(conn, provider):
    """No run id means there is nothing to ask about, which is the state the whole
    reconciliation path exists for."""
    conn.execute(
        """
        INSERT INTO call_attempt
            (appointment_id, kind, idempotency_key, state, created_at, updated_at)
        VALUES (1, 'checkin', 'checkin:1', 'submission_unknown', ?, ?)
        """,
        (db.now_iso(), db.now_iso()),
    )
    conn.commit()
    orphan = conn.execute("SELECT id FROM call_attempt").fetchone()["id"]

    with pytest.raises(checkin.AwaitingReconciliation):
        checkin.finish(conn, provider, orphan)
