from __future__ import annotations

import os

import pytest

from holdfor import __main__ as cli
from holdfor import db, envfile, rebooking, seed as seeding
from holdfor.providers import LiveProvider, default_provider


@pytest.fixture
def calendar_db(tmp_path, monkeypatch):
    """A database seeded against the real calendar.

    `run-due` reads `due_today()` off the system date, unlike the board, which
    takes an injected clock. Seeding at `date.today()` is what gives it work to
    find without the test depending on which hour it runs at.
    """
    path = str(tmp_path / "cli.db")
    conn = db.connect(path)
    db.init(conn)
    seeding.seed(conn)
    conn.close()
    monkeypatch.setenv("HOLDFOR_DB", path)
    return path


@pytest.fixture
def handed_over(monkeypatch):
    """Records which appointments the CLI hands to `checkin.run`.

    The CLI's job is choosing what to place and how many times. What happens
    inside a placement — preflight, the Reading Window, the state machine — is
    tested against `checkin.run` itself, so stubbing it here keeps these tests
    off the wall clock.

    The auto-close gate is stubbed for the same reason: it runs after the
    placement, reads the Review Item this double never wrote, and is covered
    against `review.settle` itself in test_board_and_release.py.
    """
    placed = []

    def fake_run(conn, provider, appointment_id, now=None):
        placed.append(appointment_id)
        return 100 + len(placed)

    monkeypatch.setattr(cli.checkin, "run", fake_run)
    monkeypatch.setattr(cli.review, "settle", lambda conn, item_id: "needs_review")
    return placed


@pytest.fixture
def live(monkeypatch):
    def explode(argv, timeout):
        raise AssertionError(f"the CLI was called: {argv}")

    provider = LiveProvider(runner=explode)
    monkeypatch.setattr(cli, "default_provider", lambda: provider)
    return provider


def test_the_usage_line_names_every_command(capsys):
    assert cli.main([]) == 2
    assert cli.main(["nonsense"]) == 2
    printed = capsys.readouterr().err
    for command in ("init", "run-due", "call <appointment_id>", "serve"):
        assert command in printed


# The guard


def test_run_due_places_nothing_at_all_over_a_live_provider(
    calendar_db, live, handed_over, capsys
):
    """Seven due appointments must not become seven real calls."""
    due = seeding.due_today(db.connect(calendar_db))
    assert len(due) > 1, "the seed should have several appointments due"

    assert cli.main(["run-due"]) == 2
    assert handed_over == [], "nothing was handed over to be placed"

    printed = capsys.readouterr().err
    assert "CALLE_LIVE is set" in printed
    assert f"{len(due)} real calls" in printed
    assert "python -m holdfor call" in printed


def test_run_due_still_works_through_everything_due_against_fixtures(
    calendar_db, handed_over
):
    assert cli.main(["run-due"]) == 0
    assert handed_over == seeding.due_today(db.connect(calendar_db))
    assert len(handed_over) > 1


# One call at a time


def test_call_needs_an_appointment_id(capsys):
    assert cli.main(["call"]) == 2
    assert cli.main(["call", "not-a-number"]) == 2
    assert cli.main(["call", "1", "2"]) == 2
    assert "call <appointment_id>" in capsys.readouterr().err


def test_call_places_exactly_the_one_named(calendar_db, handed_over, capsys):
    assert cli.main(["call", "4"]) == 0
    assert handed_over == [4]
    assert (
        capsys.readouterr().out.strip()
        == "appointment 4: review item 101 (needs_review)"
    )


def test_call_says_out_loud_when_it_is_about_to_ring_a_real_phone(
    calendar_db, live, handed_over, capsys
):
    assert cli.main(["call", "1"]) == 0
    assert handed_over == [1], "live goes through the same one-at-a-time path"
    assert "places a REAL call" in capsys.readouterr().err


# Reporting


def test_a_refusal_is_reported_as_an_outcome_not_a_crash(calendar_db, monkeypatch, capsys):
    monkeypatch.setattr(
        cli.checkin,
        "run",
        lambda *a, **k: (_ for _ in ()).throw(cli.checkin.Refused("no_consent")),
    )
    assert cli.main(["call", "6"]) == 0
    assert "appointment 6: refused (no_consent)" in capsys.readouterr().out


def test_an_unresolved_attempt_tells_you_not_to_re_run(calendar_db, monkeypatch, capsys):
    monkeypatch.setattr(
        cli.checkin,
        "run",
        lambda *a, **k: (_ for _ in ()).throw(
            cli.checkin.AwaitingReconciliation("submission_unknown")
        ),
    )
    assert cli.main(["call", "1"]) == 0
    printed = capsys.readouterr().out
    assert "submission_unknown" in printed
    assert "do not re-run" in printed


def test_an_unknown_appointment_is_reported_not_raised(calendar_db, capsys):
    assert cli.main(["call", "9999"]) == 0
    assert "No appointment 9999" in capsys.readouterr().err


# --- the settings file ------------------------------------------------------------
#
# Every setting in this app is an environment variable, and the two phone numbers were
# the ones that hurt: they sat in `.env` with nothing to read them, so a server started
# in a shell that had not sourced the file refused every Rebooking Call with
# `no_booking_line` — indistinguishable from a broken button.


def test_a_setting_in_the_file_reaches_the_environment(tmp_path, monkeypatch):
    settings = tmp_path / ".env"
    settings.write_text("HOLDFOR_BOOKING_LINE=+441632960118\n", encoding="utf-8")
    monkeypatch.delenv("HOLDFOR_BOOKING_LINE", raising=False)

    assert envfile.load(settings) == ["HOLDFOR_BOOKING_LINE"]
    assert rebooking.booking_line() == "+441632960118"


def test_what_somebody_typed_always_wins(tmp_path, monkeypatch):
    """A file must never countermand a command line. `CALLE_LIVE=1 python -m holdfor`
    has to mean what it says, and so does a booking line aimed at a different phone."""
    settings = tmp_path / ".env"
    settings.write_text("HOLDFOR_BOOKING_LINE=+441632960118\n", encoding="utf-8")
    monkeypatch.setenv("HOLDFOR_BOOKING_LINE", "+447700900500")

    assert envfile.load(settings) == []
    assert rebooking.booking_line() == "+447700900500"


def test_comments_and_blank_lines_are_not_settings(tmp_path, monkeypatch):
    settings = tmp_path / ".env"
    settings.write_text(
        "# HOLDFOR_REGION=MY\n\n   \nHOLDFOR_DB=demo.db\nnot a setting\n",
        encoding="utf-8",
    )
    monkeypatch.delenv("HOLDFOR_REGION", raising=False)
    monkeypatch.delenv("HOLDFOR_DB", raising=False)

    assert envfile.load(settings) == ["HOLDFOR_DB"]
    assert "HOLDFOR_REGION" not in os.environ


def test_a_settings_file_can_never_arm_a_real_phone_call(tmp_path, monkeypatch):
    """The one key that is not config.

    Config comes from the file; spending one of the twenty is typed on the command
    line, every time. `CALLE_LIVE` sits commented out in `.env` for that reason, and a
    comment is not a safeguard — uncommenting it is one keystroke. So it is skipped by
    name, and a file that says `CALLE_LIVE=1` still leaves the provider fake.
    """
    settings = tmp_path / ".env"
    settings.write_text("CALLE_LIVE=1\nHOLDFOR_DB=demo.db\n", encoding="utf-8")
    monkeypatch.delenv("CALLE_LIVE", raising=False)
    monkeypatch.delenv("HOLDFOR_DB", raising=False)

    assert envfile.load(settings) == ["HOLDFOR_DB"]
    assert "CALLE_LIVE" not in os.environ
    assert default_provider().live is False


def test_a_quoted_value_loses_its_quotes(tmp_path, monkeypatch):
    settings = tmp_path / ".env"
    settings.write_text('HOLDFOR_DB="demo.db"\n', encoding="utf-8")
    monkeypatch.delenv("HOLDFOR_DB", raising=False)

    envfile.load(settings)
    assert os.environ["HOLDFOR_DB"] == "demo.db"


def test_no_file_is_the_normal_case(tmp_path):
    """Nothing in this app requires a settings file, and a fresh checkout runs on the
    defaults."""
    assert envfile.load(tmp_path / "absent") == []
