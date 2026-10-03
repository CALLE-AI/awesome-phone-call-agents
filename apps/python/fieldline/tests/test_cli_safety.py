from pathlib import Path
from unittest.mock import Mock

import pytest

from fieldline import cli
from fieldline.config import Settings
from fieldline.demo_data import demo_trip_plan
from fieldline.engine import TripResult


@pytest.fixture
def setup(tmp_path, monkeypatch):
    plan = demo_trip_plan()
    monkeypatch.setattr(cli, "load_trip_plan", lambda _: plan)
    monkeypatch.setattr(cli, "validate_live_window", lambda *a, **k: None)
    dispatcher = Mock()
    constructor = Mock(return_value=dispatcher)
    monkeypatch.setattr(cli, "LiveCalleDispatcher", constructor)
    engine = Mock()
    engine.run.return_value = TripResult("review_required", None, [])
    monkeypatch.setattr(cli, "TripEngine", Mock(return_value=engine))
    settings = Settings(False, False, "fake-test-key", "https://api.heycall-e.com", tmp_path)
    return settings, plan, constructor, dispatcher, engine


def test_explicit_destinations_required_before_prompt(setup, monkeypatch):
    settings, plan, constructor, _, _ = setup
    prompt = Mock(side_effect=AssertionError("must not prompt"))
    monkeypatch.setattr("builtins.input", prompt)
    assert cli.cmd_live(settings, "plan", [], single=False) == 2
    constructor.assert_not_called()


def test_confirmation_cannot_be_skipped(setup, monkeypatch):
    settings, plan, constructor, _, _ = setup
    monkeypatch.setattr("builtins.input", lambda _: "yes")
    assert cli.cmd_live(settings, "plan", [plan.worker.phone], single=True) == 1
    constructor.assert_not_called()


def test_yes_option_is_rejected():
    with pytest.raises(SystemExit) as exc:
        cli.main(["start", "plan", "--yes"])
    assert exc.value.code == 2


def test_cancel_marker_is_not_erased(setup, monkeypatch):
    settings, plan, constructor, _, _ = setup
    (settings.home / "cancel").touch()
    assert cli.cmd_live(settings, "plan", [plan.worker.phone], single=True) == 2
    constructor.assert_not_called()
    assert (settings.home / "cancel").exists()


def test_live_authorization_and_transport_cleanup(setup, monkeypatch):
    settings, plan, constructor, dispatcher, engine = setup
    monkeypatch.setattr("builtins.input", lambda _: "LIVE")
    phones = [plan.worker.phone, *(c.phone for c in plan.escalation)]
    assert cli.cmd_live(settings, "plan", phones, single=False) == 1
    assert constructor.call_args.kwargs["authorized_phones"] == set(phones)
    engine.run.assert_called_once()
    dispatcher.close.assert_called_once()


def test_extra_unintended_destination_is_rejected(setup):
    settings, plan, constructor, _, _ = setup
    assert cli.cmd_live(settings, "plan", [plan.worker.phone, "+15555550199"], single=True) == 2
    constructor.assert_not_called()
