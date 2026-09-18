from insurance_call_recovery.models import RecoveryTask
from insurance_call_recovery.recovery import dry_run, recovery_id_for
from insurance_call_recovery.safety import mask_phone, validate_e164

def task(intent):
    return RecoveryTask(
        task_description="Synthetic unresolved task",
        task_type=intent,
        destination="+15555010199",
        intended_outcome="Obtain a verified outcome",
    )

def test_valid_e164():
    validate_e164("+15555010199")

def test_invalid_e164_rejected():
    try:
        validate_e164("555-010-199")
    except ValueError:
        return
    assert False

def test_masking():
    assert mask_phone("+15555010199") == "+1555•••0199"

def test_claim_recovery():
    t = task("claim_status")
    result = dry_run(
        t,
        recovery_id_for(t),
        "The claims department confirmed the claim is under review and the next action is adjuster review."
    )
    assert result.status == "recovered"
    assert result.evidence.verified is True

def test_no_answer_fails_closed():
    t = task("policy_service")
    result = dry_run(t, recovery_id_for(t), "No answer. The call reached voicemail.")
    assert result.status == "no_answer"
    assert result.human_escalation_required is True

def test_ambiguous_renewal_fails_closed():
    t = task("renewal")
    result = dry_run(
        t,
        recovery_id_for(t),
        "The customer said they are still thinking about it and will decide soon."
    )
    assert result.status == "ambiguous"
    assert result.human_escalation_required is True
    assert result.evidence.verified is False

def test_billing_requires_explicit_amount():
    t = task("billing")
    ambiguous = dry_run(
        t,
        recovery_id_for(t),
        "The billing representative said the issue has been handled."
    )
    assert ambiguous.status == "ambiguous"
    assert ambiguous.human_escalation_required is True

def test_recovery_id_is_stable():
    t = task("claim_status")
    assert recovery_id_for(t) == recovery_id_for(t)
