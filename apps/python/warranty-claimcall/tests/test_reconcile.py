"""Verification: a structured result is a claim about a call, not the call."""

from __future__ import annotations

import json

from claimcall import manifest as manifest_mod
from claimcall import reconcile
from claimpilot_contracts import VerificationVerdict

from .conftest import FIXTURES, load_claim


def _check(result_file: str):  # noqa: ANN202
    m = manifest_mod.build(load_claim("eligible-claim.json"))
    raw = json.loads((FIXTURES / result_file).read_text())
    return reconcile.check_payload(m, raw)


def test_a_supported_reference_verifies():
    record, outcome = _check("claim-registered.json")
    assert outcome.verdict is VerificationVerdict.VERIFIED
    assert record.result.claim_reference == "AUR-SVC-2026-44810"


def test_a_reference_nobody_said_is_not_verified():
    _, outcome = _check("fabricated-reference.json")
    assert outcome.verdict is VerificationVerdict.NEEDS_HUMAN
    assert "claim_reference" in outcome.unsupported_fields


def test_a_fee_goes_to_a_human():
    _, outcome = _check("needs-human-result.json")
    assert outcome.verdict is VerificationVerdict.NEEDS_HUMAN
    assert outcome.authority_violations


def test_no_answer_stays_unsuccessful():
    _, outcome = _check("no-answer-result.json")
    assert outcome.verdict is VerificationVerdict.INCONCLUSIVE
    assert "claim_reference" in outcome.preserved_unknowns


def test_a_malformed_result_is_not_salvaged():
    _, outcome = _check("malformed-result.json")
    assert outcome.verdict is VerificationVerdict.NEEDS_HUMAN
    assert "result" in outcome.unsupported_fields


def test_outcomes_render_for_a_terminal():
    _, outcome = _check("needs-human-result.json")
    text = reconcile.render_outcome(outcome)
    assert "NEEDS_HUMAN" in text
    assert "Outside granted authority" in text
