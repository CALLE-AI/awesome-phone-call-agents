from __future__ import annotations

from uuid import uuid4

import pytest
from pydantic import ValidationError

from call_analyzer.evaluator import DeterministicEvaluator
from call_analyzer.schemas import AnalysisRequest


DATE_STATEMENT = "Please confirm exactly: the delivery date is 2026-08-07. Answer YES or NO."
SURCHARGE_TEMPLATE = "Please confirm exactly: the surcharge is {amount}. Answer YES or NO."
DISCLOSURE = "This call is being recorded."


def request_with(*, turns, provider_result, maximum=25000, forbidden=False, disclosure=True):
    verification_claims = [
        {
            "kind": "success",
            "id": "delivery_date_confirmed",
            "result_field": "delivery_date",
            "operator": "equals",
            "expected": "2026-08-07",
        },
        {
            "kind": "commitment_limit",
            "id": "surcharge_within_limit",
            "result_field": "surcharge_cents",
            "operator": "less_than_or_equal",
            "maximum": maximum,
        },
    ]
    required_disclosures = []
    if disclosure:
        required_disclosures.append("recording_notice")
        verification_claims.append({
            "kind": "required_disclosure",
            "id": "recording_notice",
        })

    forbidden_commitments = []
    if forbidden:
        forbidden_commitments.append("product_substitution")
        verification_claims.append({
            "kind": "forbidden_commitment",
            "id": "product_substitution",
            "evaluation_mode": "semantic_only",
        })

    return AnalysisRequest.model_validate({
        "schema_version": "2.0",
        "request_id": str(uuid4()),
        "call_id": "call-123",
        "submitted_at": "2026-08-01T22:30:00Z",
        "call_contract": {
            "objective": "Move delivery to Friday",
            "protocol_language": "en",
            "success_conditions": ["delivery_date_confirmed"],
            "allowed_commitments": {"maximum_surcharge_cents": maximum},
            "required_disclosures": required_disclosures,
            "forbidden_commitments": forbidden_commitments,
            "escalation_conditions": [],
            "verification_claims": verification_claims,
        },
        "transcript": {
            "language": "en",
            "turns": [{"id": index + 1, **turn} for index, turn in enumerate(turns)],
        },
        "provider_result": provider_result,
        "callback": {"url": "https://rails.test/webhooks/call_analyzer"},
    })


def canonical_turns(amount="$120.00"):
    return [
        {"speaker": "agent", "text": DISCLOSURE},
        {"speaker": "agent", "text": DATE_STATEMENT},
        {"speaker": "recipient", "text": "Yes."},
        {"speaker": "agent", "text": SURCHARGE_TEMPLATE.format(amount=amount)},
        {"speaker": "recipient", "text": "Yes."},
    ]


def evaluate(**kwargs):
    return DeterministicEvaluator().evaluate(request_with(**kwargs))


def test_exact_protocol_auto_verifies_a_fully_proven_call():
    verdict = evaluate(
        turns=canonical_turns(),
        provider_result={"delivery_date": "2026-08-07", "surcharge_cents": 12000},
    )

    assert verdict.goal_completion == "complete"
    assert verdict.policy_evaluation == "compliant"
    assert verdict.policy_adherence is True
    assert verdict.needs_human_review is False
    assert verdict.result_confidence == 0.95
    assert all(item.status == "supported" for item in verdict.claim_results)


def test_provider_value_must_equal_the_immutable_expected_value():
    verdict = evaluate(
        turns=canonical_turns(),
        provider_result={"delivery_date": "2026-08-11", "surcharge_cents": 12000},
    )

    claim = next(item for item in verdict.claim_results if item.claim_id == "delivery_date_confirmed")
    assert claim.status == "contradicted"
    assert verdict.goal_completion == "failed"
    assert verdict.needs_human_review is True


def test_free_form_question_and_bare_yes_never_inherit_meaning():
    turns = canonical_turns()
    turns[1] = {"speaker": "agent", "text": "Has the delivery remained unchanged?"}

    verdict = evaluate(
        turns=turns,
        provider_result={"delivery_date": "2026-08-07", "surcharge_cents": 12000},
    )

    claim = next(item for item in verdict.claim_results if item.claim_id == "delivery_date_confirmed")
    assert claim.status == "absent"
    assert verdict.goal_completion == "unknown"
    assert verdict.needs_human_review is True


def test_wrong_value_in_an_otherwise_readable_statement_is_not_evidence():
    turns = canonical_turns()
    turns[1] = {
        "speaker": "agent",
        "text": "Please confirm exactly: the delivery date is 2026-08-11. Answer YES or NO.",
    }

    verdict = evaluate(
        turns=turns,
        provider_result={"delivery_date": "2026-08-07", "surcharge_cents": 12000},
    )

    assert verdict.goal_completion == "unknown"
    assert verdict.needs_human_review is True


@pytest.mark.parametrize("statement", [
    "This call is not being recorded.",
    "Is this call being recorded?",
    "We might record this call.",
])
def test_disclosure_requires_the_exact_positive_statement(statement):
    turns = canonical_turns()
    turns[0] = {"speaker": "agent", "text": statement}

    verdict = evaluate(
        turns=turns,
        provider_result={"delivery_date": "2026-08-07", "surcharge_cents": 12000},
    )

    assert verdict.missing_disclosures == ["recording_notice"]
    assert verdict.policy_evaluation == "unknown"
    assert verdict.needs_human_review is True


def test_provider_amount_conflicting_with_any_transcript_amount_never_verifies():
    turns = canonical_turns(amount="$0.00")
    turns.insert(3, {"speaker": "agent", "text": "I accept a $500.00 surcharge."})

    verdict = evaluate(
        turns=turns,
        provider_result={"delivery_date": "2026-08-07", "surcharge_cents": 0},
    )

    claim = next(item for item in verdict.claim_results if item.kind == "commitment_limit")
    assert claim.status == "contradicted"
    assert verdict.policy_evaluation == "violated"
    assert verdict.needs_human_review is True


def test_over_limit_amount_is_a_policy_violation_even_when_confirmed():
    verdict = evaluate(
        turns=canonical_turns(amount="$320.00"),
        provider_result={"delivery_date": "2026-08-07", "surcharge_cents": 32000},
    )

    assert verdict.unauthorized_commitment is True
    assert verdict.policy_evaluation == "violated"
    assert verdict.needs_human_review is True


def test_semantic_only_forbidden_rule_is_never_assumed_compliant():
    verdict = evaluate(
        turns=canonical_turns(),
        provider_result={"delivery_date": "2026-08-07", "surcharge_cents": 12000},
        forbidden=True,
    )

    claim = next(item for item in verdict.claim_results if item.kind == "forbidden_commitment")
    assert claim.status == "unevaluated"
    assert verdict.policy_evaluation == "unknown"
    assert verdict.policy_adherence is False
    assert verdict.needs_human_review is True


def test_declared_rules_without_typed_claims_are_rejected_at_the_boundary():
    document = request_with(
        turns=canonical_turns(),
        provider_result={"delivery_date": "2026-08-07", "surcharge_cents": 12000},
    ).model_dump(mode="json")
    document["call_contract"]["required_disclosures"].append("order_number_notice")

    with pytest.raises(ValidationError, match="must match exactly"):
        AnalysisRequest.model_validate(document)


def test_contract_cannot_supply_its_own_semantically_different_statement():
    document = request_with(
        turns=canonical_turns(),
        provider_result={"delivery_date": "2026-08-07", "surcharge_cents": 12000},
    ).model_dump(mode="json")
    document["call_contract"]["verification_claims"][0]["agent_statement"] = (
        "Please confirm that the delivery stayed unchanged."
    )

    with pytest.raises(ValidationError, match="Extra inputs are not permitted"):
        AnalysisRequest.model_validate(document)


def test_claim_id_cannot_be_bound_to_the_wrong_provider_field():
    document = request_with(
        turns=canonical_turns(),
        provider_result={"delivery_date": "2026-08-07", "surcharge_cents": 12000},
    ).model_dump(mode="json")
    document["call_contract"]["verification_claims"][0]["result_field"] = "delivery_time"

    with pytest.raises(ValidationError, match="must bind delivery_date"):
        AnalysisRequest.model_validate(document)
