from __future__ import annotations

from uuid import uuid4

from call_analyzer.evaluator import DeterministicEvaluator
from call_analyzer.schemas import AnalysisRequest


def _request(*, turns, provider_result, maximum_surcharge_cents=25000):
    return AnalysisRequest.model_validate(
        {
            "schema_version": "1.0",
            "request_id": str(uuid4()),
            "call_id": "call-123",
            "submitted_at": "2026-08-01T22:30:00Z",
            "call_contract": {
                "objective": "Move delivery to Friday",
                "success_conditions": ["delivery_changed"],
                "allowed_commitments": {"maximum_surcharge_cents": maximum_surcharge_cents},
                "escalation_conditions": ["surcharge_above_limit"],
            },
            "transcript": {"language": "en", "turns": turns},
            "provider_result": provider_result,
            "callback": {"url": "https://rails.test/webhooks/call_analyzer"},
        }
    )


def test_supported_compliant_result_is_confidently_verified():
    request = _request(
        turns=[
            {"id": 1, "speaker": "agent", "text": "Can we move the delivery?"},
            {"id": 2, "speaker": "recipient", "text": "Yes, with a $120.00 surcharge."},
        ],
        provider_result={"surcharge_cents": 12000, "delivery_changed": True},
    )

    verdict = DeterministicEvaluator().evaluate(request)

    assert verdict.policy_adherence is True
    assert verdict.needs_human_review is False
    assert verdict.result_confidence >= 0.75
    assert verdict.evidence[0].turn_ids == [2]


def test_unsupported_result_is_not_auto_verified():
    # No surcharge in provider_result and no money anywhere in the transcript:
    # evidence is unrelated, so the verdict must not auto-verify at high confidence.
    request = _request(
        turns=[
            {"id": 1, "speaker": "agent", "text": "Hello, are you there?"},
            {"id": 2, "speaker": "recipient", "text": "Yes, who is this?"},
        ],
        provider_result={},
    )

    verdict = DeterministicEvaluator().evaluate(request)

    assert verdict.needs_human_review is True
    assert verdict.result_confidence < 0.75
    assert verdict.goal_completion == "unknown"
    assert verdict.evidence[0].finding == "unsupported_result"


def test_over_limit_surcharge_is_flagged_for_human_review():
    request = _request(
        turns=[
            {"id": 1, "speaker": "recipient", "text": "The surcharge is $320.00."},
            {"id": 2, "speaker": "agent", "text": "I accept the $320.00 surcharge."},
        ],
        provider_result={"surcharge_cents": 32000, "delivery_changed": True},
    )

    verdict = DeterministicEvaluator().evaluate(request)

    assert verdict.unauthorized_commitment is True
    assert verdict.needs_human_review is True
    assert verdict.evidence[0].turn_ids == [1, 2]
