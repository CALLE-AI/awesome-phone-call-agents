"""No call is placed without a live authorization record for that number and purpose."""

from __future__ import annotations

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
