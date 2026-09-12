"""The primitive is not one directory's shape.

The live application here is a community resource directory, and it would be
easy to claim the Verification Contract generalises without ever proving it.
These tests build the other three shapes, run a conversation through each one,
and check that the *policy* answers differently because the *contract* differs,
not because the code branches on the domain.
"""

from __future__ import annotations

import pytest

from callibrate.calling.models import CallOutcome
from callibrate.contracts import (
    CONTRACT_LIBRARY,
    Trigger,
    TriggerType,
    appointment_availability_verification,
    business_hours_verification,
    provider_network_verification,
)
from callibrate.evidence.reconcile import build_evidence
from callibrate.evidence.transcript import normalize_turns
from callibrate.policy.evidence_policy import Authority, classify, overall
from tests.conftest import turns


def read(contract, raw):
    return build_evidence(
        contract, turns=normalize_turns(raw), caller="test", outcome=CallOutcome.COMPLETED
    )


def test_the_library_names_four_shapes():
    assert set(CONTRACT_LIBRARY) == {
        "community_resource",
        "business_hours",
        "appointment_availability",
        "provider_network",
    }


def test_business_hours_can_be_corrected_automatically():
    contract = business_hours_verification(
        contract_id="vc_shop",
        record_id="listing_88",
        business_name="Harbour Cycle Repair",
        phone="+15550107777",
        published_hours="WE 09:00-12:00",
        trigger=Trigger(type=TriggerType.STALE_RECORD),
    )
    evidence = read(
        contract,
        turns(
            ("bot", "Hello, this is an automated assistant checking the hours we publish for you."),
            ("user", "We moved to ten until one."),
            ("bot", "Wednesdays, ten in the morning until one in the afternoon?"),
            ("user", "Yes."),
        ),
    )
    assert overall(classify(evidence, contract)) is Authority.APPLY


def test_appointment_availability_is_never_applied_automatically():
    """A claim about the future is a data point, not a fact about the record."""
    contract = appointment_availability_verification(
        contract_id="vc_desk",
        record_id="practice_12",
        practice_name="Kestrel Family Practice",
        phone="+15550108888",
        published_wait="Book by phone; two week wait",
        trigger=Trigger(type=TriggerType.SCHEDULED_REVERIFY),
    )
    evidence = read(
        contract,
        turns(
            ("bot", "Hello, this is an automated assistant checking what we publish about booking."),
            ("user", "It is only for people referred by a GP now, and the wait is six weeks."),
            ("bot", "Referral only, six week wait?"),
            ("user", "Yes."),
        ),
    )
    assert overall(classify(evidence, contract)) is Authority.REVIEW


def test_provider_network_eligibility_always_reaches_a_person():
    contract = provider_network_verification(
        contract_id="vc_network",
        record_id="clinic_3",
        practice_name="Alder Street Clinic",
        phone="+15550109999",
        published_eligibility="Accepting new Medicaid patients",
        trigger=Trigger(type=TriggerType.USER_REPORT, message="A caller was turned away."),
    )
    evidence = read(
        contract,
        turns(
            ("bot", "Hello, this is an automated assistant. We publish that you accept new Medicaid patients. Is that still right?"),
            ("user", "We are no longer serving new Medicaid patients as of last month."),
            ("bot", "You are no longer serving new Medicaid patients?"),
            ("user", "Correct."),
        ),
    )
    decisions = classify(evidence, contract)
    assert overall(decisions) is Authority.REVIEW
    assert any("never auto-applies" in decision.reason for decision in decisions)


def test_the_same_conversation_gets_a_different_verdict_under_a_different_contract():
    """The domain did not change. The contract did, and that is the whole point."""
    conversation = turns(
        ("bot", "Hello, this is an automated assistant checking the hours we publish."),
        ("user", "We moved to ten until one."),
        ("bot", "Wednesdays, ten in the morning until one in the afternoon?"),
        ("user", "Yes."),
    )
    permissive = business_hours_verification(
        contract_id="vc_a", record_id="r", business_name="Shop", phone="+15550107777",
        published_hours="WE 09:00-12:00", trigger=Trigger(type=TriggerType.STALE_RECORD),
    )
    strict = permissive.model_copy(
        update={"update_policy": permissive.update_policy.model_copy(update={"auto_apply_fields": []})}
    )
    assert overall(classify(read(permissive, conversation), permissive)) is Authority.APPLY
    assert overall(classify(read(strict, conversation), strict)) is Authority.REVIEW


def test_a_contract_cannot_name_a_field_as_both_safe_and_unsafe():
    from callibrate.contracts.models import UpdatePolicy

    with pytest.raises(ValueError):
        UpdatePolicy(auto_apply_fields=["status"], never_auto_apply_fields=["status"])


def test_a_contract_summarises_itself_for_the_queue_and_the_ledger(contract):
    assert "Weekly grocery pickup" in contract.summary()
    assert "opening hours" in contract.summary()
    assert contract.to_payload()["authoritative_phone"] == contract.authoritative_phone
