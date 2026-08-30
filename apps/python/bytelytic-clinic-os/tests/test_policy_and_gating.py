import pytest
from bytelytic_clinic.domain.policy import RecipientSecurityPolicy


def test_dry_run_allows_any_valid_e164():
    policy = RecipientSecurityPolicy(authorized_recipients=["+15550192834"], dry_run=True)
    assert policy.verify_call_permission("+15559999999") == "+15559999999"


def test_live_allows_authorized_recipient():
    policy = RecipientSecurityPolicy(authorized_recipients=["+15550192834"], dry_run=False)
    assert policy.verify_call_permission("+15550192834") == "+15550192834"


def test_live_blocks_unauthorized_recipient():
    policy = RecipientSecurityPolicy(authorized_recipients=["+15550192834"], dry_run=False)
    with pytest.raises(PermissionError):
        policy.verify_call_permission("+15559998888")


def test_policy_normalizes_before_checking():
    policy = RecipientSecurityPolicy(authorized_recipients=["+15550192834"], dry_run=False)
    assert policy.verify_call_permission("+1 (555) 019-2834") == "+15550192834"


def test_fail_closed_triggers_for_low_confidence():
    policy = RecipientSecurityPolicy(authorized_recipients=["+15550192834"], dry_run=True)
    assert policy.check_fail_closed_disposition(0.65) is True
    assert policy.check_fail_closed_disposition(0.50) is True


def test_fail_closed_passes_for_high_confidence():
    policy = RecipientSecurityPolicy(authorized_recipients=["+15550192834"], dry_run=True)
    assert policy.check_fail_closed_disposition(0.85) is False
    assert policy.check_fail_closed_disposition(0.96) is False


def test_invalid_phone_in_authorized_list_normalized():
    policy = RecipientSecurityPolicy(authorized_recipients=["5550192834"], dry_run=True)
    assert "+15550192834" in policy.authorized_recipients


def test_empty_phone_rejected_by_policy():
    policy = RecipientSecurityPolicy(authorized_recipients=["+15550192834"], dry_run=True)
    with pytest.raises(ValueError):
        policy.verify_call_permission("")
