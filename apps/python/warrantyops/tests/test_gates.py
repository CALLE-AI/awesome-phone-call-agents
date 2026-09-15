"""The gates in front of a call: who may be called, and how a retry stays free."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from warrantyops.authorization import (
    AuthorizationBasis,
    AuthorizationRefusal,
    CallAuthorization,
    authorize_call,
    mask_e164,
    normalize_e164,
)
from warrantyops.idempotency import (
    MAX_KEY_LENGTH,
    IdempotencyError,
    derive_idempotency_key,
)

BASE = {
    "namespace": "warrantyops",
    "authorization_record_reference": "vault://authorizations/2026-09-01/acme",
    "source_platform": "SYNTHETIC-DMS",
    "source_claim_id": "CLM-1042",
    "source_version": "v7",
    "contract_version": "warranty-claim-exception/v1",
}


def test_the_same_authorized_operation_always_derives_the_same_key():
    assert derive_idempotency_key(**BASE) == derive_idempotency_key(**BASE)


def test_a_different_claim_derives_a_different_key():
    other = {**BASE, "source_claim_id": "CLM-1043"}
    assert derive_idempotency_key(**BASE) != derive_idempotency_key(**other)


def test_a_different_authorization_derives_a_different_key():
    other = {**BASE, "authorization_record_reference": "vault://authorizations/other"}
    assert derive_idempotency_key(**BASE) != derive_idempotency_key(**other)


def test_a_contract_change_derives_a_different_key():
    other = {**BASE, "contract_version": "warranty-claim-exception/v2"}
    assert derive_idempotency_key(**BASE) != derive_idempotency_key(**other)


def test_a_new_source_version_of_the_same_claim_derives_a_different_key():
    """The key is claim-version bound: a moved record is a new question.

    Reusing the v7 key for a v8 record would return the v7 call's answer for
    a record that has since changed, which is the duplicate the lock forbids.
    """

    other = {**BASE, "source_version": "v8"}
    assert derive_idempotency_key(**BASE) != derive_idempotency_key(**other)


def test_a_recheck_needs_an_explicit_token():
    """Reusing the original key would return the answer being re-checked."""

    original = derive_idempotency_key(**BASE)
    recheck = derive_idempotency_key(**BASE, recheck_token="2026-09-01T14")
    assert original != recheck
    assert derive_idempotency_key(**BASE, recheck_token="2026-09-01T14") == recheck


def test_the_key_fits_the_documented_header_limit():
    key = derive_idempotency_key(**BASE)
    assert 1 <= len(key) <= MAX_KEY_LENGTH


def test_incomplete_inputs_are_refused_rather_than_defaulted():
    for field in (
        "authorization_record_reference",
        "source_platform",
        "source_claim_id",
        "source_version",
        "contract_version",
    ):
        with pytest.raises(IdempotencyError):
            derive_idempotency_key(**{**BASE, field: "   "})
    with pytest.raises(IdempotencyError):
        derive_idempotency_key(**{**BASE, "namespace": "Not A Slug"})


# --- authorization ---------------------------------------------------------


NOW = datetime(2026, 9, 1, 12, 0, tzinfo=timezone.utc)
PURPOSE = "warranty claim exception follow-up"


def make(**overrides) -> CallAuthorization:
    base = {
        "recipient_e164": "+12025550142",
        "basis": AuthorizationBasis.EXISTING_SERVICE_RELATIONSHIP,
        "purpose": PURPOSE,
        "granted_by": "operations-manager",
        "granted_at": NOW - timedelta(days=2),
        "expires_at": NOW + timedelta(days=2),
        "record_reference": "vault://authorizations/2026-08-30/acme",
    }
    base.update(overrides)
    return CallAuthorization(**base)


def test_a_live_authorization_for_the_requested_purpose_is_allowed():
    decision = authorize_call(make(), requested_purpose=PURPOSE, now=NOW)
    assert decision.allowed
    assert decision.refusals == ()


def test_an_expired_authorization_is_refused():
    authorization = make(expires_at=NOW - timedelta(minutes=1))
    decision = authorize_call(authorization, requested_purpose=PURPOSE, now=NOW)
    assert AuthorizationRefusal.EXPIRED in decision.refusals
    assert decision.allowed is False


def test_a_purpose_the_recipient_did_not_agree_to_is_refused():
    decision = authorize_call(make(), requested_purpose="sales follow up", now=NOW)
    assert AuthorizationRefusal.PURPOSE_MISMATCH in decision.refusals


def test_a_number_that_is_not_strict_e164_is_refused():
    for bad in ("2025550142", "+1 202 555 0142", "+0205550142", "+120255", ""):
        decision = authorize_call(
            make(recipient_e164=bad), requested_purpose=PURPOSE, now=NOW
        )
        assert AuthorizationRefusal.INVALID_E164 in decision.refusals, bad


def test_a_recipient_outside_the_allowlist_is_refused():
    decision = authorize_call(
        make(),
        requested_purpose=PURPOSE,
        now=NOW,
        allowlist=frozenset({"+14155550101"}),
    )
    assert AuthorizationRefusal.RECIPIENT_NOT_ALLOWLISTED in decision.refusals


def test_an_authorization_without_a_record_pointer_is_refused():
    decision = authorize_call(
        make(record_reference="  "), requested_purpose=PURPOSE, now=NOW
    )
    assert AuthorizationRefusal.MISSING_RECORD_REFERENCE in decision.refusals


def test_numbers_are_masked_for_every_human_readable_surface():
    masked = mask_e164("+12025550142")
    assert masked == "+12*******42"
    assert "5550142" not in masked


# --- destination binding ----------------------------------------------------


def test_numbers_are_normalized_before_the_destination_comparison():
    """Trim-only normalization: a valid E.164 has no internal formatting."""

    assert normalize_e164("  +12025550142 ") == normalize_e164("+12025550142")
    assert normalize_e164("+12025550142 ") == "+12025550142"
    assert normalize_e164("+12025550142") != normalize_e164("+14155550101")


def test_the_destination_mismatch_is_a_named_authorization_refusal():
    assert AuthorizationRefusal.AUTHORIZED_RECIPIENT_MISMATCH.value == (
        "AUTHORIZED_RECIPIENT_MISMATCH"
    )


# --- the decision surface and the remaining named refusals --------------------


def test_the_authorization_decision_renders_its_refusals():
    allowed = authorize_call(make(), requested_purpose=PURPOSE, now=NOW)
    refused = authorize_call(
        make(expires_at=NOW - timedelta(minutes=1)), requested_purpose=PURPOSE, now=NOW
    )
    assert allowed.to_dict() == {"allowed": True, "refusals": []}
    assert refused.to_dict() == {
        "allowed": False,
        "refusals": [AuthorizationRefusal.EXPIRED.value],
    }


def test_masking_covers_the_short_and_empty_forms():
    assert mask_e164("") == ""
    assert mask_e164("+12345") == "+*****"
    assert "12345" not in mask_e164("+12345")


def test_a_naive_clock_is_rejected_rather_than_assumed_local():
    with pytest.raises(ValueError, match="timezone-aware"):
        authorize_call(
            make(), requested_purpose=PURPOSE, now=datetime(2026, 9, 1, 12, 0)
        )
    naive_grant = make(granted_at=datetime(2026, 9, 1, 10, 0))
    with pytest.raises(ValueError, match="timezone-aware"):
        authorize_call(naive_grant, requested_purpose=PURPOSE, now=NOW)


def test_a_blank_purpose_is_refused_not_defaulted():
    decision = authorize_call(make(), requested_purpose="  ", now=NOW)
    assert AuthorizationRefusal.MISSING_PURPOSE in decision.refusals


def test_an_authorization_not_yet_in_force_is_refused():
    decision = authorize_call(
        make(granted_at=NOW + timedelta(minutes=1)), requested_purpose=PURPOSE, now=NOW
    )
    assert AuthorizationRefusal.NOT_YET_VALID in decision.refusals


def test_a_key_past_the_header_limit_is_refused(monkeypatch):
    """The slug regex already caps real keys at 97 characters; the limit
    guard is the backstop underneath it, proven here with the bound lowered."""

    from warrantyops import idempotency as idempotency_module

    monkeypatch.setattr(idempotency_module, "MAX_KEY_LENGTH", 10)
    with pytest.raises(IdempotencyError, match="255 character limit"):
        derive_idempotency_key(**BASE)
