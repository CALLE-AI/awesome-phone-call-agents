"""End-to-end tests over real HTTP against a local fake status server.

No CALL-E credentials, no browser login, and no outbound call. The fake server
is started as a subprocess exactly as this repository's other apps do, and every
assertion checks that no token value reaches the output.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any

import pytest

APP_DIR = Path(__file__).resolve().parent
FIXTURE_DIR = APP_DIR / "fixtures"
FAKE_SERVER = APP_DIR / "fake_status_server.py"
CLI = APP_DIR / "cli.py"
FAKE_TOKEN = "fake-status-token"

#: Real backoff is 2s..60s. Tests assert behaviour, not wall-clock patience.
FAST_BACKOFF = ("--initial-backoff", "0.01", "--max-backoff", "0.05")

EXIT_OK = 0
EXIT_ERROR = 1
EXIT_UNRESOLVED = 2


def assert_no_secrets(*streams: str) -> None:
    for stream in streams:
        assert FAKE_TOKEN not in stream, "a credential value reached the output"
        assert "Bearer " not in stream, "an authorization header reached the output"


def start_fake_server(fixture: str) -> tuple[subprocess.Popen, dict[str, Any]]:
    process = subprocess.Popen(
        [sys.executable, str(FAKE_SERVER), "--fixture", str(FIXTURE_DIR / fixture)],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        cwd=APP_DIR,
    )
    assert process.stdout is not None
    line = process.stdout.readline()
    if not line:
        process.kill()
        raise AssertionError("fake status server did not announce a base_url")
    return process, json.loads(line)


def run_cli(*args: str, env: dict[str, str] | None = None) -> subprocess.CompletedProcess:
    merged = dict(os.environ)
    merged.pop("CALLE_API_KEY", None)
    if env:
        merged.update(env)
    return subprocess.run(
        [sys.executable, str(CLI), *args],
        capture_output=True,
        text=True,
        cwd=APP_DIR,
        env=merged,
    )


@pytest.fixture
def fake_server(request: pytest.FixtureRequest):
    fixture_name = getattr(request, "param", "happy.json")
    process, payload = start_fake_server(fixture_name)
    try:
        yield payload
    finally:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:  # pragma: no cover - defensive
            process.kill()


@pytest.mark.parametrize("fake_server", ["happy.json"], indirect=True)
def test_reconcile_over_http_reports_a_documented_completion(fake_server: dict) -> None:
    result = run_cli(
        "reconcile",
        "--call-ref",
        "call_e2e_happy",
        "--base-url",
        fake_server["base_url"],
        "--max-observations",
        "6",
        *FAST_BACKOFF,
        env={"CALLE_API_KEY": FAKE_TOKEN},
    )
    assert result.returncode == EXIT_OK, result.stderr
    record = json.loads(result.stdout)
    assert record["outcome"] == "completed"
    assert record["mapping"]["entry_id"] == "rest.calls.completed"
    assert record["raw"]["last_payload"]["status"] == "completed"
    assert_no_secrets(result.stdout, result.stderr)


@pytest.mark.parametrize("fake_server", ["unknown_failure_code.json"], indirect=True)
def test_reconcile_over_http_refuses_to_guess_an_undocumented_code(fake_server: dict) -> None:
    result = run_cli(
        "reconcile",
        "--call-ref",
        "call_e2e_unknown",
        "--base-url",
        fake_server["base_url"],
        "--max-observations",
        "6",
        *FAST_BACKOFF,
        env={"CALLE_API_KEY": FAKE_TOKEN},
    )
    assert result.returncode == EXIT_UNRESOLVED
    record = json.loads(result.stdout)
    assert record["outcome"] == "unresolved"
    assert record["reason"] == "undocumented_failure_detail"
    assert record["raw"]["last_payload"]["failure_code"] == "carrier_reject_42"
    assert_no_secrets(result.stdout, result.stderr)


@pytest.mark.parametrize("fake_server", ["stuck.json"], indirect=True)
def test_a_stuck_call_terminates_at_the_budget_rather_than_hanging(fake_server: dict) -> None:
    result = run_cli(
        "reconcile",
        "--call-ref",
        "call_e2e_stuck",
        "--base-url",
        fake_server["base_url"],
        "--max-observations",
        "4",
        "--max-seconds",
        "30",
        *FAST_BACKOFF,
        env={"CALLE_API_KEY": FAKE_TOKEN},
    )
    assert result.returncode == EXIT_UNRESOLVED
    record = json.loads(result.stdout)
    assert record["outcome"] == "unresolved"
    assert record["reason"] == "polling_budget_exhausted"
    assert record["timing"]["observation_count"] == 4
    assert_no_secrets(result.stdout, result.stderr)


def test_missing_credentials_fail_before_any_request() -> None:
    result = run_cli("reconcile", "--call-ref", "call_e2e_noauth", "--base-url", "http://127.0.0.1:1")
    assert result.returncode == EXIT_ERROR
    assert "CALLE_API_KEY" in result.stderr
    assert_no_secrets(result.stdout, result.stderr)


def test_dry_run_makes_no_network_request() -> None:
    result = run_cli(
        "reconcile",
        "--call-ref",
        "call_e2e_dry",
        "--dry-run",
        "--fixture",
        str(FIXTURE_DIR / "happy.json"),
        "--base-url",
        "http://127.0.0.1:1",
    )
    assert result.returncode == EXIT_OK, result.stderr
    record = json.loads(result.stdout)
    assert record["outcome"] == "completed"


def test_dry_run_without_a_fixture_is_refused() -> None:
    result = run_cli("reconcile", "--call-ref", "call_e2e_dry", "--dry-run")
    assert result.returncode != EXIT_OK
    assert "--dry-run requires --fixture" in (result.stderr + result.stdout)


@pytest.mark.parametrize(
    "fixture,outcome",
    [
        ("happy.json", "completed"),
        ("no_answer.json", "not_connected"),
        ("stuck.json", "unresolved"),
        ("zero_duration_decline.json", "unresolved"),
        ("unknown_failure_code.json", "unresolved"),
        ("flaky_transport.json", "completed"),
        ("plan_timeout.json", "unresolved"),
        ("mcp_completed.json", "unresolved"),
    ],
)
def test_replay_reproduces_every_scenario_offline(fixture: str, outcome: str) -> None:
    result = run_cli(
        "replay", "--fixture", str(FIXTURE_DIR / fixture), "--max-observations", "8", *FAST_BACKOFF
    )
    assert result.returncode in (EXIT_OK, EXIT_UNRESOLVED), result.stderr
    record = json.loads(result.stdout)
    assert record["outcome"] == outcome


def test_explain_prints_the_decision_trail(tmp_path: Path) -> None:
    record_path = tmp_path / "record.json"
    replay = run_cli(
        "replay",
        "--fixture",
        str(FIXTURE_DIR / "zero_duration_decline.json"),
        "--output",
        str(record_path),
        "--max-observations",
        "6",
        *FAST_BACKOFF,
    )
    assert replay.returncode == EXIT_UNRESOLVED, replay.stderr

    explained = run_cli("explain", "--record", str(record_path))
    assert explained.returncode == EXIT_OK, explained.stderr
    assert "outcome         unresolved" in explained.stdout
    assert "inconsistent_payload" in explained.stdout
    assert "decision trail" in explained.stdout
    assert "guard.declined_without_media" in explained.stdout
    assert "#82" in explained.stdout


def test_explain_masks_the_recipient_number(tmp_path: Path) -> None:
    record_path = tmp_path / "record.json"
    run_cli(
        "replay",
        "--fixture",
        str(FIXTURE_DIR / "happy.json"),
        "--output",
        str(record_path),
        "--max-observations",
        "6",
        *FAST_BACKOFF,
    )
    explained = run_cli("explain", "--record", str(record_path))
    assert "+1555010****" in explained.stdout
    assert "+15550101234" not in explained.stdout


def test_show_map_lists_documented_and_unmappable_values() -> None:
    result = run_cli("show-map")
    assert result.returncode == EXIT_OK, result.stderr
    assert "rest.calls.completed" in result.stdout
    assert "UNDOCUMENTED" in result.stdout
    assert "published but unmappable" in result.stdout


def test_a_broken_mapping_table_fails_loudly(tmp_path: Path) -> None:
    broken = tmp_path / "broken.yaml"
    broken.write_text("schema_version: 1\nmap_version: x\n", encoding="utf-8")
    result = run_cli("--map", str(broken), "show-map")
    assert result.returncode == EXIT_ERROR
    assert "Mapping table error" in result.stderr
