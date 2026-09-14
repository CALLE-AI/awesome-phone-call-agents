"""Requirement 4 of docs/SAFETY.md: strict ASCII E.164, before any live call.

Rejected, never repaired. No stripping of spaces, no adding a country code, no
inferring +44 from a leading 0 -- guessing a destination means guessing whose
telephone rings.
"""

from __future__ import annotations

import pytest

from reachable.phone import (
    InvalidPhoneNumber,
    is_drama_number,
    is_e164,
    mask,
    validate_e164,
)


@pytest.mark.parametrize(
    "number",
    [
        "+447700900123",
        "+447700900000",
        "+12025550123",
        "+61212345678",
        "+12345678",       # shortest allowed: + then 8 digits
        "+123456789012345",  # longest allowed: + then 15 digits
    ],
)
def test_valid_numbers_pass_unchanged(number):
    assert validate_e164(number) == number
    assert is_e164(number)


@pytest.mark.parametrize(
    ("number", "because"),
    [
        ("07700900123", "missing +"),
        ("447700900123", "missing +"),
        ("+44 7700 900123", "spaces"),
        ("+44-7700-900123", "dashes"),
        ("+44(0)7700900123", "brackets"),
        ("+0447700900123", "country code starts with zero"),
        ("+4477009", "too short"),
        ("+4416329600012345", "too long"),
        ("+", "no digits"),
        ("", "empty"),
        ("   ", "whitespace only"),
        (" +447700900123", "leading whitespace"),
        ("+447700900123 ", "trailing whitespace"),
        ("+447700900123\n", "trailing newline"),
        ("+44770090012a", "letter"),
        ("tel:+447700900123", "scheme prefix"),
    ],
)
def test_invalid_numbers_are_refused(number, because):
    assert not is_e164(number), because
    with pytest.raises(InvalidPhoneNumber):
        validate_e164(number)


@pytest.mark.parametrize(
    "number",
    [
        "+٤٤٧٧٠٠٩٠٠١٢٣",        # Arabic-Indic digits
        "+４４７７００９００１２３",  # full-width digits
        "+44770090012³",          # superscript three
        "+447700900１23",         # one full-width digit hidden in ASCII
        "+447700900123​",    # zero-width space
    ],
)
def test_unicode_digits_are_refused_not_normalised(number):
    """The trap this guards against.

    Unicode decimal digits satisfy ``str.isdigit`` and are silently normalised
    to ASCII by ``int()``. A naive check would accept these and then dial a
    number the office never typed.
    """
    assert not is_e164(number)
    with pytest.raises(InvalidPhoneNumber) as excinfo:
        validate_e164(number)
    assert "ASCII" in excinfo.value.reason or "whitespace" in excinfo.value.reason


def test_none_is_refused():
    with pytest.raises(InvalidPhoneNumber):
        validate_e164(None)


def test_reason_is_human_readable_for_the_office():
    with pytest.raises(InvalidPhoneNumber) as excinfo:
        validate_e164("07700900123")
    assert "country code" in excinfo.value.reason


def test_masking_shows_only_the_last_three_digits():
    assert mask("+447700900123") == "…123"
    assert mask("+12025550123") == "…123"
    assert mask(None) == "***"
    assert mask("") == "***"
    assert mask("12") == "***"


def test_masking_never_reveals_the_full_number():
    number = "+447700900456"
    masked = mask(number)
    assert number not in masked
    assert len(masked) < len(number)


def test_drama_range_detection():
    assert is_drama_number("+447700900000")
    assert is_drama_number("+447700900999")
    assert is_drama_number("+447700900123")
    # Reserved landline range: outside the mobile fixture range, still unable to ring.
    assert not is_drama_number("+441632960123")
    assert not is_drama_number("+12025550123")  # US 555 reserved range
    assert not is_drama_number("+12025550123")


@pytest.mark.parametrize(
    "number",
    [
        "+4407700900123",   # a drama number with the trunk 0 left in
        "+440123456789",
    ],
)
def test_a_uk_trunk_prefix_is_refused_not_repaired(number):
    """E.164 syntax alone accepts "+44" followed by the leading 0.

    It is structurally valid and is not the number anybody meant. This was found
    when an operator pasted their number in national form: it passed validation
    and was written into a fixture before being reverted. Dropping the zero
    would be guessing whose telephone rings, so it is refused instead.
    """
    assert not is_e164(number)
    with pytest.raises(InvalidPhoneNumber) as excinfo:
        validate_e164(number)
    assert "trunk prefix" in excinfo.value.reason
    assert "drop the leading 0" in excinfo.value.reason


def test_the_same_number_without_the_trunk_prefix_is_accepted():
    assert validate_e164("+447700900123") == "+447700900123"


def test_a_leading_zero_is_only_refused_for_the_codes_that_need_it():
    """Some plans legitimately have a 0 after the country code; do not over-reach."""
    assert is_e164("+390212345678")   # Italy keeps its leading 0
