"""Adversarial suite for the evaluator.

Every test here is an attempt to make the evaluator say "verified, no review needed"
when it should not. They exist because fixing reported cases one at a time kept leaving
the next one open: the old design assumed success and looked for reasons to doubt it, so
anything nobody had imagined resolved as verified.

The invariant these tests pin down is the inverse:

    A call auto-verifies ONLY when the counterparty explicitly confirmed each declared
    success condition. Anything else — silence, a topic mentioned without agreement, the
    agent confirming its own work, a voicemail — lands in human review.

Cases are grouped by the hole they close, so a future regression names itself.
"""
from __future__ import annotations

from uuid import uuid4

import pytest

from call_analyzer.evaluator import DeterministicEvaluator
from call_analyzer.schemas import AnalysisRequest


def request_with(turns, provider_result, *, success_conditions=None, maximum=25000,
                 required_disclosures=None, forbidden_commitments=None):
    return AnalysisRequest.model_validate({
        "schema_version": "1.0",
        "request_id": str(uuid4()),
        "call_id": "adversarial",
        "submitted_at": "2026-08-01T22:30:00Z",
        "call_contract": {
            "objective": "Move delivery to Friday",
            "success_conditions": success_conditions or ["delivery_changed"],
            "allowed_commitments": {"maximum_surcharge_cents": maximum},
            "required_disclosures": required_disclosures or [],
            "forbidden_commitments": forbidden_commitments or [],
            "escalation_conditions": ["surcharge_above_limit"],
        },
        "transcript": {"language": "en", "turns": turns},
        "provider_result": provider_result,
        "callback": {"url": "https://rails.test/webhooks/call_analyzer"},
    })


def verdict_for(*args, **kwargs):
    return DeterministicEvaluator().evaluate(request_with(*args, **kwargs))


def assert_not_auto_verified(verdict, because):
    assert verdict.needs_human_review is True, f"should need review: {because}"
    assert verdict.goal_completion != "complete", f"should not be complete: {because}"
    assert verdict.result_confidence < 0.75, f"confidence too high: {because}"


# ── the agent cannot corroborate itself ───────────────────────────────────────────

def test_agent_question_is_not_corroboration():
    """The reported case: the agent's own question mentioning the topic counted as proof."""
    verdict = verdict_for(
        turns=[
            {"id": 1, "speaker": "agent", "text": "Can we move the delivery to Friday?"},
            {"id": 2, "speaker": "recipient", "text": "There is a $1.00 support fee this month."},
        ],
        provider_result={"surcharge_cents": 100, "delivery_changed": True},
    )
    assert_not_auto_verified(verdict, "only the agent ever mentioned the delivery")
    assert verdict.negotiated_terms["unsupported_success_conditions"] == ["delivery_changed"]


def test_agent_announcing_success_is_not_corroboration():
    """An agent that simply declares the job done must not verify its own claim."""
    verdict = verdict_for(
        turns=[
            {"id": 1, "speaker": "agent", "text": "I have moved your delivery to Friday. Done."},
            {"id": 2, "speaker": "recipient", "text": "Uh huh."},
        ],
        provider_result={"surcharge_cents": 0, "delivery_changed": True},
    )
    assert_not_auto_verified(verdict, "the agent confirmed its own work")


def test_system_and_unknown_speakers_do_not_corroborate():
    verdict = verdict_for(
        turns=[
            {"id": 1, "speaker": "system", "text": "Delivery rescheduled to Friday. Yes."},
            {"id": 2, "speaker": "unknown", "text": "Yes, the delivery is confirmed."},
        ],
        provider_result={"surcharge_cents": 0, "delivery_changed": True},
    )
    assert_not_auto_verified(verdict, "neither system nor unknown speak for the recipient")


# ── silence and voicemail ─────────────────────────────────────────────────────────

def test_voicemail_with_no_recipient_turns_is_never_verified():
    verdict = verdict_for(
        turns=[
            {"id": 1, "speaker": "agent", "text": "Hello, calling about your Friday delivery."},
            {"id": 2, "speaker": "agent", "text": "I will call back later. Goodbye."},
        ],
        provider_result={"surcharge_cents": 0, "delivery_changed": True},
    )
    assert_not_auto_verified(verdict, "the recipient never spoke")


def test_recipient_present_but_never_on_topic():
    verdict = verdict_for(
        turns=[
            {"id": 1, "speaker": "agent", "text": "About the delivery for Friday."},
            {"id": 2, "speaker": "recipient", "text": "Sorry, who is calling? I am busy."},
        ],
        provider_result={"surcharge_cents": 0, "delivery_changed": True},
    )
    assert_not_auto_verified(verdict, "the recipient never addressed the delivery")


# ── topical but unconfirmed → review, not success ─────────────────────────────────

def test_recipient_discusses_topic_without_agreeing_is_routed_to_review():
    """The reviewer's fallback ask: topical-only evidence must go to review."""
    verdict = verdict_for(
        turns=[
            {"id": 1, "speaker": "agent", "text": "Can we move the delivery to Friday?"},
            {"id": 2, "speaker": "recipient", "text": "The delivery is handled by another team."},
        ],
        provider_result={"surcharge_cents": 0, "delivery_changed": True},
    )
    assert_not_auto_verified(verdict, "the topic came up but was never confirmed")
    assert verdict.negotiated_terms["weakly_supported_success_conditions"] == ["delivery_changed"]
    assert verdict.evidence[0].finding == "unconfirmed_success_claim"


def test_unlisted_refusal_phrasing_still_does_not_verify():
    """No negation list can be complete, so completion must not depend on one."""
    verdict = verdict_for(
        turns=[
            {"id": 1, "speaker": "agent", "text": "Can we move the delivery to Friday?"},
            {"id": 2, "speaker": "recipient", "text": "Friday is a bad day for that delivery."},
        ],
        provider_result={"surcharge_cents": 0, "delivery_changed": True},
    )
    assert_not_auto_verified(verdict, "a refusal we never enumerated is still not agreement")


def test_recipient_question_is_not_agreement():
    verdict = verdict_for(
        turns=[
            {"id": 1, "speaker": "agent", "text": "We can move the delivery to Friday."},
            {"id": 2, "speaker": "recipient", "text": "Yes? Are you sure about that delivery?"},
        ],
        provider_result={"surcharge_cents": 0, "delivery_changed": True},
    )
    assert_not_auto_verified(verdict, "a question containing 'yes' is not agreement")


# ── the agent's own obligations are read from the agent ───────────────────────────

def test_recipient_asking_about_recording_is_not_the_agent_disclosing_it():
    verdict = verdict_for(
        turns=[
            {"id": 1, "speaker": "recipient", "text": "Are you recording this call?"},
            {"id": 2, "speaker": "agent", "text": "Can we move the delivery?"},
            {"id": 3, "speaker": "recipient", "text": "Yes, that works for the delivery."},
        ],
        provider_result={"surcharge_cents": 0, "delivery_changed": True},
        required_disclosures=["recording_notice"],
    )
    assert verdict.missing_disclosures == ["recording_notice"]
    assert verdict.policy_adherence is False
    assert verdict.needs_human_review is True


def test_recipient_raising_a_forbidden_topic_does_not_incriminate_the_agent():
    verdict = verdict_for(
        turns=[
            {"id": 1, "speaker": "recipient", "text": "Could you do a product substitution instead?"},
            {"id": 2, "speaker": "agent", "text": "Can we move the delivery to Friday?"},
            {"id": 3, "speaker": "recipient", "text": "Yes, Friday works for the delivery."},
        ],
        provider_result={"surcharge_cents": 0, "delivery_changed": True},
        forbidden_commitments=["product_substitution"],
    )
    assert verdict.negotiated_terms["forbidden_commitments_detected"] == []
    assert verdict.policy_adherence is True


def test_agent_offering_a_forbidden_commitment_is_flagged():
    verdict = verdict_for(
        turns=[
            {"id": 1, "speaker": "agent", "text": "I can offer a product substitution instead."},
            {"id": 2, "speaker": "recipient", "text": "Yes, the delivery change is fine."},
        ],
        provider_result={"surcharge_cents": 0, "delivery_changed": True},
        forbidden_commitments=["product_substitution"],
    )
    assert verdict.negotiated_terms["forbidden_commitments_detected"] == ["product_substitution"]
    assert verdict.policy_adherence is False
    assert verdict.needs_human_review is True


# ── multi-condition calls ─────────────────────────────────────────────────────────

def test_one_confirmed_condition_does_not_carry_an_unmentioned_one():
    verdict = verdict_for(
        turns=[
            {"id": 1, "speaker": "agent", "text": "Can we move the delivery date to Friday?"},
            {"id": 2, "speaker": "recipient", "text": "Yes, the delivery date is fine."},
        ],
        provider_result={"surcharge_cents": 0, "delivery_date": "2026-08-07",
                         "delivery_time": "09:00"},
        success_conditions=["delivery_date_confirmed", "delivery_time_confirmed"],
    )
    assert_not_auto_verified(verdict, "the time was never confirmed by the recipient")
    assert "delivery_time_confirmed" in (
        verdict.negotiated_terms["unsupported_success_conditions"]
        + verdict.negotiated_terms["weakly_supported_success_conditions"]
    )


# ── an explicit denial outranks agreeable-looking vocabulary ──────────────────────

def test_denial_containing_an_affirmation_word_is_not_agreement():
    """Reported case: "That is not correct" contains "correct" and verified the call.

    Completion cannot depend on a list of refusal phrasings. It depends on negation
    particles, which are a closed class, so an unseen way of saying no still lands here.
    """
    verdict = verdict_for(
        turns=[
            {"id": 1, "speaker": "agent", "text": "So the delivery has been moved to Friday."},
            {"id": 2, "speaker": "recipient",
             "text": "That is not correct; the delivery has not changed."},
        ],
        provider_result={"surcharge_cents": 0, "delivery_changed": True},
    )
    assert_not_auto_verified(verdict, "the recipient denied the outcome outright")
    assert verdict.evidence[0].finding == "denied_success_claim"
    assert any("explicitly denied" in c for c in verdict.contradictions)


@pytest.mark.parametrize("denial", [
    "No, the delivery has not been changed.",
    "That's not right, nothing was moved.",
    "Correct me if I'm wrong, but the delivery never changed.",
    "Sure, except the delivery was not rescheduled.",
    "Claro que no, la entrega no se movió.",
])
def test_denials_phrased_in_ways_we_never_enumerated(denial):
    verdict = verdict_for(
        turns=[
            {"id": 1, "speaker": "agent", "text": "The delivery has been moved to Friday."},
            {"id": 2, "speaker": "recipient", "text": denial},
        ],
        provider_result={"surcharge_cents": 0, "delivery_changed": True},
    )
    assert_not_auto_verified(verdict, f"denial should not verify: {denial!r}")


def test_agreement_then_retraction_is_not_agreement():
    verdict = verdict_for(
        turns=[
            {"id": 1, "speaker": "agent", "text": "Can we move the delivery to Friday?"},
            {"id": 2, "speaker": "recipient", "text": "Yes, that works for the delivery."},
            {"id": 3, "speaker": "recipient", "text": "Actually no, the delivery cannot move."},
        ],
        provider_result={"surcharge_cents": 0, "delivery_changed": True},
    )
    assert_not_auto_verified(verdict, "the recipient took the agreement back")


# ── auto-verification needs a form we can read, not the absence of one we listed ──

def test_the_reported_doubt_and_dispute_case():
    """Reported: an agreement word unlocked verification because the rejection verb
    was not on any list. This is the app's real delivery_date/delivery_time policy."""
    verdict = verdict_for(
        turns=[
            {"id": 1, "speaker": "agent",
             "text": "This call is recorded. I have set the delivery date and time."},
            {"id": 2, "speaker": "recipient",
             "text": "I doubt the delivery date is correct; the fee is $0.00"},
            {"id": 3, "speaker": "recipient",
             "text": "I dispute that the delivery time is correct."},
        ],
        provider_result={"surcharge_cents": 0, "delivery_date": "2026-08-07",
                         "delivery_time": "09:00"},
        success_conditions=["delivery_date_confirmed", "delivery_time_confirmed"],
    )
    assert_not_auto_verified(verdict, "both turns reject the outcome outright")


@pytest.mark.parametrize("answer", [
    # The point of this list is that NOTHING in the evaluator enumerates any of it.
    # Each one contains an agreement word and means the opposite, or means something
    # conditional we cannot read.
    "I doubt the delivery date is correct.",
    "I dispute that the delivery is correct.",
    "I am unsure whether the delivery is correct.",
    "It would be correct if the driver actually showed up.",
    "My lawyer says the delivery date is correct, but I disagree.",
    "Correct me if I'm wrong about the delivery.",
    "Whether the delivery is correct depends on my husband.",
    "Yes, but only if you refund the delivery entirely.",
    "That's right, and I'm reporting you for the delivery.",
    "Yes — assuming the delivery actually happens, which I question.",
    "Es correcto siempre y cuando la entrega llegue completa.",
    "Sí, pero la entrega me la cambian otra vez y ya me cansé.",
])
def test_agreement_words_inside_unreadable_sentences_do_not_verify(answer):
    verdict = verdict_for(
        turns=[
            {"id": 1, "speaker": "agent", "text": "Can we move the delivery to Friday?"},
            {"id": 2, "speaker": "recipient", "text": answer},
        ],
        provider_result={"surcharge_cents": 0, "delivery_changed": True},
    )
    assert not (verdict.goal_completion == "complete" and not verdict.needs_human_review), (
        f"auto-verified a sentence it cannot read: {answer!r}"
    )


@pytest.mark.parametrize("answer", [
    "Yes.", "Correct.", "Confirmed.", "That's right.", "Agreed.",
    "Sí.", "Está bien.", "De acuerdo.", "Correcto.",
    "Confirmed, the delivery moves to Friday.",
    "Yes, with a $120.00 surcharge.",
    "Sí, está bien.",
])
def test_the_supported_forms_still_verify(answer):
    """A gate that never opens is not a gate — and this is the whole set that opens it."""
    verdict = verdict_for(
        turns=[
            {"id": 1, "speaker": "agent", "text": "Can we move the delivery to Friday?"},
            {"id": 2, "speaker": "recipient", "text": answer},
        ],
        provider_result={"surcharge_cents": 12000, "delivery_changed": True},
    )
    assert verdict.goal_completion == "complete", f"should have verified: {answer!r}"
    assert verdict.needs_human_review is False, f"should not need review: {answer!r}"


@pytest.mark.parametrize("answer", [
    # Reported: substring matching accepted "unchanged" because it contains "changed",
    # so an explicit contradiction auto-verified at 0.80. A prefix can invert a word's
    # polarity and no amount of containment logic makes that safe.
    "Yes, the delivery is unchanged.",
    "Yes, the delivery is undelivered.",
    "Correct, the delivery is unconfirmed.",
    "Confirmed, the order is uncancelled.",
    "Yes, the delivery is nonexistent.",
    "Yes, the delivery was misdelivered.",
    "Yes, the shipment is unshipped.",
    # Not a prefix at all — the point is that we refuse words we do not know, rather
    # than detecting the ways a word can be negated.
    "Yes, the delivery is pending.",
    "Yes, the delivery is hypothetical.",
    "Sí, la entrega está incompleta.",
])
def test_morphology_we_cannot_read_never_verifies(answer):
    verdict = verdict_for(
        turns=[
            {"id": 1, "speaker": "agent", "text": "Can we move the delivery to Friday?"},
            {"id": 2, "speaker": "recipient", "text": answer},
        ],
        provider_result={"surcharge_cents": 0, "delivery_changed": True},
    )
    assert not (verdict.goal_completion == "complete" and not verdict.needs_human_review), (
        f"auto-verified a word it cannot read: {answer!r}"
    )


def test_a_word_must_be_a_known_word_not_merely_contain_one():
    """The unit-level statement of the same rule, so a refactor cannot lose it."""
    evaluator = DeterministicEvaluator()

    assert evaluator._is_supported_affirmation("Yes, the delivery moves to Friday.")
    assert not evaluator._is_supported_affirmation("Yes, the delivery is unchanged.")
    assert not evaluator._is_supported_affirmation("Yes, the deliverything is fine.")


def test_an_agreement_buried_mid_sentence_is_not_an_answer():
    """The agreement has to OPEN the turn. Anywhere else it is a fragment of a larger
    sentence whose meaning we cannot see."""
    verdict = verdict_for(
        turns=[
            {"id": 1, "speaker": "agent", "text": "Can we move the delivery to Friday?"},
            {"id": 2, "speaker": "recipient",
             "text": "My daughter said yes to the delivery but she does not decide."},
        ],
        provider_result={"surcharge_cents": 0, "delivery_changed": True},
    )
    assert_not_auto_verified(verdict, "someone else's yes, reported second-hand")


# ── a disclosure is the whole disclosure ──────────────────────────────────────────

def test_a_shared_word_does_not_satisfy_a_required_disclosure():
    """Reported case: `confirm_order_number` counted as disclosed because the agent
    said "confirm" about the delivery date. No order number was ever read out."""
    verdict = verdict_for(
        turns=[
            {"id": 1, "speaker": "agent",
             "text": "Let me confirm the delivery date and time for Friday."},
            {"id": 2, "speaker": "recipient", "text": "Yes, the delivery date works."},
        ],
        provider_result={"surcharge_cents": 0, "delivery_changed": True},
        required_disclosures=["confirm_order_number"],
    )
    assert verdict.missing_disclosures == ["confirm_order_number"]
    assert verdict.policy_adherence is False
    assert verdict.needs_human_review is True


def test_a_fully_stated_disclosure_is_satisfied():
    verdict = verdict_for(
        turns=[
            {"id": 1, "speaker": "agent",
             "text": "Let me confirm your order number 4417 before we change the delivery."},
            {"id": 2, "speaker": "recipient", "text": "Yes, that order is right, move the delivery."},
        ],
        provider_result={"surcharge_cents": 0, "delivery_changed": True},
        required_disclosures=["confirm_order_number"],
    )
    assert verdict.missing_disclosures == []
    assert verdict.policy_adherence is True


def test_disclosure_spread_across_two_turns_is_not_verifiable():
    """Half a disclosure here and half there is not evidence that it was made."""
    verdict = verdict_for(
        turns=[
            {"id": 1, "speaker": "agent", "text": "I need to confirm your order."},
            {"id": 2, "speaker": "agent", "text": "What is the number on the delivery slip?"},
            {"id": 3, "speaker": "recipient", "text": "Yes, go ahead with the delivery."},
        ],
        provider_result={"surcharge_cents": 0, "delivery_changed": True},
        required_disclosures=["confirm_order_number"],
    )
    assert verdict.missing_disclosures == ["confirm_order_number"]
    assert verdict.needs_human_review is True


# ── the happy path must still pass, or the gate is useless ────────────────────────

def test_explicit_recipient_confirmation_still_auto_verifies():
    verdict = verdict_for(
        turns=[
            {"id": 1, "speaker": "agent", "text": "This call is recorded. Can we move the delivery?"},
            {"id": 2, "speaker": "recipient", "text": "Yes, with a $120.00 surcharge."},
        ],
        provider_result={"surcharge_cents": 12000, "delivery_changed": True},
        required_disclosures=["recording_notice"],
    )
    assert verdict.goal_completion == "complete"
    assert verdict.needs_human_review is False
    assert verdict.policy_adherence is True
    assert verdict.missing_disclosures == []
    assert verdict.evidence[0].finding == "policy_compliance"


def test_recipient_confirming_on_topic_without_a_preceding_question_verifies():
    verdict = verdict_for(
        turns=[
            {"id": 1, "speaker": "recipient", "text": "Confirmed, the delivery moves to Friday."},
            {"id": 2, "speaker": "agent", "text": "Thank you."},
        ],
        provider_result={"surcharge_cents": 0, "delivery_changed": True},
    )
    assert verdict.goal_completion == "complete"
    assert verdict.needs_human_review is False
