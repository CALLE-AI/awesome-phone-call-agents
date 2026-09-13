from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from holdfor import db
from holdfor.app import create_app
from holdfor.checkin import idempotency_key
from holdfor.models import CallResult, CallState, SubmissionUnknown
from holdfor.outcomes import may_redial
from holdfor.providers import FakeProvider

CONSENTING = 1
KEY = idempotency_key(CONSENTING)


def board(db_path, provider, now):
    return TestClient(
        create_app(db_path=db_path, provider=provider, clock=lambda: now)
    )


def attempts(db_path) -> list[dict]:
    conn = db.connect(db_path)
    try:
        return [dict(row) for row in conn.execute("SELECT * FROM call_attempt")]
    finally:
        conn.close()


def review_items(db_path) -> list[dict]:
    conn = db.connect(db_path)
    try:
        return [dict(row) for row in conn.execute("SELECT * FROM review_item")]
    finally:
        conn.close()


class Counting:
    """A working provider that remembers how often it was asked to dial."""

    def __init__(self, fixtures_dir):
        self.inner = FakeProvider(
            fixtures_dir=fixtures_dir, route={KEY: "01-settled.json"}
        )
        self.places = 0

    def place(self, req):
        self.places += 1
        return self.inner.place(req)

    def poll(self, run_id):
        return self.inner.poll(run_id)

    def transcript_path(self, run_id):
        return self.inner.transcript_path(run_id)


class Ambiguous(Counting):
    """Submission left the client and the client never learned what became of it."""

    def place(self, req):
        self.places += 1
        raise SubmissionUnknown("the client did not learn whether a call was accepted")


class Silent(Counting):
    """Accepts a call, then will not account for the run it just handed back."""

    def poll(self, run_id):
        return CallResult(
            state=CallState.SUBMISSION_UNKNOWN,
            transcript=[],
            structured=None,
            outcome=None,
        )


class PollExplodes(Counting):
    def poll(self, run_id):
        raise RuntimeError("the status read died on the wire")


class Rejects(Counting):
    """A submission the provider definitely refused. No call went out."""

    def place(self, req):
        self.places += 1
        raise RuntimeError("the provider rejected the submission outright")


class WatchesTheDatabase(Counting):
    """Reads the durable record at each step, from its own connection."""

    def __init__(self, fixtures_dir, db_path):
        super().__init__(fixtures_dir)
        self.db_path = db_path
        self.at_place = None
        self.at_poll = None

    def _attempt(self):
        conn = db.connect(self.db_path)
        try:
            row = conn.execute(
                "SELECT state, provider_run_id FROM call_attempt "
                "WHERE idempotency_key = ?",
                (KEY,),
            ).fetchone()
            return dict(row) if row else None
        finally:
            conn.close()

    def place(self, req):
        self.at_place = self._attempt()
        return super().place(req)

    def poll(self, run_id):
        self.at_poll = self._attempt()
        return super().poll(run_id)


# The key


def test_the_key_names_the_appointment_not_the_attempt():
    """Stable across attempts by construction.

    A key with a timestamp or an attempt counter in it would let the same
    Appointment past the UNIQUE constraint a second time.
    """
    assert idempotency_key(CONSENTING) == idempotency_key(CONSENTING) == "checkin:1"
    assert idempotency_key(2) != idempotency_key(1)


def test_the_key_is_on_disk_before_the_call_is_submitted(db_path, fixtures_dir, now):
    provider = WatchesTheDatabase(fixtures_dir, db_path)
    assert board(db_path, provider, now).post(f"/checkins/{CONSENTING}").status_code == 201
    assert provider.at_place == {
        "state": CallState.RESERVED,
        "provider_run_id": None,
    }


def test_the_run_id_is_bound_before_the_result_is_read(db_path, fixtures_dir, now):
    """So that a crash after submission still names the call a person can look up."""
    provider = WatchesTheDatabase(fixtures_dir, db_path)
    board(db_path, provider, now).post(f"/checkins/{CONSENTING}")
    assert provider.at_poll["state"] == CallState.ACCEPTED
    assert provider.at_poll["provider_run_id"]


def test_a_verified_call_ends_terminal_verified(db_path, fixtures_dir, now):
    board(db_path, Counting(fixtures_dir), now).post(f"/checkins/{CONSENTING}")
    (attempt,) = attempts(db_path)
    assert attempt["state"] == CallState.TERMINAL_VERIFIED
    assert attempt["provider_run_id"]
    assert len(review_items(db_path)) == 1


# The ambiguous submission


def test_an_unknown_submission_is_recorded_and_stops(db_path, fixtures_dir, now):
    response = board(db_path, Ambiguous(fixtures_dir), now).post(
        f"/checkins/{CONSENTING}"
    )
    assert response.status_code == 409
    assert response.json() == {"awaiting_reconciliation": "submission_unknown"}

    (attempt,) = attempts(db_path)
    assert attempt["state"] == CallState.SUBMISSION_UNKNOWN
    assert attempt["idempotency_key"] == KEY
    assert attempt["provider_run_id"] is None
    assert review_items(db_path) == []


def test_an_unknown_submission_never_becomes_a_second_call(db_path, fixtures_dir, now):
    """The acceptance criterion. A timeout is not permission to dial again.

    She may already have been rung. Asking the question a second time is how she
    gets rung twice by a machine, so the second request is answered from the
    durable record and the provider is never touched again.
    """
    provider = Ambiguous(fixtures_dir)
    client = board(db_path, provider, now)

    first = client.post(f"/checkins/{CONSENTING}")
    second = client.post(f"/checkins/{CONSENTING}")

    assert first.status_code == second.status_code == 409
    assert second.json() == {"awaiting_reconciliation": "submission_unknown"}
    assert provider.places == 1
    assert len(attempts(db_path)) == 1
    assert review_items(db_path) == []


def test_ten_more_requests_still_place_nothing(db_path, fixtures_dir, now):
    provider = Ambiguous(fixtures_dir)
    client = board(db_path, provider, now)
    for _ in range(11):
        assert client.post(f"/checkins/{CONSENTING}").status_code == 409
    assert provider.places == 1
    assert len(attempts(db_path)) == 1


# Other unfinished attempts


def test_a_provider_that_will_not_account_for_its_run_reaches_a_human(
    db_path, fixtures_dir, now
):
    provider = Silent(fixtures_dir)
    client = board(db_path, provider, now)

    response = client.post(f"/checkins/{CONSENTING}")
    assert response.status_code == 409
    assert response.json() == {"awaiting_reconciliation": "needs_human"}

    (attempt,) = attempts(db_path)
    assert attempt["state"] == CallState.NEEDS_HUMAN
    assert attempt["provider_run_id"], "the run id is still bound for reconciliation"
    assert review_items(db_path) == [], "no answers reach the board that nobody gave"

    assert client.post(f"/checkins/{CONSENTING}").status_code == 409
    assert provider.places == 1


def test_a_status_read_that_dies_leaves_an_accepted_call_bound_to_its_run(
    db_path, fixtures_dir, now
):
    """The reason the run id is written before the poll rather than after it."""
    provider = PollExplodes(fixtures_dir)
    client = board(db_path, provider, now)

    with pytest.raises(RuntimeError):
        client.post(f"/checkins/{CONSENTING}")

    (attempt,) = attempts(db_path)
    assert attempt["state"] == CallState.ACCEPTED
    assert attempt["provider_run_id"]

    # And the next request reconciles rather than redialling.
    assert client.post(f"/checkins/{CONSENTING}").status_code == 409
    assert provider.places == 1


def test_a_confirmed_rejection_also_ends_the_appointment_rather_than_retrying(
    db_path, fixtures_dir, now
):
    """A rejection is safe to retry in principle. We do not, on purpose.

    The PRD allows one attempt per Appointment. Retrying a rejection would put a
    second dial behind the provider's own account of what it did, and that account
    is the thing this ticket declines to trust.
    """
    provider = Rejects(fixtures_dir)
    client = board(db_path, provider, now)

    with pytest.raises(RuntimeError):
        client.post(f"/checkins/{CONSENTING}")

    (attempt,) = attempts(db_path)
    assert attempt["state"] == CallState.RESERVED
    assert attempt["provider_run_id"] is None

    assert client.post(f"/checkins/{CONSENTING}").status_code == 409
    assert provider.places == 1


def test_a_finished_attempt_replays_its_review_item_without_dialling_again(
    db_path, fixtures_dir, now
):
    provider = Counting(fixtures_dir)
    client = board(db_path, provider, now)

    first = client.post(f"/checkins/{CONSENTING}")
    second = client.post(f"/checkins/{CONSENTING}")

    assert first.status_code == second.status_code == 201
    assert first.json() == second.json()
    assert provider.places == 1
    assert len(attempts(db_path)) == 1
    assert len(review_items(db_path)) == 1


# The policy behind the constraint


def test_an_unrecognised_outcome_is_still_never_redialled():
    """ADR 0006. A vocabulary we have not seen before is not a missed call."""
    assert may_redial("SOMETHING_THE_PLATFORM_ADDED_LATER") is False
    assert may_redial("NO_ANSWER") is False
