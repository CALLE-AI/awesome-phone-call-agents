"""Tests for the --mode demo|live separation in resolver.py.

demo (default): the compliance gate is always evaluated and displayed
honestly, but a failing result never stops the call - not even a real
CALL-E call if --execute --allow-live are also passed. A live-policy
violation becomes a warning, never a block. live: the compliance gate
is fully enforced, fail-closed, identical to the original
compliance-gated-callback behavior. --allow-live only ever means "a
real call to CALL-E is explicitly authorized", independent of --mode;
--execute is the separate, second confirmation required before
anything is ever sent, in either mode.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fake_server import FakeCalleServer

HERE = Path(__file__).resolve().parent.parent
CASE = str(HERE / "cases" / "ghost-appointment.json")


def _write_near_deadline_case(tmp_path: Path) -> str:
    """A throwaway copy of cases/ghost-appointment.json (never modified
    on disk) with its deadline relative to real wall-clock time instead
    of a fixed date - lets R1-R4 trigger using genuinely real time, with
    no --now-utc at all, which is required for the tests below since
    --now-utc is refused together with --allow-live.
    """
    data = json.loads((HERE / "cases" / "ghost-appointment.json").read_text(encoding="utf-8"))
    data["deadline"] = (datetime.now(timezone.utc) + timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%SZ")
    case_path = tmp_path / "near-deadline-ghost-appointment.json"
    case_path.write_text(json.dumps(data), encoding="utf-8")
    return str(case_path)

# Both within 24h of the case's 2026-09-11T14:00:00Z deadline (threshold
# 24h), so R1-R4 all trigger identically for both - only the compliance
# gate's calling-window check differs between the two "now" values.
LEGAL_HOUR_NOW = "2026-09-10T20:00:00Z"  # 16:00 New York local (EDT) - within 8:00-21:00
ILLEGAL_HOUR_NOW = "2026-09-11T02:00:00Z"  # 22:00 New York local (EDT, previous day) - outside 8:00-21:00

US_COMPLIANT_FLAGS = [
    "--consent-obtained",
    "--consent-timestamp",
    "2026-08-20T12:00:00Z",
    "--dnc-checked",
    "--recipient-timezone",
    "America/New_York",
]


def _run_resolver(
    server_base_url: str, extra_args: list[str], case_path: str = CASE
) -> subprocess.CompletedProcess[str]:
    env = dict(os.environ)
    env.pop("CALLE_API_KEY", None)
    return subprocess.run(
        [
            sys.executable,
            str(HERE / "resolver.py"),
            case_path,
            "--base-url",
            server_base_url,
            "--poll-interval-seconds",
            "0.01",
            *extra_args,
        ],
        capture_output=True,
        text=True,
        env=env,
        timeout=30,
    )


def test_demo_mode_illegal_hour_reaches_calle_but_flags_would_block_in_live() -> None:
    with FakeCalleServer() as server:
        result = _run_resolver(
            server.base_url,
            ["--mode", "demo", "--now-utc", ILLEGAL_HOUR_NOW, "--recipient-timezone", "America/New_York", "--execute"],
        )
        assert result.returncode == 0, result.stderr
        assert "MODE: DEMO" in result.stdout
        assert "would_block_in_live: True" in result.stdout
        assert "*** DEMO MODE: this call would be BLOCKED in live mode ***" in result.stdout
        assert "UNRESOLVED_CALL_BLOCKED" not in result.stdout
        assert "=== CALL-E ===" in result.stdout
        assert server.creates == 1
        assert "mode=demo, would_block_in_live=True" in result.stdout


def test_live_mode_illegal_hour_blocks_the_call() -> None:
    with FakeCalleServer() as server:
        result = _run_resolver(
            server.base_url,
            ["--mode", "live", "--now-utc", ILLEGAL_HOUR_NOW, "--recipient-timezone", "America/New_York", "--execute"],
        )
        assert result.returncode == 0, result.stderr
        assert "MODE: LIVE" in result.stdout
        assert "would_block_in_live: True" in result.stdout
        assert "Status: UNRESOLVED_CALL_BLOCKED" in result.stdout
        assert "Action: RETRY_WHEN_PERMITTED" in result.stdout
        assert "=== CALL-E ===" not in result.stdout
        assert server.creates == 0


def test_demo_mode_legal_hour_reaches_calle() -> None:
    with FakeCalleServer() as server:
        result = _run_resolver(
            server.base_url,
            ["--mode", "demo", "--now-utc", LEGAL_HOUR_NOW, *US_COMPLIANT_FLAGS, "--execute"],
        )
        assert result.returncode == 0, result.stderr
        assert "would_block_in_live: False" in result.stdout
        assert "DEMO MODE: this call would be BLOCKED" not in result.stdout
        assert "Status: RESOLVED" in result.stdout
        assert server.creates == 1


def test_live_mode_legal_hour_reaches_calle() -> None:
    with FakeCalleServer() as server:
        result = _run_resolver(
            server.base_url,
            ["--mode", "live", "--now-utc", LEGAL_HOUR_NOW, *US_COMPLIANT_FLAGS, "--execute"],
        )
        assert result.returncode == 0, result.stderr
        assert "would_block_in_live: False" in result.stdout
        assert "[PASS] us_federal_calling_window" in result.stdout
        assert "[PASS] us_federal_consent" in result.stdout
        assert "Status: RESOLVED" in result.stdout
        assert "Action: KEEP_SLOT" in result.stdout
        assert server.creates == 1


def test_demo_mode_allow_live_illegal_hour_places_the_call(tmp_path) -> None:
    """DEMO + --execute --allow-live + a compliance failure: the call
    still goes through (against the fake server here - --allow-live is
    inert against a non-real base_url, same as every other test in this
    project), the banner names it as a real call, and
    would_block_in_live is honestly True throughout.

    No --now-utc anywhere in this test (refused together with
    --allow-live) - R1-R4 trigger via a throwaway case file with a
    deadline relative to real wall-clock time (see
    _write_near_deadline_case), and the compliance failure is a missing
    --recipient-timezone (deterministic regardless of real time of
    day), standing in for "an illegal hour" - either one produces
    decision.allowed=False, which is all this test needs.
    """
    with FakeCalleServer() as server:
        result = _run_resolver(
            server.base_url,
            ["--mode", "demo", "--execute", "--allow-live"],
            case_path=_write_near_deadline_case(tmp_path),
        )
        assert result.returncode == 0, result.stderr
        assert "would_block_in_live: True" in result.stdout
        assert "A REAL CALL-E call is about to be placed despite this." in result.stdout
        assert "UNRESOLVED_CALL_BLOCKED" not in result.stdout
        assert "Created call" in result.stdout
        assert server.creates == 1


def test_allow_live_without_execute_places_no_call(tmp_path) -> None:
    """--allow-live alone (no --execute) must never send anything - in
    demo mode, that means reaching the CALL-E preview and stopping
    right before it, regardless of whether compliance would have
    allowed the call (--recipient-timezone is deliberately omitted
    here; demo mode proceeds past that anyway, so this still reaches
    the meaningful "would send, but --execute is absent" stage without
    needing --now-utc, refused together with --allow-live).
    """
    with FakeCalleServer() as server:
        result = _run_resolver(
            server.base_url,
            ["--allow-live"],
            case_path=_write_near_deadline_case(tmp_path),
        )
        assert result.returncode == 0, result.stderr
        assert "Created call" not in result.stdout
        assert "Dry-run: call is justified and permitted." in result.stdout
        assert server.creates == 0


def test_execute_without_allow_live_against_real_base_url_is_blocked() -> None:
    """No --base-url override here: this targets the real default
    (REAL_API_BASE_URL). client.py's own CallEClient.__post_init__
    (untouched) refuses to construct a client against it without
    --allow-live, regardless of --mode - no network request is ever
    attempted.
    """
    env = dict(os.environ)
    env.pop("CALLE_API_KEY", None)
    result = subprocess.run(
        [sys.executable, str(HERE / "resolver.py"), CASE, "--now-utc", LEGAL_HOUR_NOW, *US_COMPLIANT_FLAGS, "--execute"],
        capture_output=True,
        text=True,
        env=env,
        timeout=30,
    )
    assert result.returncode != 0
    assert "LiveCallBlockedError" in result.stderr


def test_demo_mode_still_shows_every_compliance_check_result() -> None:
    """Demo mode must never hide a failing check - only its enforcement
    changes, never its visibility.
    """
    with FakeCalleServer() as server:
        result = _run_resolver(
            server.base_url,
            ["--mode", "demo", "--now-utc", LEGAL_HOUR_NOW, "--recipient-timezone", "America/New_York", "--execute"],
        )
        assert result.returncode == 0, result.stderr
        assert "[FAIL] us_federal_consent" in result.stdout
        assert "[FAIL] us_federal_dnc_scrub" in result.stdout
        assert "[PASS] us_federal_calling_window" in result.stdout
        assert "would_block_in_live: True" in result.stdout


def test_dry_run_never_calls_regardless_of_mode() -> None:
    with FakeCalleServer() as server:
        result = _run_resolver(
            server.base_url,
            ["--mode", "demo", "--now-utc", ILLEGAL_HOUR_NOW, "--recipient-timezone", "America/New_York"],
        )
        assert result.returncode == 0, result.stderr
        assert "Created call" not in result.stdout
        assert server.creates == 0


def test_now_utc_with_allow_live_is_refused() -> None:
    with FakeCalleServer() as server:
        result = _run_resolver(
            server.base_url, ["--mode", "live", "--allow-live", "--now-utc", LEGAL_HOUR_NOW, *US_COMPLIANT_FLAGS]
        )
        assert result.returncode == 1
        assert "cannot be combined with --allow-live" in result.stderr
        assert server.creates == 0
