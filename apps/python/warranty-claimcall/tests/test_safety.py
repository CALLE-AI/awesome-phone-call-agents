"""The safety gate, exercised through the CLI's own entry points."""

from __future__ import annotations

import pytest
from claimcall import manifest as manifest_mod
from claimcall import safety
from claimcall_core import hash_phone
from claimpilot_contracts import SafetyDecision

from .conftest import load_claim

DEMO_NUMBER = "+15005550006"


def build(name="eligible-claim.json", **overrides):  # noqa: ANN001, ANN201
    source = load_claim(name)
    for key, value in overrides.items():
        setattr(source, key, value)
    return manifest_mod.build(source)


def test_the_bundled_example_passes():
    report = safety.evaluate(build())
    assert report.decision is SafetyDecision.PASS, [f.message for f in report.findings]


def test_injected_instructions_in_a_claim_file_are_rejected():
    report = safety.evaluate(build("unsafe-claim.json"))
    assert report.decision is SafetyDecision.REJECT
    codes = {f.code for f in report.findings}
    assert any(c.startswith(("injection.", "secret.")) for c in codes)


def test_a_nonzero_fee_is_held_for_a_human():
    report = safety.evaluate(build(max_fee=500.0))
    assert report.decision is SafetyDecision.HOLD
    assert any(f.code == "fee.preauthorized" for f in report.findings)


def test_live_mode_requires_the_destination_on_the_allowlist():
    manifest = build()
    denied = safety.evaluate(manifest, allowed_phone_hashes=set(), require_allowlist=True)
    assert denied.decision is SafetyDecision.REJECT

    allowed = safety.evaluate(
        manifest, allowed_phone_hashes={hash_phone(DEMO_NUMBER)}, require_allowlist=True
    )
    assert allowed.decision is SafetyDecision.PASS


@pytest.mark.parametrize("number", ["+91112", "+911800114000"])
def test_emergency_and_helpline_numbers_are_never_dialled(number):
    source = load_claim("eligible-claim.json")
    source.recipient.phone_e164 = number
    report = safety.evaluate(manifest_mod.build(source))
    assert report.decision is SafetyDecision.REJECT
    assert any(f.code == "destination.blocked" for f in report.findings)


def test_the_report_renders_for_a_terminal():
    text = safety.render_report(safety.evaluate(build("unsafe-claim.json")))
    assert "REJECT" in text
