"""The source-claim envelope: a fact record that refuses rather than defaults."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from warrantyops.envelope import (
    EnvelopeRefusal,
    ExceptionStatus,
    ExhaustionManifest,
    ExhaustionRoute,
    OrdinaryRemedy,
    SourceClaim,
    manifest_from_dict,
    source_claim_from_dict,
    validate_exhaustion_manifest,
    validate_source_claim,
)

ON = date(2026, 9, 1)

ALL_THREE_REMEDIES = (
    OrdinaryRemedy("portal_status_check", "portal repeats code R-114, no detail"),
    OrdinaryRemedy("documented_code_resolution", "code sheet does not cover it"),
    OrdinaryRemedy("written_follow_up", "two emails, no reply"),
)

GAP = "the source record does not state what is missing from the return"


def manifest(
    *, source_version: str = "v7", routes=None, information_gap: str = GAP
) -> ExhaustionManifest:
    return ExhaustionManifest(
        source_version=source_version,
        routes=routes
        if routes is not None
        else (
            ExhaustionRoute("portal_status_check", "portal repeats code R-114"),
            ExhaustionRoute("documented_code_resolution", "code sheet does not cover it"),
            ExhaustionRoute("written_follow_up", "two emails, no reply"),
        ),
        information_gap=information_gap,
    )


def claim(**overrides) -> SourceClaim:
    base = {
        "source_platform": "SYNTHETIC-DMS",
        "source_claim_id": "CLM-1042",
        "source_version": "v7",
        "exception_status": ExceptionStatus.RETURNED,
        "submitted_at": date(2026, 8, 1),
        "caller_organization": "Example Equipment Dealers",
        "account_context": "dealer account 4471",
        "counterparty_phone_e164": "+12025550142",
        "economic_policy_id": "standard-pursuit",
        "claim_face_value": Decimal("4820.50"),
        "claim_currency": "USD",
        "documented_code": "R-114",
        "documented_reason": "Returned: supporting documentation incomplete",
        "documented_next_step": None,
        "ordinary_remedies": ALL_THREE_REMEDIES,
        "exhaustion_manifest": manifest(),
    }
    base.update(overrides)
    return SourceClaim(**base)


def test_a_complete_snapshot_passes():
    decision = validate_source_claim(claim(), on=ON)
    assert decision.ok
    assert decision.refusals == ()


def test_missing_identities_are_refused():
    decision = validate_source_claim(
        claim(source_platform="  ", source_claim_id="", source_version=""),
        on=ON,
    )
    refusals = set(decision.refusals)
    assert EnvelopeRefusal.MISSING_SOURCE_PLATFORM in refusals
    assert EnvelopeRefusal.MISSING_SOURCE_CLAIM_ID in refusals
    assert EnvelopeRefusal.MISSING_SOURCE_VERSION in refusals


def test_a_number_that_is_not_e164_is_refused():
    decision = validate_source_claim(
        claim(counterparty_phone_e164="2025550142"), on=ON
    )
    assert EnvelopeRefusal.INVALID_PHONE in decision.refusals


def test_a_value_without_a_currency_is_refused_and_vice_versa():
    value_only = validate_source_claim(claim(claim_currency=None), on=ON)
    assert EnvelopeRefusal.VALUE_WITHOUT_CURRENCY in value_only.refusals
    currency_only = validate_source_claim(claim(claim_face_value=None), on=ON)
    assert EnvelopeRefusal.CURRENCY_WITHOUT_VALUE in currency_only.refusals


def test_an_explicitly_unknown_value_is_a_valid_snapshot():
    decision = validate_source_claim(
        claim(claim_face_value=None, claim_currency=None), on=ON
    )
    assert decision.ok
    # Unknown value is legal at the envelope; the economic gate owns whether
    # the organization's policy tolerates it.


def test_a_submission_in_the_future_is_refused():
    decision = validate_source_claim(claim(submitted_at=date(2026, 9, 8)), on=ON)
    assert EnvelopeRefusal.SUBMITTED_IN_THE_FUTURE in decision.refusals


def test_a_remedy_without_an_outcome_is_refused():
    decision = validate_source_claim(
        claim(
            ordinary_remedies=(OrdinaryRemedy("portal_status_check", "  "),)
        ),
        on=ON,
    )
    assert EnvelopeRefusal.REMEDY_MISSING_OUTCOME in decision.refusals


def test_from_dict_parses_the_value_as_a_decimal_never_a_float():
    parsed = source_claim_from_dict(
        {
            "source_platform": "SYNTHETIC-DMS",
            "source_claim_id": "CLM-1042",
            "source_version": "v7",
            "exception_status": "RETURNED",
            "submitted_at": "2026-08-01",
            "caller_organization": "Example Equipment Dealers",
            "account_context": "dealer account 4471",
            "counterparty_phone_e164": "+12025550142",
            "economic_policy_id": "standard-pursuit",
            "claim_face_value": "4820.50",
            "claim_currency": "USD",
        }
    )
    assert isinstance(parsed.claim_face_value, Decimal)
    assert parsed.claim_face_value == Decimal("4820.50")
    assert parsed.exception_status is ExceptionStatus.RETURNED
    assert parsed.claim_age_days(ON) == 31
    assert parsed.identity() == "SYNTHETIC-DMS/CLM-1042"


def test_from_dict_refuses_a_malformed_value_loudly():
    with pytest.raises(ValueError):
        source_claim_from_dict(
            {
                "source_platform": "SYNTHETIC-DMS",
                "source_claim_id": "CLM-1042",
                "source_version": "v7",
                "exception_status": "RETURNED",
                "submitted_at": "2026-08-01",
                "caller_organization": "Example Equipment Dealers",
                "account_context": "dealer account 4471",
                "counterparty_phone_e164": "+12025550142",
                "economic_policy_id": "standard-pursuit",
                "claim_face_value": "not-a-number",
            }
        )


def test_an_envelope_without_a_manifest_is_refused():
    decision = validate_source_claim(claim(exhaustion_manifest=None), on=ON)
    assert not decision.ok
    assert decision.refusals == (EnvelopeRefusal.MISSING_EXHAUSTION_MANIFEST,)


def test_a_manifest_bound_to_a_different_source_version_is_incomplete():
    decision = validate_source_claim(
        claim(exhaustion_manifest=manifest(source_version="v6")), on=ON
    )
    assert EnvelopeRefusal.EXHAUSTION_MANIFEST_INCOMPLETE in decision.refusals


def test_a_manifest_with_no_routes_is_incomplete():
    decision = validate_source_claim(
        claim(exhaustion_manifest=manifest(routes=())), on=ON
    )
    assert EnvelopeRefusal.EXHAUSTION_MANIFEST_INCOMPLETE in decision.refusals


def test_a_manifest_with_a_silent_route_is_incomplete():
    decision = validate_source_claim(
        claim(
            exhaustion_manifest=manifest(
                routes=(ExhaustionRoute("portal_status_check", "  "),)
            )
        ),
        on=ON,
    )
    assert EnvelopeRefusal.EXHAUSTION_MANIFEST_INCOMPLETE in decision.refusals


def test_a_manifest_without_an_information_gap_is_incomplete():
    decision = validate_source_claim(
        claim(exhaustion_manifest=manifest(information_gap="   ")), on=ON
    )
    assert EnvelopeRefusal.EXHAUSTION_MANIFEST_INCOMPLETE in decision.refusals


def test_validate_exhaustion_manifest_names_none_as_missing():
    refusals = validate_exhaustion_manifest(claim(), None)
    assert refusals == (EnvelopeRefusal.MISSING_EXHAUSTION_MANIFEST,)


def test_manifest_from_dict_round_trips_routes_and_gap():
    parsed = manifest_from_dict(
        {
            "source_version": "v7",
            "routes": [
                {
                    "channel": "portal_status_check",
                    "outcome": "portal repeats code R-114",
                    "attempted_at": "2026-08-12",
                },
                {"channel": "written_follow_up", "outcome": "no reply"},
            ],
            "information_gap": GAP,
        }
    )
    assert parsed.source_version == "v7"
    assert parsed.channels() == ("portal_status_check", "written_follow_up")
    assert parsed.routes[0].attempted_at == date(2026, 8, 12)
    assert parsed.routes[1].attempted_at is None
    assert parsed.information_gap == GAP
    decision = validate_source_claim(claim(exhaustion_manifest=parsed), on=ON)
    assert decision.ok


def test_source_claim_from_dict_parses_the_manifest():
    parsed = source_claim_from_dict(
        {
            "source_platform": "SYNTHETIC-DMS",
            "source_claim_id": "CLM-1042",
            "source_version": "v7",
            "exception_status": "RETURNED",
            "submitted_at": "2026-08-01",
            "caller_organization": "Example Equipment Dealers",
            "account_context": "dealer account 4471",
            "counterparty_phone_e164": "+12025550142",
            "economic_policy_id": "standard-pursuit",
            "exhaustion_manifest": {
                "source_version": "v7",
                "routes": [
                    {"channel": "portal_status_check", "outcome": "no detail"},
                ],
                "information_gap": GAP,
            },
        }
    )
    assert parsed.exhaustion_manifest is not None
    assert parsed.exhaustion_manifest.channels() == ("portal_status_check",)


# --- the remaining named refusals and the decision surface --------------------


def test_missing_envelope_facts_are_each_refused_by_name():
    decision = validate_source_claim(
        claim(
            economic_policy_id="  ",
            caller_organization="",
            account_context="",
            submitted_at=None,
        ),
        on=ON,
    )
    values = {refusal.value for refusal in decision.refusals}
    assert {
        "MISSING_POLICY_ID",
        "MISSING_ORGANIZATION",
        "MISSING_ACCOUNT_CONTEXT",
        "MISSING_SUBMITTED_AT",
    } <= values


def test_a_negative_value_or_a_malformed_currency_is_refused():
    negative = validate_source_claim(
        claim(claim_face_value=Decimal("-1")), on=ON
    )
    malformed = validate_source_claim(claim(claim_currency="us dollars"), on=ON)
    assert EnvelopeRefusal.INVALID_CLAIM_VALUE in negative.refusals
    assert EnvelopeRefusal.INVALID_CLAIM_VALUE in malformed.refusals


def test_a_remedy_without_a_channel_is_refused():
    from warrantyops.envelope import OrdinaryRemedy

    decision = validate_source_claim(
        claim(ordinary_remedies=(OrdinaryRemedy("  ", "no detail"),)), on=ON
    )
    assert EnvelopeRefusal.REMEDY_MISSING_CHANNEL in decision.refusals


def test_the_decisions_render_as_dicts():
    ok = validate_source_claim(claim(), on=ON)
    refused = validate_source_claim(claim(counterparty_phone_e164="202"), on=ON)
    assert ok.to_dict() == {"ok": True, "refusals": []}
    assert refused.to_dict()["ok"] is False
    assert refused.to_dict()["refusals"] == [
        refusal.value for refusal in refused.refusals
    ]
    assert manifest().to_dict()["source_version"] == "v7"
