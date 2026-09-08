"""End-to-end tests for resolver.py against fake_server.py only.

Subprocess-driven: no test here ever targets api.heycall-e.com. Covers
all 5 verdict branches: two that
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


def test_near_deadline_with_no_commercial_compliance_flags_still_reaches_calle() -> None:
    """The shipped case's use_case is appointment_confirmation: calling-
    window, consent, DNC-scrub, and solicitation-cap checks (all scoped
    to commercial solicitation in their source statutes) are exempted
    for this use case, so a real call proceeds even with none of the
    commercial compliance flags supplied at all - not because compliance
    is bypassed, but because those specific rules do not apply to this
    use case. Disclosure and revocation, which do stay applicable, both
    pass trivially here (a static disclosure script, no revocation
    requested) - see test_unmapped_jurisdiction_still_blocks below for
    proof the hard gate still has teeth for a check that does apply.
    """
    with FakeCalleServer() as server:
        result = _run_resolver(server.base_url, ["--now-utc", NEAR_DEADLINE_NOW, "--execute"])

        assert result.returncode == 0, result.stderr
        assert "[FAIL] us_federal_calling_window" in result.stdout or "[FAIL] us_federal_consent" in result.stdout
        assert "Not applicable to use case 'appointment_confirmation'" in result.stdout
        assert "Compliance gate (applicable to 'appointment_confirmation'): allowed=True" in result.stdout
        assert "Status: RESOLVED" in result.stdout
        assert "Action: KEEP_SLOT" in result.stdout
        assert server.creates == 1


def test_unmapped_jurisdiction_still_blocks_regardless_of_use_case() -> None:
    """jurisdiction_resolved is never exempted for any use case - an
    unmapped phone number still hard-blocks, proving the use-case filter
    narrows which rules apply but never turns the gate off entirely.
    """
    with FakeCalleServer() as server:
        result = _run_resolver(
            server.base_url,
            # Ofcom's reserved drama range 020 7946 0xxx - a +44 number so
            # it resolves to no jurisdiction chain at all (only +1 and +33
            # are mapped), which is exactly what this test needs.
            ["--phone", "+442079460123", "--now-utc", NEAR_DEADLINE_NOW],
        )

        assert result.returncode == 0, result.stderr
        assert "R1-R4 all triggered" in result.stdout
        assert "Status: UNRESOLVED_CALL_BLOCKED" in result.stdout
        assert "Action: RETRY_WHEN_PERMITTED" in result.stdout
        assert "no jurisdiction mapped" in result.stdout
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


# --- P4: exact-destination authorization ------------------------------
#
# --allow-live declares "a real call is authorized"; --authorize-destination
# says which number it may reach. Every one of these refusals happens before
# any client is constructed, so server.creates stays 0 throughout - the fake
# server here only proves nothing was sent, never that a real call happened.

AUTHORIZED = "+12025550123"  # the shipped case's call_phone
OTHER_NUMBER = "+15035550100"  # NANP reserved, different from the case's


def test_allow_live_with_matching_authorized_destination_is_accepted() -> None:
    """Authorization satisfied: the run proceeds past the destination gate
    and stops at the dry-run boundary (no --execute), proving the gate let
    it through rather than that a real call was placed.
    """
    with FakeCalleServer() as server:
        result = _run_resolver(
            server.base_url,
            ["--allow-live", "--authorize-destination", AUTHORIZED],
        )

        assert result.returncode == 0, result.stderr
        assert "does not match" not in result.stderr
        assert "requires --authorize-destination" not in result.stderr
        assert server.creates == 0


def test_allow_live_with_different_destination_is_refused() -> None:
    with FakeCalleServer() as server:
        result = _run_resolver(
            server.base_url,
            ["--allow-live", "--authorize-destination", OTHER_NUMBER, "--execute"],
        )

        assert result.returncode == 1
        assert "does not match the call's resolved destination" in result.stderr
        assert "=== CALL-E ===" not in result.stdout
        assert server.creates == 0


def test_allow_live_without_authorize_destination_is_refused() -> None:
    with FakeCalleServer() as server:
        result = _run_resolver(server.base_url, ["--allow-live", "--execute"])

        assert result.returncode == 1
        assert "requires --authorize-destination" in result.stderr
        assert server.creates == 0


def test_phone_override_means_only_the_final_number_can_be_authorized() -> None:
    """--phone replaces the case file's call_phone, so authorizing the
    case file's original number must NOT authorize the overridden call -
    only the number actually about to be dialled counts.
    """
    with FakeCalleServer() as server:
        stale = _run_resolver(
            server.base_url,
            ["--phone", OTHER_NUMBER, "--allow-live", "--authorize-destination", AUTHORIZED, "--execute"],
        )
        assert stale.returncode == 1
        assert "does not match the call's resolved destination" in stale.stderr

        matching = _run_resolver(
            server.base_url,
            ["--phone", OTHER_NUMBER, "--allow-live", "--authorize-destination", OTHER_NUMBER],
        )
        assert matching.returncode == 0, matching.stderr
        assert "does not match" not in matching.stderr
        assert server.creates == 0


def test_fake_target_without_allow_live_needs_no_authorization() -> None:
    """No regression for the ordinary fake-server path: without
    --allow-live there is no real call to authorize, so the new flag is
    not required and the full pipeline still runs to a verdict.
    """
    with FakeCalleServer() as server:
        result = _run_resolver(server.base_url, ["--now-utc", NEAR_DEADLINE_NOW, "--execute"])

        assert result.returncode == 0, result.stderr
        assert "authorize-destination" not in result.stderr
        assert "Status: RESOLVED" in result.stdout
        assert server.creates == 1
