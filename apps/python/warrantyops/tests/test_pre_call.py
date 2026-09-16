"""Pre-call gates: residual necessity, organization-owned economics, disclosure,
and the source-version re-read. All pure, all supplied facts."""

from __future__ import annotations

import inspect
from datetime import date
from decimal import Decimal

from warrantyops.disclosure import (
    DISCLOSURE_ALLOWLIST,
    build_disclosure,
    disclosure_violations,
)
from warrantyops.envelope import (
    ExceptionStatus,
    ExhaustionManifest,
    ExhaustionRoute,
    OrdinaryRemedy,
    SourceClaim,
)
from warrantyops.gates import (
    DEFAULT_POLICY_BOOK,
    EconomicPolicy,
    EconomicRefusal,
    ResidualRefusal,
    VersionRefusal,
    assess_economics,
    assess_residual_necessity,
    check_source_version,
)
from warrantyops.source import InMemorySourceStore

ON = date(2026, 9, 1)

ALL_THREE = (
    OrdinaryRemedy("portal_status_check", "portal repeats the code, no detail"),
    OrdinaryRemedy("documented_code_resolution", "code sheet does not cover it"),
    OrdinaryRemedy("written_follow_up", "two emails, no reply"),
)

GAP = "the source record does not state what is missing from the return"


def manifest(routes=None, **overrides) -> ExhaustionManifest:
    base = {
        "source_version": "v7",
        "routes": routes
        if routes is not None
        else (
            ExhaustionRoute("portal_status_check", "portal repeats the code"),
            ExhaustionRoute("documented_code_resolution", "code sheet does not cover it"),
            ExhaustionRoute("written_follow_up", "two emails, no reply"),
        ),
        "information_gap": GAP,
    }
    base.update(overrides)
    return ExhaustionManifest(**base)


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
        "ordinary_remedies": ALL_THREE,
        "exhaustion_manifest": manifest(),
    }
    base.update(overrides)
    return SourceClaim(**base)


# --- residual necessity -----------------------------------------------------


def test_exhausted_routes_and_an_unanswered_source_allow_the_call():
    decision = assess_residual_necessity(claim())
    assert decision.allowed
    assert decision.refusals == ()
    assert decision.missing_remedies == ()


def test_a_missing_ordinary_route_refuses_the_call():
    decision = assess_residual_necessity(
        claim(
            ordinary_remedies=ALL_THREE[:2],
            exhaustion_manifest=manifest(routes=manifest().routes[:2]),
        )
    )
    assert decision.allowed is False
    assert ResidualRefusal.ORDINARY_ROUTE_NOT_EXHAUSTED in decision.refusals
    assert decision.missing_remedies == ("written_follow_up",)


def test_the_manifest_not_the_flat_log_decides_exhaustion():
    """The manifest is the operative record: a flat remedy log that claims a
    route the manifest does not show cannot widen what was attempted."""

    decision = assess_residual_necessity(
        claim(exhaustion_manifest=manifest(routes=manifest().routes[:2]))
    )
    assert decision.allowed is False
    assert decision.missing_remedies == ("written_follow_up",)


def test_a_source_that_states_the_next_step_refuses_the_call():
    """The core residual rule: a portal that says what to do next needs no call."""

    decision = assess_residual_necessity(
        claim(documented_next_step="Resubmit with the hour-meter certificate")
    )
    assert decision.allowed is False
    assert ResidualRefusal.SOURCE_ALREADY_ANSWERS in decision.refusals


def test_a_reason_without_a_next_step_still_leaves_a_residual_question():
    decision = assess_residual_necessity(
        claim(documented_reason="Returned: documentation incomplete")
    )
    assert decision.allowed


def test_the_required_route_set_is_organization_owned_not_widened():
    from warrantyops.gates import DEFAULT_REQUIRED_REMEDIES

    assert set(DEFAULT_REQUIRED_REMEDIES) >= {
        "portal_status_check",
        "documented_code_resolution",
    }


# --- economics --------------------------------------------------------------


def test_a_value_above_the_supplied_threshold_is_eligible():
    decision = assess_economics(claim(), policy_book=DEFAULT_POLICY_BOOK, on=ON)
    assert decision.allowed
    assert decision.policy_id == "standard-pursuit"


def test_a_value_below_the_supplied_threshold_is_refused():
    decision = assess_economics(
        claim(claim_face_value=Decimal("100.00")), policy_book=DEFAULT_POLICY_BOOK, on=ON
    )
    assert decision.allowed is False
    assert EconomicRefusal.BELOW_MINIMUM_VALUE in decision.refusals


def test_an_unknown_value_is_refused_unless_the_policy_says_otherwise():
    decision = assess_economics(
        claim(claim_face_value=None, claim_currency=None),
        policy_book=DEFAULT_POLICY_BOOK,
        on=ON,
    )
    assert decision.allowed is False
    assert EconomicRefusal.CLAIM_VALUE_UNKNOWN in decision.refusals

    tolerant = {
        "tolerant": EconomicPolicy(
            policy_id="tolerant",
            currency="USD",
            minimum_claim_value=Decimal("250.00"),
            pursue_when_value_unknown=True,
        )
    }
    decision = assess_economics(
        claim(claim_face_value=None, claim_currency=None, economic_policy_id="tolerant"),
        policy_book=tolerant,
        on=ON,
    )
    assert decision.allowed


def test_a_currency_the_policy_does_not_use_is_refused():
    decision = assess_economics(
        claim(claim_currency="EUR"), policy_book=DEFAULT_POLICY_BOOK, on=ON
    )
    assert EconomicRefusal.CURRENCY_MISMATCH in decision.refusals


def test_an_unknown_policy_is_refused_not_defaulted():
    decision = assess_economics(
        claim(economic_policy_id="does-not-exist"),
        policy_book=DEFAULT_POLICY_BOOK,
        on=ON,
    )
    assert decision.allowed is False
    assert EconomicRefusal.POLICY_NOT_FOUND in decision.refusals


def test_a_claim_older_than_the_policy_allows_is_refused():
    decision = assess_economics(
        claim(submitted_at=date(2024, 1, 1)),
        policy_book=DEFAULT_POLICY_BOOK,
        on=ON,
    )
    assert EconomicRefusal.CLAIM_TOO_OLD in decision.refusals


def test_the_economic_gate_has_no_estimation_inputs():
    """No parameter through which a value judgement could enter the gate.

    The organization supplies the policy and the record supplies the facts;
    there is nothing else to pass, and a test pins that shut the same way the
    identifier machinery pins out confidence.
    """

    parameters = set(inspect.signature(assess_economics).parameters)
    assert parameters == {"claim", "policy_book", "on"}
    for banned in ("estimate", "probability", "confidence", "roi", "model"):
        assert not any(banned in name for name in parameters)


# --- economics: supplied arithmetic ------------------------------------------


def _policy(**overrides) -> EconomicPolicy:
    base = {
        "policy_id": "priced",
        "currency": "USD",
        "minimum_claim_value": Decimal("250.00"),
        "pursue_when_value_unknown": False,
        "maximum_age_days": 540,
        "maximum_call_cost": Decimal("2.00"),
        "per_call_price": Decimal("1.50"),
    }
    base.update(overrides)
    return EconomicPolicy(**base)


def _value_line(decision) -> dict:
    return next(line for line in decision.arithmetic if "face_value" in line["statement"])


def test_an_allowed_decision_still_emits_its_arithmetic():
    decision = assess_economics(
        claim(economic_policy_id="priced"), policy_book={"priced": _policy()}, on=ON
    )
    assert decision.allowed
    lines = {line["statement"]: line for line in decision.arithmetic}
    assert set(lines) == {
        "claim_face_value >= minimum_claim_value",
        "per_call_price <= maximum_call_cost",
        "claim_age_days <= maximum_age_days",
    }
    assert lines["claim_face_value >= minimum_claim_value"]["holds"] is True
    assert lines["per_call_price <= maximum_call_cost"]["holds"] is True


def test_every_arithmetic_input_names_who_supplied_it():
    decision = assess_economics(
        claim(economic_policy_id="priced"), policy_book={"priced": _policy()}, on=ON
    )
    for line in decision.arithmetic:
        for name, supplied in line["inputs"].items():
            assert supplied["supplied_by"] in ("source record", "organization policy"), (
                f"{name} is not labelled as supplied"
            )


def test_a_value_below_the_minimum_is_not_worth_pursuing():
    decision = assess_economics(
        claim(claim_face_value=Decimal("100.00"), economic_policy_id="priced"),
        policy_book={"priced": _policy()},
        on=ON,
    )
    assert EconomicRefusal.BELOW_MINIMUM_VALUE in decision.refusals
    assert EconomicRefusal.NOT_WORTH_PURSUING in decision.refusals
    assert _value_line(decision)["holds"] is False


def test_not_worth_pursuing_carries_the_arithmetic_that_produced_it():
    decision = assess_economics(
        claim(claim_face_value=Decimal("100.00"), economic_policy_id="priced"),
        policy_book={"priced": _policy()},
        on=ON,
    )
    line = _value_line(decision)
    assert line["inputs"]["claim_face_value"] == {
        "value": "100.00",
        "supplied_by": "source record",
    }
    assert line["inputs"]["minimum_claim_value"] == {
        "value": "250.00",
        "supplied_by": "organization policy",
    }


def test_a_call_above_the_policy_maximum_cost_is_not_worth_pursuing():
    decision = assess_economics(
        claim(economic_policy_id="priced"),
        policy_book={"priced": _policy(per_call_price=Decimal("3.00"))},
        on=ON,
    )
    assert EconomicRefusal.NOT_WORTH_PURSUING in decision.refusals
    cost_line = next(
        line for line in decision.arithmetic if "per_call_price" in line["statement"]
    )
    assert cost_line["holds"] is False
    assert EconomicRefusal.BELOW_MINIMUM_VALUE not in decision.refusals


def test_a_policy_demanding_a_cost_check_refuses_an_unknown_price():
    decision = assess_economics(
        claim(economic_policy_id="priced"),
        policy_book={"priced": _policy(per_call_price=None)},
        on=ON,
    )
    assert decision.allowed is False
    assert EconomicRefusal.CALL_COST_UNKNOWN in decision.refusals
    cost_line = next(
        line for line in decision.arithmetic if "per_call_price" in line["statement"]
    )
    assert cost_line["holds"] is None
    assert cost_line["inputs"]["per_call_price"]["value"] == "unknown"


def test_a_policy_without_a_cost_maximum_never_estimates_one():
    decision = assess_economics(
        claim(economic_policy_id="flat"),
        policy_book={
            "flat": _policy(maximum_call_cost=None, per_call_price=None, policy_id="flat")
        },
        on=ON,
    )
    assert decision.allowed
    assert not any("per_call_price" in line["statement"] for line in decision.arithmetic)


def test_an_unknown_face_value_under_a_tolerant_policy_states_it_never_fills_it():
    decision = assess_economics(
        claim(claim_face_value=None, claim_currency=None, economic_policy_id="tol"),
        policy_book={
            "tol": _policy(
                policy_id="tol", pursue_when_value_unknown=True, maximum_call_cost=None
            )
        },
        on=ON,
    )
    assert decision.allowed
    line = _value_line(decision)
    assert line["holds"] is None
    assert line["inputs"]["claim_face_value"]["value"] == "unknown"


# --- disclosure -------------------------------------------------------------


def test_the_disclosure_payload_carries_only_allowlisted_fields():
    disclosure = build_disclosure(claim())
    assert disclosure_violations(disclosure) == ()
    assert set(disclosure) <= DISCLOSURE_ALLOWLIST


def test_economics_and_authorization_never_reach_the_call():
    disclosure = build_disclosure(claim())
    for banned in (
        "claim_face_value",
        "claim_currency",
        "economic_policy_id",
        "ordinary_remedies",
        "record_reference",
    ):
        assert banned not in disclosure


def test_an_undocumented_code_is_not_asserted_to_the_counterparty():
    disclosure = build_disclosure(claim(documented_code=None))
    assert "documented_code" not in disclosure


def test_the_allowlist_catches_a_smuggled_field():
    assert disclosure_violations({"claim_face_value": "4820.50"}) == (
        "claim_face_value",
    )


# --- source version ---------------------------------------------------------


def test_a_matching_live_version_passes():
    store = InMemorySourceStore()
    store.set_version("SYNTHETIC-DMS", "CLM-1042", "v7")
    decision = check_source_version(claim(), store)
    assert decision.matches
    assert decision.refusals == ()


def test_a_moved_source_refuses_with_the_current_version_reported():
    store = InMemorySourceStore()
    store.set_version("SYNTHETIC-DMS", "CLM-1042", "v8")
    decision = check_source_version(claim(), store)
    assert decision.matches is False
    assert VersionRefusal.SOURCE_CHANGED in decision.refusals
    assert decision.current_version == "v8"
    assert decision.envelope_version == "v7"


def test_an_unknown_claim_is_a_source_change_not_a_pass():
    decision = check_source_version(claim(), InMemorySourceStore())
    assert decision.matches is False
    assert decision.current_version is None


# --- the decision surfaces, and the manifest-free residual read ---------------


def test_without_a_manifest_the_residual_gate_reads_the_flat_remedy_log():
    """The envelope gate refuses a missing manifest before this gate runs;
    the direct call still reads the ordinary-remedies log rather than silently
    passing, which is what keeps an honest direct call honest."""

    decision = assess_residual_necessity(claim(exhaustion_manifest=None))
    assert decision.allowed
    assert decision.to_dict() == {
        "allowed": True,
        "refusals": [],
        "missing_remedies": [],
    }


def test_every_gate_decision_renders_as_a_dict():
    economics = assess_economics(claim(), policy_book=DEFAULT_POLICY_BOOK, on=ON)
    economics_dict = economics.to_dict()
    assert economics_dict["allowed"] is True
    assert economics_dict["arithmetic"]  # the arithmetic is shown, not hidden

    store = InMemorySourceStore()
    store.set_version("SYNTHETIC-DMS", "CLM-1042", "v7")
    version_dict = check_source_version(claim(), store).to_dict()
    assert version_dict == {
        "matches": True,
        "envelope_version": "v7",
        "current_version": "v7",
        "refusals": [],
    }
