"""One row, one call, and knowing which handset is about to ring.

The board had a single control and it dialled everybody due. That is the right button
for a working morning and the wrong one for a calibration call, so the endpoint that
places one Check-in Call now has a control of its own. These tests are about the
difference between the two, and about the number never reaching the page.
"""

from __future__ import annotations

import re

import pytest
from fastapi.testclient import TestClient

from holdfor.app import MY_HANDSET, board_payload, create_app, due_checkins
from holdfor.providers import FakeProvider

MINE = "+447700900003"  # Joyce, in the seeded data
FORM = {"content-type": "application/x-www-form-urlencoded"}


class Counting(FakeProvider):
    """Works exactly as the fake provider does, and remembers every dial."""

    live = True  # what the board reads to decide whether to warn about money

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.dialled: list[str] = []

    def place(self, req):
        self.dialled.append(req.to_e164)
        return super().place(req)


@pytest.fixture
def counting(fixtures_dir):
    return Counting(fixtures_dir=fixtures_dir)


@pytest.fixture
def board(db_path, counting, now):
    return TestClient(
        create_app(db_path=db_path, provider=counting, clock=lambda: now)
    )


# ------------------------------------------------------------------ which is mine


def test_no_row_is_mine_unless_a_handset_is_named(conn, today, monkeypatch):
    monkeypatch.delenv(MY_HANDSET, raising=False)
    due, _ = due_checkins(conn, today)
    assert due
    assert not any(row["yours"] for row in due)


def test_exactly_the_named_handset_is_marked(conn, today, monkeypatch):
    monkeypatch.setenv(MY_HANDSET, MINE)
    due, _ = due_checkins(conn, today)
    marked = [row for row in due if row["yours"]]
    assert len(marked) == 1
    assert marked[0]["first_name"] == "Joyce"


def test_the_digits_never_leave_the_payload(conn, today, monkeypatch):
    """Marking a row must not be a reason to hand the number to a template.

    The comparison happens where the number is already in hand and the flag is what
    travels. A masked number on the page is the whole point of masking it.
    """
    monkeypatch.setenv(MY_HANDSET, MINE)
    due, _ = due_checkins(conn, today)
    for row in due:
        assert "phone_e164" not in row
    assert MINE not in str(board_payload(conn))


def test_the_page_shows_the_mask_and_says_whose_it_is(board, monkeypatch):
    monkeypatch.setenv(MY_HANDSET, MINE)
    body = board.get("/").text
    assert MINE not in body
    assert "+4477******03" in body
    assert body.count("your phone") == 1


# --------------------------------------------------------------- one row, one call


def test_a_row_dials_only_itself(board, counting, conn, today):
    due, _ = due_checkins(conn, today)
    assert len(due) > 1  # otherwise this proves nothing

    board.post(f"/checkins/{due[0]['appointment_id']}", headers=FORM)

    assert len(counting.dialled) == 1


def test_the_whole_day_still_dials_the_whole_day(board, counting, conn, today):
    due, _ = due_checkins(conn, today)
    board.post("/checkins", headers=FORM)
    assert len(counting.dialled) == len(due)


def test_every_due_row_offers_its_own_control(board, conn, today):
    due, _ = due_checkins(conn, today)
    body = board.get("/").text
    for row in due:
        assert f'action="/checkins/{row["appointment_id"]}"' in body
    assert len(re.findall(r'action="/checkins/\d+"', body)) == len(due)


# ------------------------------------------------------------ answering a browser


def test_a_form_post_comes_back_to_the_board(board, conn, today):
    target = due_checkins(conn, today)[0][0]["appointment_id"]
    response = board.post(
        f"/checkins/{target}", headers=FORM, follow_redirects=False
    )
    assert response.status_code == 303
    assert response.headers["location"] == "/?placed=1"


def test_a_refusal_says_so_in_the_url_rather_than_in_json(board):
    """Patient 6 withheld consent, so this Appointment cannot be called from here."""
    response = board.post("/checkins/6", headers=FORM, follow_redirects=False)
    assert response.status_code == 303
    assert response.headers["location"] == "/?refused=no_consent"


def test_a_caller_asking_for_json_still_gets_json(board, conn, today):
    target = due_checkins(conn, today)[0][0]["appointment_id"]
    response = board.post(
        f"/checkins/{target}", headers={"content-type": "application/json"}
    )
    assert response.status_code == 201
    assert response.json()["status"]
