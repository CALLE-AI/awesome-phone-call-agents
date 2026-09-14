"""Replay scenarios and the CLI. Every one runs with no network."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from reachable import scenarios
from reachable.cli import main
from reachable.phone import is_drama_number

from .conftest import APP_ROOT

SCENARIOS = scenarios.available(APP_ROOT)


def test_there_are_scenarios_to_run():
    assert SCENARIOS


@pytest.mark.parametrize("path", SCENARIOS, ids=lambda p: p.stem)
def test_every_scenario_meets_its_documented_expectations(path: Path):
    result = scenarios.replay(scenarios.load(path), app_root=APP_ROOT)
    assert result.ok, result.failures


@pytest.mark.parametrize("path", SCENARIOS, ids=lambda p: p.stem)
def test_every_scenario_documents_itself_and_asserts_something(path: Path):
    spec = json.loads(path.read_text(encoding="utf-8"))
    assert spec.get("name")
    assert len(spec.get("description", "")) > 60
    assert spec.get("expect"), "a scenario that asserts nothing proves nothing"


def test_the_vulnerable_scenario_places_no_call_at_all():
    spec = scenarios.load(APP_ROOT / "scenarios" / "vulnerable_not_called.json")
    result = scenarios.replay(spec, app_root=APP_ROOT)
    assert result.calls_placed == 0


def test_the_cascade_scenario_never_dials_the_third_contact():
    spec = scenarios.load(APP_ROOT / "scenarios" / "pattern_cascade.json")
    result = scenarios.replay(spec, app_root=APP_ROOT)
    assert result.ok
    assert result.calls_placed == 2


def test_a_scenario_that_fails_its_expectation_is_reported_not_silently_passed():
    spec = scenarios.load(APP_ROOT / "scenarios" / "urgent_escalation.json")
    spec["expect"]["cases"]["PF-P-1041-2026-09-11"] = "PF_REASON_GIVEN"
    result = scenarios.replay(spec, app_root=APP_ROOT)
    assert not result.ok
    assert "expected PF_REASON_GIVEN" in result.failures[0]


def test_scenario_fixtures_only_use_drama_numbers():
    """No fixture number may be able to ring a real subscriber."""
    contacts = (APP_ROOT / "sample_data" / "contacts.csv").read_text(encoding="utf-8")
    for line in contacts.splitlines()[1:]:
        number = line.split(",")[5]
        if number.startswith("+"):
            assert is_drama_number(number), number


# ------------------------------------------------------------------------ CLI


def test_replay_command_runs_every_scenario(capsys):
    assert main(["replay"]) == 0
    out = capsys.readouterr().out
    assert "expectations  all met" in out
    assert "no network was used and no credential was read" in out


def test_preview_command_renders_without_dialling(capsys, monkeypatch, tmp_path):
    monkeypatch.setenv("REACHABLE_DATA_DIR", str(APP_ROOT / "sample_data"))
    monkeypatch.setenv("REACHABLE_DB", str(tmp_path / "cli.sqlite3"))
    assert main(["scan-register"]) == 0
    capsys.readouterr()
    assert main(["preview", "PF-P-1041-2026-09-11"]) == 0
    out = capsys.readouterr().out
    assert "automated assistant" in out
    assert "Idempotency key" in out
    assert "…377" in out
    assert "+447700900377" not in out


def test_import_command_reports_rejected_rows(capsys, monkeypatch, tmp_path):
    monkeypatch.setenv("REACHABLE_DATA_DIR", str(APP_ROOT / "sample_data"))
    monkeypatch.setenv("REACHABLE_DB", str(tmp_path / "cli.sqlite3"))
    assert main(["import"]) == 0
    out = capsys.readouterr().out
    assert "Rejected rows" in out
    assert "invalid phone number" in out
    assert "07700900182" not in out  # masked


def test_config_command_hides_secrets(capsys, monkeypatch):
    monkeypatch.setenv("CALLE_API_KEY", "sk-should-not-appear")
    assert main(["config"]) == 0
    out = capsys.readouterr().out
    assert "sk-should-not-appear" not in out
    assert "set" in out


# ---------------------------------------------------------------- live-contact


def write_contacts(tmp_path: Path) -> Path:
    (tmp_path / "contacts.csv").write_text(
        "contact_id,pupil_id,contact_order,contact_name,relationship,phone_e164,"
        "language,is_emergency_contact,do_not_call\n"
        "C-2090,P-1041,2,Martin Dunn,Grandfather,+447700900218,English,Y,N\n",
        encoding="utf-8",
    )
    return tmp_path


def test_live_contact_refuses_a_drama_number(tmp_path, capsys):
    write_contacts(tmp_path)
    code = main(
        ["live-contact", "--contact", "C-2090", "--number", "+447700900999",
         "--data-dir", str(tmp_path), "--yes"]
    )
    assert code == 2
    assert "cannot ring" in capsys.readouterr().err


def test_live_contact_refuses_an_invalid_number(tmp_path, capsys):
    write_contacts(tmp_path)
    code = main(
        ["live-contact", "--contact", "C-2090", "--number", "07911123456",
         "--data-dir", str(tmp_path), "--yes"]
    )
    assert code == 2
    err = capsys.readouterr().err
    assert "never repaired" in err


def test_live_contact_refuses_an_unknown_contact(tmp_path, capsys):
    write_contacts(tmp_path)
    code = main(
        ["live-contact", "--contact", "C-9999", "--number", "+441632960123",
         "--data-dir", str(tmp_path), "--yes"]
    )
    assert code == 2
    assert "no contact C-9999" in capsys.readouterr().err


def test_live_contact_swaps_the_number_and_masks_it_in_output(tmp_path, capsys):
    write_contacts(tmp_path)
    code = main(
        ["live-contact", "--contact", "C-2090", "--number", "+441632960123",
         "--data-dir", str(tmp_path), "--yes"]
    )
    assert code == 0
    out = capsys.readouterr().out
    assert "…123" in out
    assert "+441632960123" not in out  # never echoed in full
    assert "put the fictional number back" in out
    assert "+441632960123" in (tmp_path / "contacts.csv").read_text(encoding="utf-8")


def test_live_contact_without_yes_requires_typing_the_contact_id(tmp_path, monkeypatch, capsys):
    write_contacts(tmp_path)
    monkeypatch.setattr("builtins.input", lambda _: "wrong")
    code = main(
        ["live-contact", "--contact", "C-2090", "--number", "+441632960123",
         "--data-dir", str(tmp_path)]
    )
    assert code == 1
    assert "Nothing was changed" in capsys.readouterr().out
    assert "+447700900218" in (tmp_path / "contacts.csv").read_text(encoding="utf-8")


def test_cli_output_survives_a_legacy_console_encoding(capsys, monkeypatch, tmp_path):
    """The masking character must not turn into a replacement character.

    A Windows console defaults to a legacy code page. Without this, the very
    first command somebody runs prints a validation report that looks corrupted.
    """
    monkeypatch.setenv("REACHABLE_DATA_DIR", str(APP_ROOT / "sample_data"))
    monkeypatch.setenv("REACHABLE_DB", str(tmp_path / "enc.sqlite3"))
    assert main(["import"]) == 0
    out = capsys.readouterr().out
    assert "…182" in out
    assert "\ufffd" not in out
