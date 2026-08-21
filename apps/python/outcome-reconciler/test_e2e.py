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


def start_fake_server(fixture: str, hang_seconds: float = 30.0) -> tuple[subprocess.Popen, dict[str, Any]]:
    process = subprocess.Popen(
        [
            sys.executable,
            str(FAKE_SERVER),
            "--fixture",
            str(FIXTURE_DIR / fixture),
            "--hang-seconds",
            str(hang_seconds),
        ],
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
    merged.pop("CALLE_TEST_API_KEY", None)
    merged.pop("CALLE_BASE_URL", None)
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
    param = getattr(request, "param", "happy.json")
    fixture_name, hang_seconds = param if isinstance(param, tuple) else (param, 30.0)
    process, payload = start_fake_server(fixture_name, hang_seconds)
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
        env={"CALLE_TEST_API_KEY": FAKE_TOKEN},
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
        env={"CALLE_TEST_API_KEY": FAKE_TOKEN},
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
        env={"CALLE_TEST_API_KEY": FAKE_TOKEN},
    )
    assert result.returncode == EXIT_UNRESOLVED
    record = json.loads(result.stdout)
    assert record["outcome"] == "unresolved"
    assert record["reason"] == "polling_budget_exhausted"
    assert record["timing"]["observation_count"] == 4
    assert_no_secrets(result.stdout, result.stderr)


@pytest.mark.parametrize("fake_server", ["no_answer.json"], indirect=True)
def test_a_documented_decline_is_reachable_from_a_live_goal_run(fake_server: dict) -> None:
    """not_connected and declined are only documented on the Goal Runs surface.

    Without a client for it they were reachable by replaying a fixture and
    nothing else, which made the layer's most useful outcomes unobtainable in
    real operation.
    """
    result = run_cli(
        "reconcile",
        "--surface",
        "rest.goal_runs",
        "--goal-id",
        "goal_delivery_confirmation",
        "--call-ref",
        "rgrp_e2e_noanswer",
        "--base-url",
        fake_server["base_url"],
        "--max-observations",
        "6",
        *FAST_BACKOFF,
        env={"CALLE_TEST_API_KEY": FAKE_TOKEN},
    )
    assert result.returncode == EXIT_OK, result.stderr
    record = json.loads(result.stdout)
    assert record["outcome"] == "not_connected"
    assert record["mapping"]["entry_id"] == "rest.goal_runs.no_answer"
    # The whole GoalRun is preserved, not just the code the mapping read.
    assert record["raw"]["last_payload"]["object"] == "goal_run"
    assert record["raw"]["last_payload"]["error"]["code"] == "no_answer"
    assert_no_secrets(result.stdout, result.stderr)


def test_the_goal_runs_surface_refuses_to_run_without_a_goal_id() -> None:
    result = run_cli(
        "reconcile",
        "--surface",
        "rest.goal_runs",
        "--call-ref",
        "rgrp_e2e_nogoal",
        "--base-url",
        "http://127.0.0.1:1",
        env={"CALLE_TEST_API_KEY": FAKE_TOKEN},
    )
    assert result.returncode == EXIT_ERROR
    assert "--goal-id" in result.stderr


@pytest.mark.parametrize("fake_server", [("plan_timeout.json", 10.0)], indirect=True)
def test_a_hung_request_is_a_plan_timeout_over_real_http(fake_server: dict) -> None:
    """Distinct from an exhausted budget, and only ever asserted via replay before.

    The server holds the connection open rather than closing it: a close reads
    as a connection reset, which is a recoverable transport error, so the same
    fixture would have resolved as polling_budget_exhausted over HTTP.
    """
    result = run_cli(
        "reconcile",
        "--call-ref",
        "call_e2e_timeout",
        "--base-url",
        fake_server["base_url"],
        "--request-timeout",
        "0.5",
        "--max-observations",
        "3",
        *FAST_BACKOFF,
        env={"CALLE_TEST_API_KEY": FAKE_TOKEN},
    )
    assert result.returncode == EXIT_UNRESOLVED
    record = json.loads(result.stdout)
    assert record["outcome"] == "unresolved"
    assert record["reason"] == "plan_timeout"
    assert_no_secrets(result.stdout, result.stderr)


def test_missing_credentials_fail_before_any_request() -> None:
    result = run_cli("reconcile", "--call-ref", "call_e2e_noauth", "--base-url", "http://127.0.0.1:1")
    assert result.returncode == EXIT_ERROR
    assert "CALLE_API_KEY" in result.stderr
    assert_no_secrets(result.stdout, result.stderr)


def test_the_api_key_is_not_sent_to_an_untrusted_base_url() -> None:
    """Refused before the key is read, so the credential never leaves."""
    result = run_cli(
        "reconcile",
        "--call-ref",
        "call_e2e_badhost",
        "--base-url",
        "https://api.heycall-e.com.attacker.example",
        env={"CALLE_TEST_API_KEY": FAKE_TOKEN},
    )
    assert result.returncode == EXIT_ERROR
    assert "not a host this app trusts" in result.stderr
    assert_no_secrets(result.stdout, result.stderr)


def test_the_base_url_may_come_from_the_environment(fake_server: dict) -> None:
    result = run_cli(
        "reconcile",
        "--call-ref",
        "call_e2e_envbase",
        "--max-observations",
        "6",
        *FAST_BACKOFF,
        env={"CALLE_TEST_API_KEY": FAKE_TOKEN, "CALLE_BASE_URL": fake_server["base_url"]},
    )
    assert result.returncode == EXIT_OK, result.stderr
    assert json.loads(result.stdout)["outcome"] == "completed"


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
        ("declined.json", "declined"),
        ("stuck.json", "unresolved"),
        ("zero_duration_decline.json", "unresolved"),
        ("completed_without_media.json", "unresolved"),
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


def test_a_replayed_record_reports_plausible_timing() -> None:
    """A replay never sleeps, so reading the wall clock would report a call
    stuck since July as having elapsed a few microseconds."""
    result = run_cli(
        "replay",
        "--fixture",
        str(FIXTURE_DIR / "stuck.json"),
        "--max-observations",
        "5",
        "--initial-backoff",
        "2",
        "--max-backoff",
        "60",
    )
    timing = json.loads(result.stdout)["timing"]
    assert timing["observation_count"] == 5
    # 2 + 4 + 8 + 16, the un-jittered backoff between five observations.
    assert timing["elapsed_seconds"] == 30.0
    assert timing["first_observed_at"].startswith("2026-07-30")


def test_a_replayed_record_is_reproducible_byte_for_byte() -> None:
    args = ("replay", "--fixture", str(FIXTURE_DIR / "stuck.json"), "--max-observations", "5")
    assert run_cli(*args).stdout == run_cli(*args).stdout


def test_replay_accepts_a_recipient_for_a_fixture_that_names_none(tmp_path: Path) -> None:
    fixture = tmp_path / "anonymous.json"
    fixture.write_text(
        json.dumps(
            {
                "surface": "rest.calls",
                "sequence": [{"payload": {"status": "completed", "completed_at": "2026-08-06T10:00:00Z"}}],
            }
        ),
        encoding="utf-8",
    )
    result = run_cli("replay", "--fixture", str(fixture), "--recipient", "+15550101234", *FAST_BACKOFF)
    assert result.returncode == EXIT_OK, result.stderr
    assert json.loads(result.stdout)["recipient"]["phone_e164_masked"] == "+1555010****"


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


# -- malformed input ---------------------------------------------------------
#
# Every case below produced a Python traceback before. None was caught by the
# rest of the suite, because every other test feeds well-formed input. A
# stack trace tells a user they hit a bug; a message tells them what to fix.


def write(tmp_path: Path, name: str, text: str) -> str:
    path = tmp_path / name
    path.write_text(text, encoding="utf-8")
    return str(path)


@pytest.mark.parametrize(
    "content,expected",
    [
        ("not json at all", "not valid JSON"),
        ("[1, 2, 3]", "expected a JSON object"),
        ('"a string"', "expected a JSON object"),
        ("{}", "is not an outcome record"),
        ('{"call_ref": "x"}', "is not an outcome record"),
    ],
)
def test_explain_refuses_a_file_that_is_not_a_record(
    tmp_path: Path, content: str, expected: str
) -> None:
    result = run_cli("explain", "--record", write(tmp_path, "thing.json", content))
    assert result.returncode == EXIT_ERROR
    assert expected in result.stderr
    assert "Traceback" not in result.stderr


@pytest.mark.parametrize(
    "content,expected",
    [
        ("not json at all", "not valid JSON"),
        ("[]", "must be a JSON object"),
        ('{"sequence": [{"payload": {"status": "completed"}}]}', "must name the surface"),
        ('{"surface": "rest.calls"}', "non-empty sequence"),
        ('{"surface": "rest.calls", "sequence": []}', "non-empty sequence"),
        ('{"surface": "rest.calls", "sequence": ["not an object"]}', "not an object"),
        ('{"surface": "", "sequence": [{"payload": {}}]}', "must name the surface"),
    ],
)
def test_replay_refuses_a_file_that_is_not_a_fixture(
    tmp_path: Path, content: str, expected: str
) -> None:
    result = run_cli("replay", "--fixture", write(tmp_path, "fixture.json", content))
    assert result.returncode == EXIT_ERROR
    assert expected in result.stderr
    assert "Traceback" not in result.stderr


def test_a_fixture_naming_an_unknown_surface_resolves_rather_than_crashing() -> None:
    """An unknown surface is a legitimate observation, not a malformed file."""
    import tempfile

    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "unknown.json"
        path.write_text(
            json.dumps(
                {"surface": "rest.imaginary", "sequence": [{"payload": {"status": "completed"}}]}
            ),
            encoding="utf-8",
        )
        result = run_cli("replay", "--fixture", str(path), *FAST_BACKOFF)
    assert result.returncode == EXIT_UNRESOLVED
    assert json.loads(result.stdout)["reason"] == "undocumented_code"


# -- explain is documented as safe to share ---------------------------------


def test_explain_never_prints_upstream_call_prose(tmp_path: Path) -> None:
    """safety.md promises this view can be shared. Then keep it shareable.

    `summary` and `evidence` are upstream's prose about what was said on the
    call. They were briefly printed here, which quietly falsified that promise.
    """
    record_path = tmp_path / "record.json"
    replay = run_cli(
        "replay", "--fixture", str(FIXTURE_DIR / "completed_voicemail.json"),
        "--output", str(record_path), *FAST_BACKOFF,
    )
    assert replay.returncode == EXIT_OK, replay.stderr

    record = json.loads(record_path.read_text(encoding="utf-8"))
    judgment = record["upstream_judgment"]

    # positive control: the payload really does carry prose, so the assertions
    # below cannot pass merely because there was nothing to leak
    assert judgment["summary"], "fixture no longer carries a summary; this test is vacuous"
    assert judgment["evidence"], "fixture no longer carries evidence; this test is vacuous"

    explained = run_cli("explain", "--record", str(record_path))
    assert explained.returncode == EXIT_OK, explained.stderr

    assert judgment["summary"] not in explained.stdout
    for item in judgment["evidence"]:
        assert item not in explained.stdout
    # the useful signal survives without the prose
    assert "task_completed" in explained.stdout
    assert "False" in explained.stdout


def test_explain_masks_the_call_reference(tmp_path: Path) -> None:
    record_path = tmp_path / "record.json"
    run_cli(
        "replay", "--fixture", str(FIXTURE_DIR / "happy.json"),
        "--call-ref", "call_sensitive_reference_value",
        "--output", str(record_path), *FAST_BACKOFF,
    )
    explained = run_cli("explain", "--record", str(record_path))
    assert "call_sensitive_reference_value" not in explained.stdout
    assert "call_sens" in explained.stdout


def test_explain_never_prints_a_raw_payload_field(tmp_path: Path) -> None:
    """The other half of the safety.md promise."""
    record_path = tmp_path / "record.json"
    run_cli(
        "replay", "--fixture", str(FIXTURE_DIR / "unknown_failure_code.json"),
        "--output", str(record_path), *FAST_BACKOFF,
    )
    record = json.loads(record_path.read_text(encoding="utf-8"))
    assert record["raw"]["last_payload"]["failure_code"] == "carrier_reject_42"  # control

    explained = run_cli("explain", "--record", str(record_path))
    assert "carrier_reject_42" not in explained.stdout
    assert "unrecognised-field-preserved" not in explained.stdout
