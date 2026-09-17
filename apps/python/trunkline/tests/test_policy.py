"""Destination validation, masking, and calling windows."""
from __future__ import annotations

from datetime import datetime

import pytest

from trunkline import policy


@pytest.mark.parametrize("number", ["+12125550142", "+13125550188"])
def test_a_valid_us_number_is_accepted(number):
    assert policy.validate_destination(number, "US") == number


def test_a_valid_australian_mobile_number_is_accepted():
    number = "+61400000000"
    assert policy.validate_destination(number, "AU") == number


@pytest.mark.parametrize("number", ["+610400000000", "+6140000000", "+614000000000"])
def test_an_invalid_australian_number_is_refused(number):
    with pytest.raises(policy.PolicyError):
        policy.validate_destination(number, "AU")


@pytest.mark.parametrize(
    "number",
    ["2125550142", "+1212555014", "+1 212 555 0142", "+11125550142", "+19005550142", "tel:+12125550142"],
)
def test_a_bad_number_is_refused(number):
    with pytest.raises(policy.PolicyError):
        policy.validate_destination(number, "US")


def test_an_unconfigured_region_is_refused():
    with pytest.raises(policy.PolicyError):
        policy.validate_destination("+33142345678", "FR")


def test_a_number_from_another_region_is_refused():
    with pytest.raises(policy.PolicyError):
        policy.validate_destination("+442075550142", "US")


def test_masking_keeps_only_the_country_code_and_last_two_digits():
    assert policy.mask_phone("+12125550142") == "+12*******42"
    assert policy.mask_phone("") == "unknown"


def test_the_calling_window_excludes_weekends():
    saturday = datetime(2026, 9, 12, 10, 0)
    weekday = datetime(2026, 9, 10, 10, 0)
    assert not policy.within_window(saturday, "08:00-17:00")
    assert policy.within_window(weekday, "08:00-17:00")
    assert not policy.within_window(datetime(2026, 9, 10, 19, 0), "08:00-17:00")


def test_a_malformed_window_is_refused():
    with pytest.raises(policy.PolicyError):
        policy.parse_window("17:00-08:00")
    with pytest.raises(policy.PolicyError):
        policy.parse_window("morning")


def test_every_workflow_has_an_envelope_and_no_forbidden_field():
    from trunkline import workflows

    for name in workflows.names():
        envelope = policy.DISCLOSURE_ENVELOPES[name]
        assert envelope, name
        assert not set(envelope) & set(policy.NEVER_DISCLOSE), name
        assert set(envelope) <= set(policy.VAULT_FIELDS), name


def test_the_boundaries_block_forbids_commitments():
    text = policy.boundaries_block().lower()
    for phrase in ("appeal", "never accept", "ai assistant", "recorded"):
        assert phrase in text


def test_days_until_rejects_a_bad_date():
    with pytest.raises(policy.PolicyError):
        policy.days_until("25-01-2027")
