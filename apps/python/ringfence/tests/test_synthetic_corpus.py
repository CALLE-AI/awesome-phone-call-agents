"""Exercises the exhaustive synthetic corpus (ringfence/synthetic_corpus.py)
that backs the README's "Exhaustive signal-space coverage" section.

`oracle_disposition()` is a second, independently written implementation of
decide.py's table -- these tests check decide() agrees with it, not that
decide() agrees with itself.
"""

from ringfence import decide as decide_mod
from ringfence import resolve
from ringfence.evaluation import evaluate_naive_vs_resolve, evaluate_synthetic_corpus
from ringfence.synthetic_corpus import SIGNAL_KEYS, generate_corpus, oracle_disposition


def test_corpus_exhaustively_covers_all_32_signal_combinations_for_both_conversation_outcomes():
    records = generate_corpus()
    success = [r for r in records if r["case"]["case_id"].startswith("gen_success_")]
    declined = [r for r in records if r["case"]["case_id"].startswith("gen_declined_")]
    assert len(success) == 32
    assert len(declined) == 32

    success_combos = {tuple(r["signals"][k] for k in SIGNAL_KEYS) for r in success}
    declined_combos = {tuple(r["signals"][k] for k in SIGNAL_KEYS) for r in declined}
    assert len(success_combos) == 32
    assert len(declined_combos) == 32


def test_corpus_covers_every_documented_ambiguity_marker():
    records = generate_corpus()

    def outcome_of(record):
        return resolve.classify(record["call"], record["attempts"], record["events"]).outcome

    policy_hits = [r for r in records if outcome_of(r) == resolve.POLICY_OR_CONTENT_REFUSAL]
    malformed_hits = [r for r in records if outcome_of(r) == resolve.MALFORMED_OR_UNSUPPORTED_DESTINATION]
    assert len(policy_hits) == len(resolve._POLICY_REFUSAL_MARKERS)
    assert len(malformed_hits) == len(resolve._MALFORMED_DESTINATION_MARKERS)


def test_every_generated_case_actually_resolves_to_its_intended_real_outcome():
    # Guards against a generator bug where a case's raw call/attempts/events
    # don't actually classify() the way its label and expected_disposition
    # assume -- i.e. that the synthetic data is honest, not just labeled.
    expected_outcomes = {
        "gen_success": resolve.ANSWERED_SUCCESS,
        "gen_declined": resolve.ANSWERED_DECLINED,
        f"gen_{resolve.POLICY_OR_CONTENT_REFUSAL}": resolve.POLICY_OR_CONTENT_REFUSAL,
        f"gen_{resolve.MALFORMED_OR_UNSUPPORTED_DESTINATION}": resolve.MALFORMED_OR_UNSUPPORTED_DESTINATION,
        f"gen_{resolve.REJECTED_BEFORE_RING}": resolve.REJECTED_BEFORE_RING,
        f"gen_{resolve.NO_ANSWER_CONFIRMED}": resolve.NO_ANSWER_CONFIRMED,
        f"gen_{resolve.UNRESOLVED_AMBIGUOUS}": resolve.UNRESOLVED_AMBIGUOUS,
        "gen_connfail": resolve.CONNECTION_FAILED_DURING_ATTEMPT,
    }
    mismatches = []
    for record in generate_corpus():
        case_id = record["case"]["case_id"]
        if case_id.startswith("gen_naive_trap_"):
            continue  # deliberately checks a call/attempt *mismatch*, not a single target outcome
        prefix = next(p for p in expected_outcomes if case_id.startswith(p))
        actual = resolve.classify(record["call"], record["attempts"], record["events"]).outcome
        if actual != expected_outcomes[prefix]:
            mismatches.append((case_id, expected_outcomes[prefix], actual))
    assert not mismatches, mismatches


def test_oracle_matches_decide_on_every_generated_case():
    mismatches = []
    for record in generate_corpus():
        resolution = resolve.classify(record["call"], record["attempts"], record["events"])
        actual = decide_mod.decide(resolution, record["signals"]).disposition
        expected = oracle_disposition(resolution.outcome, record["signals"])
        if actual != expected:
            mismatches.append((record["case"]["case_id"], expected, actual))
    assert not mismatches, mismatches


def test_oracle_spot_checks_without_calling_decide_at_all():
    clean = {k: False for k in SIGNAL_KEYS}
    clean["relationship_explained"] = True
    assert oracle_disposition(resolve.ANSWERED_SUCCESS, clean) == "ADVISE_ALLOW"

    secrecy = dict(clean)
    secrecy["secrecy_demand_present"] = True
    assert oracle_disposition(resolve.ANSWERED_SUCCESS, secrecy) == "ADVISE_BLOCK"

    assert oracle_disposition(resolve.NO_ANSWER_CONFIRMED, {}) == "ESCALATE_TO_HUMAN"
    assert oracle_disposition(resolve.UNRESOLVED_AMBIGUOUS, {}) == "ESCALATE_TO_HUMAN"


def test_evaluate_synthetic_corpus_reports_full_agreement_with_the_oracle():
    result = evaluate_synthetic_corpus()
    assert result.total >= 90
    assert result.correct == result.total, result.mismatches


def test_naive_vs_resolve_comparison_finds_real_unsafe_disagreements():
    # A comparison that never finds a disagreement would be vacuous --
    # this proves resolve.classify() is doing real work naive_classify() misses.
    result = evaluate_naive_vs_resolve()
    assert result.total >= 90
    assert result.outcome_disagreements > 0
    assert result.unsafe_disposition_disagreements > 0
    assert any("naive_trap" in example for example in result.examples)


def test_naive_trap_cases_would_wrongly_allow_under_naive_classification():
    # decide() itself must still escalate these -- the trap is only in what
    # naive_classify() + decide() would have done, never in the real path.
    for record in generate_corpus():
        if "naive_trap" not in record["case"]["case_id"]:
            continue
        real_resolution = resolve.classify(record["call"], record["attempts"], record["events"])
        assert decide_mod.decide(real_resolution, record["signals"]).disposition == "ESCALATE_TO_HUMAN"

        naive_outcome = resolve.naive_classify(record["call"])
        assert naive_outcome == resolve.ANSWERED_SUCCESS
        naive_disposition = decide_mod.decide(
            resolve.Resolution(outcome=naive_outcome, confidence="n/a"), record["signals"]
        ).disposition
        assert naive_disposition == "ADVISE_ALLOW"
