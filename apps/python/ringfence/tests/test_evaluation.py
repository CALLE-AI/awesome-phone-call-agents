"""Regenerates the README's measured-evaluation numbers — never hand-typed.

Also checks every fixture's own `expected_disposition` against what
decide() actually returns, so a fixture author cannot silently mislabel a
case (the same discipline calltruth's test_resolve.py applies per-fixture).
"""

import json
from pathlib import Path

from ringfence import decide as decide_mod
from ringfence import resolve
from ringfence.evaluation import evaluate_fixture_corpus

FIXTURES_DIR = Path(__file__).resolve().parent.parent / "fixtures"


def test_every_fixture_matches_its_own_expected_disposition():
    mismatches = []
    for path in sorted(FIXTURES_DIR.glob("*.json")):
        record = json.loads(path.read_text(encoding="utf-8"))
        resolution = resolve.classify(
            record["call"], record.get("attempts", []), record.get("events", [])
        )
        disposition = decide_mod.decide(resolution, record.get("signals", {}))
        expected = record.get("expected_disposition")
        if expected and disposition.disposition != expected:
            mismatches.append(
                f"{path.name}: expected {expected}, got {disposition.disposition} ({disposition.reasons})"
            )
    assert not mismatches, "\n".join(mismatches)


def test_scam_pattern_fixtures_never_resolve_to_allow():
    result = evaluate_fixture_corpus(FIXTURES_DIR)
    assert result.scam_pattern_total > 0
    assert result.scam_pattern_correct == result.scam_pattern_total, result.mismatches


def test_clean_legitimate_fixtures_are_not_over_triggered_into_a_false_block():
    result = evaluate_fixture_corpus(FIXTURES_DIR)
    assert result.clean_legitimate_total > 0
    assert result.clean_legitimate_correct == result.clean_legitimate_total, result.mismatches
