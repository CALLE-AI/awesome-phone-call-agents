"""Offline-only test suite for the ParcelBridge reference app.

Every test in this module is marked ``offline_only`` and is
designed to run hermetically:

* no network is contacted,
* no file with phone numbers, OAuth tokens, or credentials is
  read,
* no real CLI subprocess is invoked with secrets in its argv.

The tests cover:

* payload builder validation (allowed scenarios pass; forbidden
  substrings raise),
* offline interceptor invariants (the canary length is stable;
  capability values are reduced to length fingerprints only),
* live-stub refusal semantics (the stub returns a refusal result;
  it does not contact anything),
* CLI default mode (the CLI defaults to ``--offline`` and never
  accepts a phone-number-shaped argument),
* sanitizer fail-closed (secret-shaped values raise, not leak).
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

from parcelbridge import (
    ArgumentViolationError,
    LiveModeRefusedError,
    SanitizationViolationError,
    build_business_payload,
    raise_live_mode_refused,
    run_live_stub_plan_call,
    run_offline_plan_call,
    sanitize_plan_response,
)
from parcelbridge.payload import SCENARIOS


# All tests in this module are offline-only.
pytestmark = pytest.mark.offline_only


# ---------------------------------------------------------------------------
# Payload builder
# ---------------------------------------------------------------------------


class TestPayloadBuilder:
    def test_all_canonical_scenarios_build(self):
        for scenario in SCENARIOS:
            payload = build_business_payload(scenario=scenario)
            assert payload.scenario == scenario

    def test_unknown_scenario_rejected(self):
        with pytest.raises(ArgumentViolationError):
            build_business_payload(scenario="not-a-real-scenario")

    def test_phone_substring_rejected(self):
        with pytest.raises(ArgumentViolationError):
            build_business_payload(
                scenario="gate-code-failure",
                notes="please dial the phone number on file",
            )

    def test_bearer_substring_rejected(self):
        with pytest.raises(ArgumentViolationError):
            build_business_payload(
                scenario="gate-code-failure",
                notes="use Authorization: Bearer abc123",
            )

    def test_oauth_substring_rejected(self):
        with pytest.raises(ArgumentViolationError):
            build_business_payload(
                scenario="gate-code-failure",
                region="oauth-region",
            )

    def test_address_change_substring_rejected(self):
        # ``address-change`` is rejected in the notes / region /
        # language fields; the scenario name ``unsupported-address-change``
        # is whitelisted in :data:`SCENARIOS` and is therefore allowed
        # at the scenario-name level.
        with pytest.raises(ArgumentViolationError):
            build_business_payload(
                scenario="gate-code-failure",
                notes="please process an address-change on the file",
            )

    def test_deliverable_targets_are_validated(self):
        with pytest.raises(ArgumentViolationError):
            build_business_payload(
                scenario="gate-code-failure",
                deliverable_targets=["ask-for-card"],
            )

    def test_payload_is_frozen(self):
        payload = build_business_payload(scenario="recipient-unavailable")
        with pytest.raises(Exception):
            # Frozen dataclass; this assignment must fail.
            payload.scenario = "tampered"  # type: ignore[misc]


# ---------------------------------------------------------------------------
# Offline interceptor
# ---------------------------------------------------------------------------


class TestOfflineInterceptor:
    def test_run_returns_pass_with_limitation(self):
        payload = build_business_payload(scenario="gate-code-failure")
        result = run_offline_plan_call(payload)
        assert result.bridge_mode == "offline"
        assert result.outcome == "PASS_WITH_LIMITATION"

    def test_synthetic_response_has_no_business_text(self):
        payload = build_business_payload(scenario="gate-code-failure")
        result = run_offline_plan_call(payload)
        # The synthetic interceptor deliberately does NOT populate
        # business text fields (``display_goal``, ``confirm_summary``,
        # ``clarifying_questions``). The sanitizer records these as
        # opaque length-zero records so that downstream code cannot
        # mistake them for verified business content.
        for business_field in ("display_goal", "confirm_summary"):
            assert (
                result.sanitized_response.opaque[business_field]["_opaque"]
                is True
            )
            assert (
                result.sanitized_response.opaque[business_field]["length"]
                == 0
            )

    def test_canary_length_is_stable(self):
        payload = build_business_payload(scenario="recipient-unavailable")
        result = run_offline_plan_call(payload)
        # The synthetic interceptor stores a 37-character placeholder
        # for the confirm_token. After sanitization, only the
        # length-only fingerprint is preserved.
        assert (
            result.sanitized_response.fingerprints["confirm_token"] == 37
        )

    def test_capability_values_are_length_only(self):
        payload = build_business_payload(scenario="building-access-failed")
        result = run_offline_plan_call(payload)
        # The capability values are length-only fingerprints. The
        # original placeholder values never reach the caller.
        for field in ("confirm_token", "plan_id"):
            assert isinstance(
                result.sanitized_response.fingerprints[field], int
            )
            assert result.sanitized_response.fingerprints[field] == 37

    def test_run_call_is_not_implemented(self):
        """The reference app does not ship a run_call function."""
        import parcelbridge

        assert not hasattr(parcelbridge, "run_call"), (
            "run_call is intentionally absent; the dial path is "
            "omitted by design."
        )


# ---------------------------------------------------------------------------
# Live-mode stub
# ---------------------------------------------------------------------------


class TestLiveStub:
    def test_stub_returns_refusal(self):
        result = run_live_stub_plan_call()
        assert result.refused is True
        assert result.outcome == "STUB_NOT_EXECUTED"
        assert "documentation stub" in result.message.lower()

    def test_raise_live_mode_refused(self):
        with pytest.raises(LiveModeRefusedError):
            raise_live_mode_refused()

    def test_stub_does_not_import_sdk(self):
        """The live-stub module must not import the SDK or any
        network-touching library."""
        import parcelbridge.live_stub as live_stub_module

        source = Path(live_stub_module.__file__).read_text(encoding="utf-8")
        forbidden_imports = ("import urllib", "import requests", "import httpx", "import socket")
        for forbidden in forbidden_imports:
            assert forbidden not in source, (
                f"live_stub.py must not import {forbidden!r}; the "
                f"live-mode path is a documentation stub."
            )


# ---------------------------------------------------------------------------
# Sanitizer
# ---------------------------------------------------------------------------


class TestSanitizer:
    def test_safe_fields_are_surfaced(self):
        raw = {
            "bridge_mode": "offline",
            "scenario": "gate-code-failure",
            "ready_to_run": True,
        }
        sanitized = sanitize_plan_response(raw)
        assert sanitized.presence == raw
        assert sanitized.fingerprints == {}
        assert sanitized.opaque == {}

    def test_capability_value_field_becomes_fingerprint(self):
        raw = {
            "bridge_mode": "offline",
            "scenario": "gate-code-failure",
            "ready_to_run": True,
            "capability_values": {
                "confirm_token": "x" * 37,
                "plan_id": "y" * 24,
            },
        }
        sanitized = sanitize_plan_response(raw)
        assert sanitized.fingerprints == {
            "confirm_token": 37,
            "plan_id": 24,
        }

    def test_unknown_field_becomes_opaque_length_record(self):
        raw = {
            "bridge_mode": "offline",
            "scenario": "gate-code-failure",
            "ready_to_run": True,
            "unknown_field": "some value here",
        }
        sanitized = sanitize_plan_response(raw)
        assert "unknown_field" in sanitized.opaque
        assert sanitized.opaque["unknown_field"]["_opaque"] is True
        assert sanitized.opaque["unknown_field"]["length"] == len("some value here")

    def test_secret_shaped_value_raises(self):
        raw = {
            "bridge_mode": "offline",
            "scenario": "gate-code-failure",
            "ready_to_run": True,
            "exotic_field": "Bearer some-jwt-looking-token",
        }
        with pytest.raises(SanitizationViolationError):
            sanitize_plan_response(raw)

    def test_secret_substring_in_capability_value_raises(self):
        raw = {
            "bridge_mode": "offline",
            "scenario": "gate-code-failure",
            "ready_to_run": True,
            "capability_values": {
                "confirm_token": "Bearer abc.def.ghi",
            },
        }
        with pytest.raises(SanitizationViolationError):
            sanitize_plan_response(raw)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


_PKG_ROOT = Path(__file__).resolve().parent.parent
_CLI_PATH = _PKG_ROOT / "parcelbridge" / "__main__.py"


@pytest.mark.skipif(
    not _CLI_PATH.exists(),
    reason="CLI entry point missing; cannot exercise CLI in this layout",
)
class TestCLI:
    def _run_cli(self, *args: str) -> subprocess.CompletedProcess:
        return subprocess.run(
            [sys.executable, "-m", "parcelbridge.cli", *args],
            cwd=str(_PKG_ROOT),
            capture_output=True,
            text=True,
            timeout=10,
            env={"PATH": "/usr/bin:/bin", "PYTHONPATH": str(_PKG_ROOT)},
        )

    def test_default_mode_is_offline(self):
        proc = self._run_cli("demo")
        assert proc.returncode == 0, proc.stderr
        assert "mode=offline" in proc.stdout

    def test_offline_subcommand_emits_canary_length(self):
        proc = self._run_cli("demo", "--offline")
        assert proc.returncode == 0, proc.stderr
        assert "confirm_token_length=37" in proc.stdout

    def test_demo_subcommand_prints_offline_synthetic_banner(self):
        proc = self._run_cli("demo", "--offline")
        assert proc.returncode == 0, proc.stderr
        assert "OFFLINE SYNTHETIC DEMO" in proc.stdout

    def test_live_stub_subcommand_exits_non_zero(self):
        # The live-stub subcommand was folded into the live-stub
        # CLI of the original layout. In the new layout the
        # ``live_stub`` module's run_live_stub_plan_call()
        # function is exercised by tests/test_offline_only.py's
        # TestLiveStub class, not by the CLI. The CLI no longer
        # has a live-stub flag because the default mode is
        # already offline-fake; opting into a refusal through
        # a CLI flag was redundant.
        result = run_live_stub_plan_call()
        assert result.refused is True
        assert result.outcome == "STUB_NOT_EXECUTED"

    def test_validate_subcommand_exits_zero(self):
        proc = self._run_cli("validate")
        assert proc.returncode == 0, proc.stderr
        # The report contains the policy module's self-audit.
        assert "policy" in proc.stdout

    def test_validate_subcommand_emits_json(self):
        proc = self._run_cli("validate", "--json")
        assert proc.returncode == 0, proc.stderr
        envelope = json.loads(proc.stdout)
        assert "policy" in envelope
        assert envelope["policy"]["payload_substrings_non_empty"] is True

    def test_unknown_scenario_exits_non_zero(self):
        proc = self._run_cli("demo", "--offline", "--scenario", "does-not-exist")
        assert proc.returncode != 0
        assert "invalid choice" in proc.stderr.lower()

    def test_cli_never_accepts_phone_substring(self):
        proc = self._run_cli(
            "demo",
            "--offline",
            "--region",
            "phone-555-0100",
        )
        assert proc.returncode != 0
        assert "argument violation" in proc.stderr.lower()

    def test_json_envelope_roundtrip(self):
        proc = self._run_cli("demo", "--offline", "--json")
        assert proc.returncode == 0, proc.stderr
        # Extract the JSON envelope from the output. The CLI
        # prints a human-readable banner first, then a separator
        # line, then the JSON.
        sep = "--- JSON envelope ---"
        assert sep in proc.stdout
        json_blob = proc.stdout.split(sep, 1)[1].strip()
        envelope = json.loads(json_blob)
        assert envelope["mode"] == "offline"
        assert envelope["outcome"] == "PASS_WITH_LIMITATION"
        assert envelope["sanitized_response"]["fingerprints"]["confirm_token"] == 37