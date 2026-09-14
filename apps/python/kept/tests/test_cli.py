from __future__ import annotations

import shutil
from pathlib import Path

import pytest

from kept.cli import LIVE_CONFIRMATION, LIVE_ENV_FLAG, main

EXAMPLES = Path(__file__).resolve().parent.parent / "examples"


@pytest.fixture
def data_dir(tmp_path: Path) -> Path:
    destination = tmp_path / "data"
    shutil.copytree(EXAMPLES, destination)
    return destination


def test_plan_places_no_calls_and_lists_every_refusal(data_dir: Path, capsys) -> None:
    exit_code = main(["plan", "--data", str(data_dir), "--as-of", "2026-08-24T17:00:00Z"])

    output = capsys.readouterr().out
    assert exit_code == 0
    assert "calls to place : 3" in output
    assert "quiet_hours" in output
    assert not (data_dir / "ledger.jsonl").exists() or (data_dir / "ledger.jsonl").read_text() == ""


def test_live_is_refused_without_the_environment_opt_in(data_dir: Path, monkeypatch, capsys) -> None:
    monkeypatch.delenv(LIVE_ENV_FLAG, raising=False)

    exit_code = main(["run", "--data", str(data_dir), "--live", "--confirm", LIVE_CONFIRMATION])

    assert exit_code == 1
    assert LIVE_ENV_FLAG in capsys.readouterr().err


def test_live_is_refused_without_the_typed_confirmation(data_dir: Path, monkeypatch, capsys) -> None:
    monkeypatch.setenv(LIVE_ENV_FLAG, "true")

    exit_code = main(["run", "--data", str(data_dir), "--live"])

    assert exit_code == 1
    assert LIVE_CONFIRMATION in capsys.readouterr().err


def test_live_cannot_be_run_against_a_pretend_date(data_dir: Path, monkeypatch, capsys) -> None:
    monkeypatch.setenv(LIVE_ENV_FLAG, "true")

    exit_code = main(
        [
            "run",
            "--data",
            str(data_dir),
            "--live",
            "--confirm",
            LIVE_CONFIRMATION,
            "--as-of",
            "2026-08-24",
        ]
    )

    assert exit_code == 1
    assert "--as-of cannot be used with --live" in capsys.readouterr().err


def test_simulate_without_a_scenario_is_an_error_not_a_silent_no_op(data_dir: Path, capsys) -> None:
    exit_code = main(["run", "--data", str(data_dir), "--as-of", "2026-08-24T17:00:00Z"])

    assert exit_code == 1
    assert "--scenario" in capsys.readouterr().err


def test_run_then_report_writes_a_self_contained_html_file(data_dir: Path, tmp_path: Path) -> None:
    main(
        [
            "run",
            "--data",
            str(data_dir),
            "--scenario",
            str(data_dir / "scenarios" / "week1.json"),
            "--as-of",
            "2026-08-24T17:00:00Z",
            "--budget",
            "3",
        ]
    )
    report = tmp_path / "report.html"

    exit_code = main(
        ["report", "--data", str(data_dir), "--as-of", "2026-09-02T17:00:00Z", "--html", str(report)]
    )

    html = report.read_text(encoding="utf-8")
    assert exit_code == 0
    assert "<script" not in html and "http://" not in html
    assert "Promise ledger" in html


def test_report_never_prints_a_phone_number(data_dir: Path, tmp_path: Path) -> None:
    main(
        [
            "run",
            "--data",
            str(data_dir),
            "--scenario",
            str(data_dir / "scenarios" / "week1.json"),
            "--as-of",
            "2026-08-24T17:00:00Z",
        ]
    )
    report = tmp_path / "report.html"
    main(["report", "--data", str(data_dir), "--as-of", "2026-09-02T17:00:00Z", "--html", str(report)])

    assert "+12025" not in report.read_text(encoding="utf-8")


def test_verify_reports_the_chain_length(data_dir: Path, capsys) -> None:
    main(
        [
            "run",
            "--data",
            str(data_dir),
            "--scenario",
            str(data_dir / "scenarios" / "week1.json"),
            "--as-of",
            "2026-08-24T17:00:00Z",
        ]
    )

    exit_code = main(["verify", "--data", str(data_dir)])

    assert exit_code == 0
    assert "chain verified" in capsys.readouterr().out


def test_missing_input_files_fail_with_a_readable_message(tmp_path: Path, capsys) -> None:
    exit_code = main(["plan", "--data", str(tmp_path)])

    assert exit_code == 1
    assert "customers.csv" in capsys.readouterr().err
