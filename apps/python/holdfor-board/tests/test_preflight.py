from __future__ import annotations

from datetime import date, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from holdfor import window
from holdfor.app import create_app
from holdfor.checkin import NO_CONSENT, NOT_DUE_TODAY, preflight
from holdfor.models import Appointment, Patient
from holdfor.providers import FakeProvider

CONSENTING = 1
WITHHOLDING = 6
DUE_TOMORROW = 9  # seen two days ago, so day 3 falls tomorrow

MONDAY = "2026-08-17"  # seen_on; day 3 is Thursday 20 August
DUE = date(2026, 8, 20)


def a_patient(consent: bool = True) -> Patient:
    return Patient(
        id=1,
        first_name="Margaret",
        surname="Ellery",
        dob="1941-03-17",
        phone_e164="+447700900001",
        consent_to_call=consent,
        created_at="2026-08-20T09:00:00+00:00",
    )


def an_appointment(seen_on: str = MONDAY) -> Appointment:
    return Appointment(
        id=1,
        patient_id=1,
        seen_on=seen_on,
        appointment_type="Leg ulcer dressing",
        medication_changed=False,
        followup_booked=False,
    )


class NeverCalled:
    """A provider that fails the test if a refused call reaches it.

    Stands in for `LiveProvider`, which will read a credential when it places a
    call. Nothing may touch it on a path that ends in a refusal.
    """

    def place(self, req):
        raise AssertionError("A refused call reached the provider")

    def poll(self, run_id):
        raise AssertionError("A refused call reached the provider")


@pytest.fixture
def client(db_path, fixtures_dir, now):
    """The board, sitting on the day-3 due date."""
    return TestClient(
        create_app(
            db_path=db_path,
            provider=FakeProvider(fixtures_dir=fixtures_dir),
            clock=lambda: now,
        )
    )


# The day a call is due


def test_day_three_on_a_weekday_is_left_alone():
    assert window.due_date("2026-08-17") == date(2026, 8, 20)


@pytest.mark.parametrize(
    "seen_on, shifted_to",
    [
        ("2026-08-19", date(2026, 8, 24)),  # day 3 is Saturday
        ("2026-08-20", date(2026, 8, 24)),  # day 3 is Sunday
    ],
)
def test_a_day_three_landing_on_a_weekend_shifts_forward_to_the_monday(
    seen_on, shifted_to
):
    assert window.due_date(seen_on) == shifted_to
    assert window.due_date(seen_on).weekday() < window.SATURDAY


def test_the_shift_is_never_backwards_and_never_lands_on_a_weekend():
    """Ringing early is worse than ringing late.

    Day 2 is too soon for a post-procedure problem to have shown, so a weekend
    is always stepped over rather than pulled back from.
    """
    for day in range(1, 32):
        seen_on = date(2026, 8, day)
        due = window.due_date(seen_on.isoformat())
        assert due >= seen_on + timedelta(days=window.CHECKIN_DAY)
        assert due.weekday() < window.SATURDAY


# Preflight


def test_a_consenting_patient_on_her_due_day_is_called():
    assert preflight(a_patient(), an_appointment(), datetime(2026, 8, 20, 11, 0)) is None


@pytest.mark.parametrize(
    "moment",
    [
        datetime(2026, 8, 20, 6, 30),
        datetime(2026, 8, 20, 22, 45),
    ],
)
def test_the_hour_no_longer_refuses_a_call_on_her_due_day(moment):
    """The Reading Window is gone. Day 3 is still the only day, but any hour of it
    will place the call."""
    assert preflight(a_patient(), an_appointment(), moment) is None


def test_consent_is_asked_before_the_day():
    """The reason a Reviewer sees is hers, not ours.

    A Patient who withheld consent, asked about on the wrong day, is refused for
    `no_consent`. Reporting `not_due_today` would suggest the call might go out
    tomorrow. It never will.
    """
    refusal = preflight(
        a_patient(consent=False), an_appointment(), datetime(2026, 8, 22, 23, 0)
    )
    assert refusal == NO_CONSENT


@pytest.mark.parametrize("offset", [-1, 1])
def test_a_call_on_the_wrong_day_is_refused(offset):
    moment = datetime.combine(
        DUE + timedelta(days=offset), datetime.min.time()
    ).replace(hour=11)
    assert preflight(a_patient(), an_appointment(), moment) == NOT_DUE_TODAY


def test_an_appointment_whose_day_three_is_a_saturday_is_called_on_the_monday():
    appointment = an_appointment(seen_on="2026-08-19")
    assert (
        preflight(a_patient(), appointment, datetime(2026, 8, 22, 11, 0))
        == NOT_DUE_TODAY
    )
    assert preflight(a_patient(), appointment, datetime(2026, 8, 24, 11, 0)) is None


# The board


def test_a_call_on_a_day_that_is_not_hers_is_refused_with_409(client, conn):
    response = client.post(f"/checkins/{DUE_TOMORROW}")
    assert response.status_code == 409
    assert response.json() == {"refused": NOT_DUE_TODAY}
    attempts = conn.execute(
        "SELECT COUNT(*) AS n FROM call_attempt WHERE appointment_id = ?",
        (DUE_TOMORROW,),
    ).fetchone()["n"]
    assert attempts == 0


def test_nothing_is_placed_at_the_weekend(db_path, fixtures_dir, conn):
    """Still true with the Reading Window gone, and now for the only reason left:
    `due_date` steps day 3 forward off a Saturday, so nobody is ever due on one."""
    saturday = datetime(2026, 8, 22, 11, 0)
    client = TestClient(
        create_app(
            db_path=db_path,
            provider=FakeProvider(fixtures_dir=fixtures_dir),
            clock=lambda: saturday,
        )
    )
    response = client.post(f"/checkins/{CONSENTING}")
    assert response.status_code == 409
    assert response.json() == {"refused": NOT_DUE_TODAY}
    assert conn.execute("SELECT COUNT(*) AS n FROM call_attempt").fetchone()["n"] == 0


@pytest.mark.parametrize("appointment_id", [WITHHOLDING, DUE_TOMORROW])
def test_a_refusal_never_reaches_the_provider(
    db_path, now, appointment_id, conn
):
    """Preflight decides before anything that would read a credential.

    `NeverCalled` raises if it is touched at all, so a 409 here is evidence that
    the refusal was settled above the provider rather than after it.
    """
    client = TestClient(
        create_app(db_path=db_path, provider=NeverCalled(), clock=lambda: now)
    )
    assert client.post(f"/checkins/{appointment_id}").status_code == 409
    assert conn.execute("SELECT COUNT(*) AS n FROM call_attempt").fetchone()["n"] == 0
