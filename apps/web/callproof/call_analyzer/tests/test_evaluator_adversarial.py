"""Regression probes for claims that previously auto-verified unsafe calls."""
from __future__ import annotations

import pytest

from call_analyzer.evaluator import DeterministicEvaluator

from test_evaluator import DATE_STATEMENT, canonical_turns, request_with


def assert_not_auto_verified(turns, provider_result, **kwargs):
    verdict = DeterministicEvaluator().evaluate(
        request_with(turns=turns, provider_result=provider_result, **kwargs)
    )
    assert verdict.needs_human_review is True
    assert not (verdict.goal_completion == "complete" and verdict.policy_evaluation == "compliant")
    assert verdict.result_confidence < 0.75
    return verdict


@pytest.mark.parametrize("question", [
    "Has the delivery remained unchanged?",
    "Should I cancel the delivery instead of moving it?",
    "Can you confirm the delivery has not changed?",
    "Is the delivery hypothetical?",
])
def test_bare_yes_to_an_arbitrary_agent_question_never_proves_the_claim(question):
    turns = canonical_turns()
    turns[1] = {"speaker": "agent", "text": question}
    assert_not_auto_verified(
        turns,
        {"delivery_date": "2026-08-07", "surcharge_cents": 12000},
    )


@pytest.mark.parametrize("answer", [
    "Yes, the delivery is unchanged.",
    "I doubt the delivery date is correct.",
    "I dispute that the delivery date is correct.",
    "Correct, assuming it actually happens.",
    "Yes, but only if you cancel the delivery.",
    "Sí, pero la entrega no cambia.",
])
def test_language_outside_the_finite_response_set_never_opens_the_gate(answer):
    turns = canonical_turns()
    turns[2] = {"speaker": "recipient", "text": answer}
    assert_not_auto_verified(
        turns,
        {"delivery_date": "2026-08-07", "surcharge_cents": 12000},
    )


def test_recipient_rejecting_the_exact_statement_is_a_contradiction():
    turns = canonical_turns()
    turns[2] = {"speaker": "recipient", "text": "No."}
    verdict = assert_not_auto_verified(
        turns,
        {"delivery_date": "2026-08-07", "surcharge_cents": 12000},
    )
    claim = next(item for item in verdict.claim_results if item.kind == "success")
    assert claim.status == "contradicted"


def test_conflicting_yes_then_no_is_never_reduced_to_yes():
    turns = canonical_turns()
    turns.extend([
        {"speaker": "agent", "text": DATE_STATEMENT},
        {"speaker": "recipient", "text": "No."},
    ])
    verdict = assert_not_auto_verified(
        turns,
        {"delivery_date": "2026-08-07", "surcharge_cents": 12000},
    )
    claim = next(item for item in verdict.claim_results if item.kind == "success")
    assert claim.status == "contradicted"


def test_zero_does_not_match_as_a_substring_of_five_hundred():
    turns = canonical_turns(amount="$0.00")
    turns.insert(3, {"speaker": "recipient", "text": "The actual surcharge is $500.00."})
    verdict = assert_not_auto_verified(
        turns,
        {"delivery_date": "2026-08-07", "surcharge_cents": 0},
    )
    claim = next(item for item in verdict.claim_results if item.kind == "commitment_limit")
    assert claim.status == "contradicted"


def test_paraphrased_forbidden_promise_cannot_be_declared_absent():
    turns = canonical_turns()
    turns.insert(1, {"speaker": "agent", "text": "I will give all your money back."})
    verdict = assert_not_auto_verified(
        turns,
        {"delivery_date": "2026-08-07", "surcharge_cents": 12000},
        forbidden=True,
    )
    claim = next(item for item in verdict.claim_results if item.kind == "forbidden_commitment")
    assert claim.status == "unevaluated"
