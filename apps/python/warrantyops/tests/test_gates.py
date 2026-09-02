"""The gates in front of a call: who may be called, and how a retry stays free."""

from __future__ import annotations

import pytest

from warrantyops.idempotency import (
    MAX_KEY_LENGTH,
    IdempotencyError,
    derive_idempotency_key,
)

BASE = dict(
    namespace="warrantyops",
    authorization_record_reference="vault://authorizations/2026-09-01/acme",
    case_reference="CASE-1042",
    contract_version="warranty-recovery/v0",
)


def test_the_same_authorized_operation_always_derives_the_same_key():
    assert derive_idempotency_key(**BASE) == derive_idempotency_key(**BASE)


def test_a_different_case_derives_a_different_key():
    other = {**BASE, "case_reference": "CASE-1043"}
    assert derive_idempotency_key(**BASE) != derive_idempotency_key(**other)


def test_a_different_authorization_derives_a_different_key():
    other = {**BASE, "authorization_record_reference": "vault://authorizations/other"}
    assert derive_idempotency_key(**BASE) != derive_idempotency_key(**other)


def test_a_contract_change_derives_a_different_key():
    other = {**BASE, "contract_version": "warranty-recovery/v1"}
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
    for field in ("authorization_record_reference", "case_reference"):
        with pytest.raises(IdempotencyError):
            derive_idempotency_key(**{**BASE, field: "   "})
    with pytest.raises(IdempotencyError):
        derive_idempotency_key(**{**BASE, "namespace": "Not A Slug"})


# --- authorization ---------------------------------------------------------


from datetime import datetime, timedelta, timezone

from warrantyops.authorization import (
    AuthorizationBasis,
    AuthorizationRefusal,
    CallAuthorization,
    authorize_call,
    mask_e164,
)

NOW = datetime(2026, 9, 1, 12, 0, tzinfo=timezone.utc)
PURPOSE = "warranty exception resolution"


def make(**overrides) -> CallAuthorization:
    base = dict(
        recipient_e164="+12025550142",
        basis=AuthorizationBasis.EXISTING_SERVICE_RELATIONSHIP,
        purpose=PURPOSE,
        granted_by="operations-manager",
        granted_at=NOW - timedelta(days=2),
        expires_at=NOW + timedelta(days=2),
        record_reference="vault://authorizations/2026-08-30/acme",
    )
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
