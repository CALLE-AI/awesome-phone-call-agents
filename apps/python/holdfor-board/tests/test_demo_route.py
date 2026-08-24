"""The pinned route, and the two counters that only a Rebooking Call can break.

A recording cannot afford to vary between takes, and it cannot afford to greet the
wrong patient on screen. The route pins one transcript to one idempotency key, and the
first test here is what stops a transcript drifting onto a patient it does not name.
"""

from __future__ import annotations

import json
import re
from datetime import timedelta
from pathlib import Path

import pytest

from holdfor import checkin, rebooking, review, seed as seeding
from holdfor.app import board_payload
from holdfor.models import ReviewStatus
from holdfor.providers import (
    LANGUAGE,
    REGION,
    ROUTE_FILE,
    FakeProvider,
    LiveProvider,
    route_from_env,
)

ROOT = Path(__file__).resolve().parents[1]
ROUTE = ROOT / "demo-route.json"
TRANSCRIPTS = ROOT / "fixtures" / "transcripts"

FIRST_NAMES = [row.first_name for row in seeding.PATIENTS]


@pytest.fixture
def route():
    return json.loads(ROUTE.read_text(encoding="utf-8"))


@pytest.fixture
def routed(fixtures_dir, route):
    return FakeProvider(fixtures_dir=fixtures_dir, route=route)


def test_every_routed_transcript_exists(route):
    for key, name in route.items():
        assert (TRANSCRIPTS / name).is_file(), f"{key} -> {name}"


def test_a_routed_check_in_never_greets_a_different_patient(route):
    """The defect this route exists to close.

    Unrouted, a transcript is chosen by arithmetic on the appointment id, so the name
    spoken in it and the name on the page are unrelated. On a demo that is a wrong
    name on screen; on a live call it would be a stranger's name read aloud.
    """
    for key, name in route.items():
        if not key.startswith("checkin:"):
            continue
        appointment_id = int(key.split(":", 1)[1])
        expected = seeding.PATIENTS[appointment_id - 1].first_name
        text = json.dumps(json.loads((TRANSCRIPTS / name).read_text(encoding="utf-8")))
        spoken = {
            other for other in FIRST_NAMES if re.search(rf"\b{other}\b", text)
        }
        assert spoken <= {expected}, f"{name} names {spoken}, shown under {expected}"


def test_the_reception_transcript_is_out_of_the_check_in_pool(fixtures_dir):
    """It lives in a subdirectory, so adding it did not renumber anything.

    The unrouted chooser globs one directory without recursing. A receptionist
    transcript sitting beside the patient ones would change the count it divides by
    and quietly reassign every check-in.
    """
    pool = FakeProvider(fixtures_dir=fixtures_dir)._names()
    assert "reception/booking-line.json" not in pool
    assert all("/" not in name for name in pool)


# ------------------------------------------------------------------- the route file


def test_no_route_leaves_the_chooser_alone(monkeypatch):
    monkeypatch.delenv(ROUTE_FILE, raising=False)
    assert route_from_env() == {}


def test_a_route_is_read_from_the_named_file(monkeypatch, tmp_path):
    path = tmp_path / "route.json"
    path.write_text(json.dumps({"checkin:1": "01-settled.json"}), encoding="utf-8")
    monkeypatch.setenv(ROUTE_FILE, str(path))
    assert route_from_env() == {"checkin:1": "01-settled.json"}


def test_a_malformed_route_raises_rather_than_choosing_by_arithmetic(
    monkeypatch, tmp_path
):
    """Falling back would show the wrong patient's transcript, silently."""
    path = tmp_path / "route.json"
    path.write_text(json.dumps({"checkin:1": ["01-settled.json"]}), encoding="utf-8")
    monkeypatch.setenv(ROUTE_FILE, str(path))
    with pytest.raises(ValueError):
        route_from_env()


# --------------------------------------------------------------- region and language


def test_nothing_is_sent_when_nobody_named_it(monkeypatch):
    monkeypatch.delenv(REGION, raising=False)
    monkeypatch.delenv(LANGUAGE, raising=False)
    assert LiveProvider().dial_options() == []


def test_a_named_region_and_language_reach_the_command(monkeypatch):
    monkeypatch.setenv(REGION, "MY")
    monkeypatch.setenv(LANGUAGE, "English")
    assert LiveProvider().dial_options() == [
        "--region",
        "MY",
        "--language",
        "English",
    ]


# ------------------------------------------------------- what the board says after
# ------------------------------------------------------- a Rebooking Call succeeds


@pytest.fixture
def booked(conn, routed, monkeypatch, today, now):
    """One patient carried through to a booking, over the pinned transcripts."""
    monkeypatch.setenv(rebooking.BOOKING_LINE, "+447700900500")
    for appointment_id in seeding.due_today(conn, today):
        try:
            item = checkin.run(conn, routed, appointment_id, now=now)
        except checkin.Refused:
            continue
        review.settle(conn, item)
    release_id = review.release(
        conn,
        1,
        {
            "earliest_date": today.isoformat(),
            "latest_date": (today + timedelta(days=6)).isoformat(),
            "time_of_day": "morning",
            "mode": "in_person",
            "clinician": "",
            "approved_words": "I can't get up the stairs the way I could",
            "reviewer_name": "Aimee",
        },
    )
    return rebooking.run(conn, routed, release_id)


def test_the_routed_rebooking_call_reaches_a_booking(booked):
    assert booked["status"] == ReviewStatus.BOOKED.value
    assert booked["placed"] is True
    assert booked["booked_time"] == "09:10"


def test_a_rebooking_call_is_not_an_unreconciled_submission(conn, booked):
    """The defect: a Rebooking Call has no Review Item, and never should have one.

    Counting attempts without one made every successful second call report itself
    as a submission nobody had confirmed, on the board, to the person who had just
    watched it succeed.
    """
    assert board_payload(conn)["awaiting_reconciliation"] == 0


def test_a_booked_item_is_visible_in_the_counts(conn, booked):
    """Leaving `needs_review` has to land somewhere, or the row reads as lost."""
    payload = board_payload(conn)
    assert payload["booked"] == 1
    settled = (
        payload["needs_review"]
        + payload["auto_closed"]
        + payload["declined"]
        + payload["not_reached"]
        + payload["booked"]
    )
    assert settled == payload["today"]
