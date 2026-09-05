"""End-to-end tests for resolver.py against fake_server.py only.

Same subprocess-driven pattern as test_e2e.py's _run_cli - no test here
ever targets api.heycall-e.com. Covers all 5 verdict branches: two that
never reach CALL-E at all (NO_CALL_NEEDED, UNRESOLVED_CALL_BLOCKED) and
three that do (RESOLVED, RESOLVED_ALT, UNRESOLVED_AMBIGUOUS), selected
via fake_server.py's reserved phone numbers.
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

from fake_server import PATIENT_CANCELLED_PHONE, PATIENT_VOICEMAIL_PHONE, FakeCalleServer

HERE = Path(__file__).resolve().parent.parent
CASE = str(HERE / "cases" / "ghost-appointment.json")

# 2026-09-10T20:00:00Z is 16:00 local New York time (EDT, UTC-4) - within
# the 8:00-21:00 US federal calling window - and 18 hours before the case
# fixture's 2026-09-11T14:00:00Z deadline (24h threshold), so R4 triggers.
NEAR_DEADLINE_NOW = "2026-09-10T20:00:00Z"
FAR_FROM_DEADLINE_NOW = "2026-09-01T10:00:00Z"

US_COMPLIANT_FLAGS = [
    "--consent-obtained",
    "--consent-timestamp",
    "2026-08-20T12:00:00Z",
    "--dnc-checked",
    "--recipient-timezone",
    "America/New_York",
]


def _run_resolver(server_base_url: str, extra_args: list[str]) -> subprocess.CompletedProcess[str]:
    env = dict(os.environ)
    env.pop("CALLE_API_KEY", None)
    return subprocess.run(
        [sys.executable, str(HERE / "resolver.py"), CASE, "--base-url", server_base_url, "--poll-interval-seconds", "0.01", *extra_args],
        capture_output=True,
        text=True,
        env=env,
        timeout=30,
    )


def test_far_from_deadline_is_no_call_needed_and_never_reaches_compliance_or_calle() -> None:
    with FakeCalleServer() as server:
        result = _run_resolver(server.base_url, ["--now-utc", FAR_FROM_DEADLINE_NOW])

        assert result.returncode == 0, result.stderr
        assert "Status: NO_CALL_NEEDED" in result.stdout
        assert "Action: NO_ACTION_REQUIRED" in result.stdout
        assert "=== CALL PERMISSION ===" not in result.stdout
        assert "=== CALL-E ===" not in result.stdout
        assert server.creates == 0


def test_near_deadline_without_consent_is_blocked_with_a_next_window() -> None:
    """--mode live is required here: this test exercises the fully
    enforced/fail-closed path (see tests/test_resolver_mode.py for the
    default demo-mode behavior, which does not stop on this same input).
    """
    with FakeCalleServer() as server:
        result = _run_resolver(
            server.base_url,
            ["--mode", "live", "--now-utc", NEAR_DEADLINE_NOW, "--recipient-timezone", "America/New_York"],
        )

        assert result.returncode == 0, result.stderr
        assert "R1-R4 all triggered" in result.stdout
        assert "Status: UNRESOLVED_CALL_BLOCKED" in result.stdout
        assert "Action: RETRY_WHEN_PERMITTED" in result.stdout
        assert "non-time-based reason" in result.stdout  # consent/DNC are not time-based
        assert server.creates == 0


def test_dry_run_permitted_previews_the_calle_request_without_sending_it() -> None:
    with FakeCalleServer() as server:
        result = _run_resolver(server.base_url, ["--now-utc", NEAR_DEADLINE_NOW, *US_COMPLIANT_FLAGS])

        assert result.returncode == 0, result.stderr
        assert "=== CALL-E ===" in result.stdout
        assert '"patient_intent"' in result.stdout
        assert "Dry-run: call is justified and permitted." in result.stdout
        assert "=== VERDICT ===" not in result.stdout  # no structured_result to reconcile yet
        assert server.creates == 0


def test_execute_confirmed_by_human_resolves_to_keep_slot() -> None:
    with FakeCalleServer() as server:
        result = _run_resolver(server.base_url, ["--now-utc", NEAR_DEADLINE_NOW, "--execute", *US_COMPLIANT_FLAGS])

        assert result.returncode == 0, result.stderr
        assert "Status: RESOLVED" in result.stdout
        assert "Action: KEEP_SLOT" in result.stdout
        assert server.creates == 1


def test_execute_cancelled_by_human_resolves_to_release_slot() -> None:
    with FakeCalleServer() as server:
        result = _run_resolver(
            server.base_url,
            ["--phone", PATIENT_CANCELLED_PHONE, "--now-utc", NEAR_DEADLINE_NOW, "--execute", *US_COMPLIANT_FLAGS],
        )

        assert result.returncode == 0, result.stderr
        assert "Status: RESOLVED_ALT" in result.stdout
        assert "Action: RELEASE_SLOT" in result.stdout


def test_execute_voicemail_is_unresolved_ambiguous_never_release_slot() -> None:
    """The absolute rule end to end: reaching voicemail instead of the
    patient must never resolve to RELEASE_SLOT (the cancelled action) -
    only HUMAN_REVIEW.
    """
    with FakeCalleServer() as server:
        result = _run_resolver(
            server.base_url,
            ["--phone", PATIENT_VOICEMAIL_PHONE, "--now-utc", NEAR_DEADLINE_NOW, "--execute", *US_COMPLIANT_FLAGS],
        )

        assert result.returncode == 0, result.stderr
        assert "Status: UNRESOLVED_AMBIGUOUS" in result.stdout
        assert "Action: HUMAN_REVIEW" in result.stdout
        assert "RELEASE_SLOT" not in result.stdout
