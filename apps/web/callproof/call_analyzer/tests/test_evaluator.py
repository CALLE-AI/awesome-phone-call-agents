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


def test_failed_objective_is_never_auto_verified():
    """The reported blocker: an unrelated truthy field must not promote a FAILED goal.

    delivery_changed=False (the contract's only declared success condition),
    order_number_confirmed=True, surcharge_cents=0, and a transcript that explicitly
    says the delivery could not be moved.
    """
    request = _request(
        turns=[
            {"id": 1, "speaker": "agent", "text": "Can we move the delivery to Friday?"},
            {"id": 2, "speaker": "recipient", "text": "I am sorry, that could not be done."},
        ],
        provider_result={
            "delivery_changed": False,
            "order_number_confirmed": True,
            "surcharge_cents": 0,
        },
    )

    verdict = DeterministicEvaluator().evaluate(request)

    assert verdict.goal_completion == "failed"
    assert verdict.needs_human_review is True
    assert verdict.result_confidence < 0.75
    assert verdict.evidence[0].finding == "objective_not_met"
    # It must not claim the goal was achieved.
    assert "achieved its goal" not in verdict.summary
    # The unmet declared condition is named, and the denial is cited from the transcript.
    assert verdict.negotiated_terms["unmet_success_conditions"] == ["delivery_changed"]
    assert verdict.evidence[0].turn_ids == [2]
    assert verdict.contradictions == []  # nothing claimed success, so no contradiction


def test_structured_success_contradicted_by_transcript_is_not_auto_verified():
    """All declared conditions met, but the transcript denies it -> no auto-verify."""
    request = _request(
        turns=[
            {"id": 1, "speaker": "recipient", "text": "We cannot move that delivery."},
            {"id": 2, "speaker": "agent", "text": "Understood, $120.00 then."},
        ],
        provider_result={"surcharge_cents": 12000, "delivery_changed": True},
    )

    verdict = DeterministicEvaluator().evaluate(request)

    assert verdict.goal_completion == "partial"
    assert verdict.needs_human_review is True
    assert verdict.contradictions, "a result/transcript disagreement must be recorded"


def test_partially_met_conditions_are_not_complete():
    request = AnalysisRequest.model_validate(
        {
            "schema_version": "1.0",
            "request_id": str(uuid4()),
            "call_id": "call-456",
            "submitted_at": "2026-08-01T22:30:00Z",
            "call_contract": {
                "objective": "Confirm date and time",
                "success_conditions": ["delivery_date_confirmed", "delivery_time_confirmed"],
                "allowed_commitments": {"maximum_surcharge_cents": 25000},
                "escalation_conditions": ["surcharge_above_limit"],
            },
            "transcript": {
                "language": "en",
                "turns": [{"id": 1, "speaker": "agent", "text": "Friday works, $50.00."}],
            },
            "provider_result": {
                "surcharge_cents": 5000,
                "delivery_date": "2026-08-07",
                "delivery_time": None,
            },
            "callback": {"url": "https://rails.test/webhooks/call_analyzer"},
        }
    )

    verdict = DeterministicEvaluator().evaluate(request)

    assert verdict.goal_completion == "partial"
    assert verdict.needs_human_review is True
    assert verdict.negotiated_terms["unmet_success_conditions"] == ["delivery_time_confirmed"]


def test_success_claim_without_transcript_support_is_not_auto_verified():
    """Reviewer repro: delivery_changed=true, but the call only discusses a $1.00 fee.

    The amount coincidentally matches the transcript, which previously produced
    complete / 0.95 / risk 0.08 / no review. Nothing in the call is about the delivery,
    so the success claim must not be auto-verified.
    """
    request = _request(
        turns=[
            {"id": 1, "speaker": "agent", "text": "Hello, checking in about your account."},
            {"id": 2, "speaker": "recipient", "text": "There is a $1.00 support fee this month."},
        ],
        provider_result={"surcharge_cents": 100, "delivery_changed": True},
    )

    verdict = DeterministicEvaluator().evaluate(request)

    assert verdict.goal_completion != "complete"
    assert verdict.needs_human_review is True
    assert verdict.result_confidence < 0.75
    assert verdict.risk_score > 0.08
    assert verdict.evidence[0].finding == "unsupported_success_claim"
    assert verdict.negotiated_terms["unsupported_success_conditions"] == ["delivery_changed"]
    assert any("corroborates" in c for c in verdict.contradictions)


def test_missing_required_disclosure_breaks_policy_adherence():
    request = AnalysisRequest.model_validate(
        {
            "schema_version": "1.0",
            "request_id": str(uuid4()),
            "call_id": "call-789",
            "submitted_at": "2026-08-01T22:30:00Z",
            "call_contract": {
                "objective": "Move delivery to Friday",
                "success_conditions": ["delivery_changed"],
                "allowed_commitments": {"maximum_surcharge_cents": 25000},
                "required_disclosures": ["recording_notice"],
                "escalation_conditions": ["surcharge_above_limit"],
            },
            "transcript": {
                "language": "en",
                "turns": [
                    {"id": 1, "speaker": "agent", "text": "Can we move the delivery?"},
                    {"id": 2, "speaker": "recipient", "text": "Yes, with a $120.00 surcharge."},
                ],
            },
            "provider_result": {"surcharge_cents": 12000, "delivery_changed": True},
            "callback": {"url": "https://rails.test/webhooks/call_analyzer"},
        }
    )

    verdict = DeterministicEvaluator().evaluate(request)

    # The disclosure is declared but never made -> not assumed satisfied.
    assert verdict.missing_disclosures == ["recording_notice"]
    assert verdict.policy_adherence is False
    assert verdict.needs_human_review is True
    assert verdict.evidence[0].finding == "missing_disclosure"


def test_forbidden_commitment_discussed_breaks_policy_adherence():
    request = AnalysisRequest.model_validate(
        {
            "schema_version": "1.0",
            "request_id": str(uuid4()),
            "call_id": "call-790",
            "submitted_at": "2026-08-01T22:30:00Z",
            "call_contract": {
                "objective": "Move delivery to Friday",
                "success_conditions": ["delivery_changed"],
                "allowed_commitments": {"maximum_surcharge_cents": 25000},
                "forbidden_commitments": ["product_substitution"],
                "escalation_conditions": ["surcharge_above_limit"],
            },
            "transcript": {
                "language": "en",
                "turns": [
                    {"id": 1, "speaker": "agent", "text": "Can we move the delivery?"},
                    {
                        "id": 2,
                        "speaker": "agent",
                        "text": "I can offer a product substitution instead, $120.00.",
                    },
                ],
            },
            "provider_result": {"surcharge_cents": 12000, "delivery_changed": True},
            "callback": {"url": "https://rails.test/webhooks/call_analyzer"},
        }
    )

    verdict = DeterministicEvaluator().evaluate(request)

    assert verdict.policy_adherence is False
    assert verdict.unauthorized_commitment is True
    assert verdict.needs_human_review is True
    assert verdict.negotiated_terms["forbidden_commitments_detected"] == ["product_substitution"]


def test_fully_supported_call_still_auto_verifies():
    """The happy path must survive: corroborated condition, disclosure made, no breach."""
    request = AnalysisRequest.model_validate(
        {
            "schema_version": "1.0",
            "request_id": str(uuid4()),
            "call_id": "call-791",
            "submitted_at": "2026-08-01T22:30:00Z",
            "call_contract": {
                "objective": "Move delivery to Friday",
                "success_conditions": ["delivery_changed"],
                "allowed_commitments": {"maximum_surcharge_cents": 25000},
                "required_disclosures": ["recording_notice"],
                "forbidden_commitments": ["product_substitution"],
                "escalation_conditions": ["surcharge_above_limit"],
            },
            "transcript": {
                "language": "en",
                "turns": [
                    {"id": 1, "speaker": "agent", "text": "This call is being recorded."},
                    {"id": 2, "speaker": "agent", "text": "Can we move the delivery to Friday?"},
                    {"id": 3, "speaker": "recipient", "text": "Yes, with a $120.00 surcharge."},
                ],
            },
            "provider_result": {"surcharge_cents": 12000, "delivery_changed": True},
            "callback": {"url": "https://rails.test/webhooks/call_analyzer"},
        }
    )

    verdict = DeterministicEvaluator().evaluate(request)

    assert verdict.goal_completion == "complete"
    assert verdict.policy_adherence is True
    assert verdict.missing_disclosures == []
    assert verdict.needs_human_review is False
    assert verdict.evidence[0].finding == "policy_compliance"
