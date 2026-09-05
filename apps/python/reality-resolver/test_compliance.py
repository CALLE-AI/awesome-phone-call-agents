"""Unit tests proving the populated jurisdiction rules behave correctly:
fully-compliant contexts are allowed, each individual missing/failing
flag blocks the call on its own, and the documented gray-area exceptions
are marked at MEDIUM confidence so they can never be mistaken for
settled law.

These tests do not touch the network at all - they exercise
compliance/dispatcher.py and compliance/jurisdictions/*.py directly.

Fixed timestamps (2026-08-25 is a Tuesday, 2026-08-29 is a Saturday) are
used everywhere instead of the real current time, via PreCallContext's
now_utc override, so these tests are not time-of-day- or day-of-week-
dependent.
"""

from __future__ import annotations

from dataclasses import replace
from datetime import UTC, datetime, timedelta

from compliance.dispatcher import (
    UnknownJurisdictionError,
    resolve_jurisdiction_chain,
    resolve_locale_and_region,
    run_precall_checks,
)
from compliance.jurisdictions import fr, us_federal
from compliance.models import ConfidenceLevel, PreCallContext, compute_consent_retention_expiry

# --- US federal fixtures -----------------------------------------------

US_PHONE = "+12025550123"
US_TIMEZONE = "America/New_York"  # UTC-4 (EDT) in August
US_IN_WINDOW_NOW = datetime(2026, 8, 25, 14, 0, tzinfo=UTC)  # 10:00 local NY, within 8-21
US_OUTSIDE_WINDOW_NOW = datetime(2026, 8, 26, 2, 0, tzinfo=UTC)  # 22:00 local NY on Aug 25, outside 8-21

US_COMPLIANT_CONTEXT = PreCallContext(
    phone_e164=US_PHONE,
    consent_obtained=True,
    consent_timestamp=datetime(2026, 8, 20, 12, 0, tzinfo=UTC),  # well before the call
    dnc_checked=True,
    recipient_timezone=US_TIMEZONE,
    now_utc=US_IN_WINDOW_NOW,
)

# --- France (+ eu_common) fixtures --------------------------------------

FR_PHONE = "+33639980456"  # ARCEP Numbering Plan Art. 2.5.12 reserved mobile block "06 39 98"
FR_TIMEZONE = "Europe/Paris"  # UTC+2 (CEST) in August
FR_TUESDAY_MORNING_NOW = datetime(2026, 8, 25, 9, 0, tzinfo=UTC)  # 11:00 local Paris, Tuesday, morning window
FR_TUESDAY_LUNCH_GAP_NOW = datetime(2026, 8, 25, 11, 30, tzinfo=UTC)  # 13:30 local Paris, Tuesday, lunch gap
FR_SATURDAY_NOW = datetime(2026, 8, 29, 9, 0, tzinfo=UTC)  # 11:00 local Paris, Saturday

FR_COMPLIANT_CONTEXT = PreCallContext(
    phone_e164=FR_PHONE,
    consent_obtained=True,
    dnc_checked=True,
    gdpr_basis_documented=True,
    recipient_timezone=FR_TIMEZONE,
    now_utc=FR_TUESDAY_MORNING_NOW,
)

# --- Oregon (+ us_federal) fixtures -------------------------------------

OREGON_PHONE = "+15035550100"  # NANP reserved block NPA-555-01XX, Oregon area code 503
OREGON_TIMEZONE = "America/Los_Angeles"  # UTC-7 (PDT) in August
OREGON_IN_WINDOW_NOW = datetime(2026, 8, 25, 19, 0, tzinfo=UTC)  # 12:00 local Portland, within 8-20
OREGON_OUTSIDE_WINDOW_NOW = datetime(2026, 8, 26, 4, 0, tzinfo=UTC)  # 21:00 local Portland on Aug 25, outside 8-20

OREGON_COMPLIANT_CONTEXT = PreCallContext(
    phone_e164=OREGON_PHONE,
    consent_obtained=True,
    consent_timestamp=datetime(2026, 8, 20, 12, 0, tzinfo=UTC),
    dnc_checked=True,
    recipient_timezone=OREGON_TIMEZONE,
    now_utc=OREGON_IN_WINDOW_NOW,
    solicitations_in_last_24h=0,
)


def reasons_for(decision, check_name: str) -> list[str]:
    return [r.reason for r in decision.results if r.check_name == check_name]


# --- jurisdiction chain resolution --------------------------------------


def test_us_number_resolves_to_us_federal_only() -> None:
    assert resolve_jurisdiction_chain(US_PHONE) == ("us_federal",)


def test_france_number_resolves_to_eu_common_then_fr() -> None:
    assert resolve_jurisdiction_chain(FR_PHONE) == ("eu_common", "fr")


def test_resolve_locale_and_region_for_us_federal() -> None:
    assert resolve_locale_and_region(("us_federal",)) == ("en-US", "US", us_federal.DISCLOSURE_SCRIPT)


def test_resolve_locale_and_region_for_france_stacks_on_eu_common() -> None:
    # fr defines its own disclosure_script - most specific wins over eu_common's.
    assert resolve_locale_and_region(("eu_common", "fr")) == ("fr-FR", "FR", fr.DISCLOSURE_SCRIPT)


def test_resolve_locale_and_region_for_empty_chain() -> None:
    assert resolve_locale_and_region(()) == (None, None, None)


def test_unmapped_country_code_raises_and_blocks() -> None:
    # +44 is unmapped in this app's dispatcher, same as any other country
    # not yet wired in. Uses Ofcom's officially reserved drama mobile
    # block (07700 900000-07700 900999) rather than an arbitrary UK
    # number, since no Japan number was safe to use here: unlike the US
    # (555-01xx) and France (ARCEP Art. 2.5.12), Japan's regulator has no
    # documented reserved fictional block.
    unmapped_phone = "+447700900123"
    try:
        resolve_jurisdiction_chain(unmapped_phone)
        assert False, "expected UnknownJurisdictionError"
    except UnknownJurisdictionError:
        pass

    decision = run_precall_checks(PreCallContext(phone_e164=unmapped_phone))
    assert decision.allowed is False
    assert decision.jurisdiction_chain == ()


# --- US federal: fully compliant, and each flag individually ------------


def test_us_fully_compliant_context_is_allowed() -> None:
    decision = run_precall_checks(US_COMPLIANT_CONTEXT)
    assert decision.allowed is True
    assert decision.jurisdiction_chain == ("us_federal",)
    assert all(r.passed for r in decision.results)


def test_us_missing_consent_blocks() -> None:
    context = replace(US_COMPLIANT_CONTEXT, consent_obtained=False, consent_timestamp=None)
    decision = run_precall_checks(context)
    assert decision.allowed is False
    assert reasons_for(decision, "us_federal_consent")[0].startswith("prior express written consent")


def test_us_missing_dnc_scrub_blocks() -> None:
    context = replace(US_COMPLIANT_CONTEXT, dnc_checked=False)
    decision = run_precall_checks(context)
    assert decision.allowed is False
    assert "dnc_checked=False" in reasons_for(decision, "us_federal_dnc_scrub")[0]


def test_us_revocation_requested_blocks_even_if_everything_else_is_compliant() -> None:
    context = replace(US_COMPLIANT_CONTEXT, do_not_call_requested=True)
    decision = run_precall_checks(context)
    assert decision.allowed is False
    assert "revoked" in reasons_for(decision, "us_federal_revocation")[0]


def test_us_outside_window_without_recent_consent_blocks() -> None:
    context = replace(US_COMPLIANT_CONTEXT, now_utc=US_OUTSIDE_WINDOW_NOW)
    decision = run_precall_checks(context)
    assert decision.allowed is False
    assert "outside" in reasons_for(decision, "us_federal_calling_window")[0]


def test_us_recent_consent_lifts_window_at_medium_confidence() -> None:
    # Consent obtained 5 minutes before an otherwise-outside-window call.
    context = replace(
        US_COMPLIANT_CONTEXT,
        now_utc=US_OUTSIDE_WINDOW_NOW,
        consent_timestamp=US_OUTSIDE_WINDOW_NOW - timedelta(minutes=5),
    )
    decision = run_precall_checks(context)
    assert decision.allowed is True
    window_result = [r for r in decision.results if r.check_name == "us_federal_calling_window"][0]
    assert window_result.passed is True
    assert window_result.confidence == ConfidenceLevel.MEDIUM


def test_us_missing_timezone_blocks() -> None:
    context = replace(US_COMPLIANT_CONTEXT, recipient_timezone=None)
    decision = run_precall_checks(context)
    assert decision.allowed is False
    assert "recipient_timezone is required" in reasons_for(decision, "us_federal_calling_window")[0]


# --- France (+ eu_common): fully compliant, and each flag individually --


def test_fr_fully_compliant_context_is_allowed() -> None:
    decision = run_precall_checks(FR_COMPLIANT_CONTEXT)
    assert decision.allowed is True
    assert decision.jurisdiction_chain == ("eu_common", "fr")
    assert all(r.passed for r in decision.results)


def test_fr_missing_consent_blocks_on_both_layers() -> None:
    context = replace(FR_COMPLIANT_CONTEXT, consent_obtained=False)
    decision = run_precall_checks(context)
    assert decision.allowed is False
    assert reasons_for(decision, "eu_common_consent")
    assert reasons_for(decision, "fr_consent")


def test_fr_missing_gdpr_basis_blocks() -> None:
    context = replace(FR_COMPLIANT_CONTEXT, gdpr_basis_documented=False)
    decision = run_precall_checks(context)
    assert decision.allowed is False
    assert reasons_for(decision, "eu_common_gdpr_basis")


def test_fr_missing_dnc_scrub_blocks() -> None:
    context = replace(FR_COMPLIANT_CONTEXT, dnc_checked=False)
    decision = run_precall_checks(context)
    assert decision.allowed is False
    assert "Bloctel" in reasons_for(decision, "fr_dnc_scrub")[0]


def test_fr_revocation_requested_blocks() -> None:
    context = replace(FR_COMPLIANT_CONTEXT, do_not_call_requested=True)
    decision = run_precall_checks(context)
    assert decision.allowed is False


def test_fr_lunch_gap_blocks() -> None:
    context = replace(FR_COMPLIANT_CONTEXT, now_utc=FR_TUESDAY_LUNCH_GAP_NOW)
    decision = run_precall_checks(context)
    assert decision.allowed is False
    assert "outside the allowed windows" in reasons_for(decision, "fr_calling_window")[0]


def test_fr_weekend_blocks_regardless_of_hour() -> None:
    context = replace(FR_COMPLIANT_CONTEXT, now_utc=FR_SATURDAY_NOW)
    decision = run_precall_checks(context)
    assert decision.allowed is False
    assert "not an allowed calling day" in reasons_for(decision, "fr_calling_window")[0]


def test_fr_calling_window_pass_is_medium_confidence_due_to_holiday_gap() -> None:
    decision = run_precall_checks(FR_COMPLIANT_CONTEXT)
    window_result = [r for r in decision.results if r.check_name == "fr_calling_window"][0]
    assert window_result.passed is True
    assert window_result.confidence == ConfidenceLevel.MEDIUM


def test_eu_common_consent_check_is_medium_confidence_regardless_of_outcome() -> None:
    allowed_decision = run_precall_checks(FR_COMPLIANT_CONTEXT)
    passing_consent = [r for r in allowed_decision.results if r.check_name == "eu_common_consent"][0]
    assert passing_consent.confidence == ConfidenceLevel.MEDIUM

    blocked_decision = run_precall_checks(replace(FR_COMPLIANT_CONTEXT, consent_obtained=False))
    failing_consent = [r for r in blocked_decision.results if r.check_name == "eu_common_consent"][0]
    assert failing_consent.confidence == ConfidenceLevel.MEDIUM


# --- Oregon: first US state-level variation, routed by area code --------


def test_oregon_area_code_resolves_to_us_federal_then_us_oregon() -> None:
    assert resolve_jurisdiction_chain(OREGON_PHONE) == ("us_federal", "us_oregon")


def test_non_oregon_us_number_still_resolves_to_us_federal_only() -> None:
    assert resolve_jurisdiction_chain(US_PHONE) == ("us_federal",)


def test_resolve_locale_and_region_for_oregon() -> None:
    # us_oregon.disclosure_script is None - inherits us_federal's.
    assert resolve_locale_and_region(("us_federal", "us_oregon")) == ("en-US", "US", us_federal.DISCLOSURE_SCRIPT)


def test_oregon_fully_compliant_context_is_allowed() -> None:
    decision = run_precall_checks(OREGON_COMPLIANT_CONTEXT)
    assert decision.allowed is True
    assert decision.jurisdiction_chain == ("us_federal", "us_oregon")
    assert all(r.passed for r in decision.results)


def test_oregon_outside_window_blocks() -> None:
    context = replace(OREGON_COMPLIANT_CONTEXT, now_utc=OREGON_OUTSIDE_WINDOW_NOW)
    decision = run_precall_checks(context)
    assert decision.allowed is False
    assert "outside" in reasons_for(decision, "us_oregon_calling_window")[0]


def test_oregon_solicitation_cap_missing_blocks() -> None:
    context = replace(OREGON_COMPLIANT_CONTEXT, solicitations_in_last_24h=None)
    decision = run_precall_checks(context)
    assert decision.allowed is False
    assert "not attested" in reasons_for(decision, "us_oregon_solicitation_cap")[0]


def test_oregon_solicitation_cap_at_limit_blocks() -> None:
    context = replace(OREGON_COMPLIANT_CONTEXT, solicitations_in_last_24h=3)
    decision = run_precall_checks(context)
    assert decision.allowed is False
    assert "already recorded" in reasons_for(decision, "us_oregon_solicitation_cap")[0]


def test_oregon_solicitation_cap_under_limit_passes() -> None:
    context = replace(OREGON_COMPLIANT_CONTEXT, solicitations_in_last_24h=2)
    decision = run_precall_checks(context)
    cap_result = [r for r in decision.results if r.check_name == "us_oregon_solicitation_cap"][0]
    assert cap_result.passed is True


def test_oregon_revocation_blocks() -> None:
    context = replace(OREGON_COMPLIANT_CONTEXT, do_not_call_requested=True)
    decision = run_precall_checks(context)
    assert decision.allowed is False
    assert reasons_for(decision, "us_oregon_revocation")


# --- Consent-record retention (FTC TSR / Germany UWG Sec. 7a) -----------


def test_compute_consent_retention_expiry_anchors_on_later_call_time() -> None:
    consent = datetime(2026, 1, 1, tzinfo=UTC)
    call = datetime(2026, 8, 20, 12, 0, tzinfo=UTC)
    assert compute_consent_retention_expiry(consent, call) == datetime(2031, 8, 20, 12, 0, tzinfo=UTC)


def test_compute_consent_retention_expiry_anchors_on_later_consent_time() -> None:
    consent = datetime(2026, 8, 20, 12, 0, tzinfo=UTC)
    call = datetime(2026, 1, 1, tzinfo=UTC)
    assert compute_consent_retention_expiry(consent, call) == datetime(2031, 8, 20, 12, 0, tzinfo=UTC)


def test_compute_consent_retention_expiry_handles_leap_day_anchor() -> None:
    consent = datetime(2028, 2, 29, 12, 0, tzinfo=UTC)  # 2028 is a leap year
    call = datetime(2028, 1, 1, tzinfo=UTC)
    # 2033 is not a leap year, so Feb 29 falls back to Feb 28.
    assert compute_consent_retention_expiry(consent, call) == datetime(2033, 2, 28, 12, 0, tzinfo=UTC)
