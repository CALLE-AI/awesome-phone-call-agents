import pytest
from bytelytic_clinic.phone import validate_and_format_e164, mask_phone


def test_standard_us_e164_valid():
    assert validate_and_format_e164("+15550192834") == "+15550192834"


def test_us_ten_digit_normalized():
    assert validate_and_format_e164("5550192834") == "+15550192834"


def test_us_parentheses_and_dashes_normalized():
    assert validate_and_format_e164("+1 (555) 019-2834") == "+15550192834"


def test_international_e164_valid():
    assert validate_and_format_e164("+447911123456") == "+447911123456"
    assert validate_and_format_e164("+61412345678") == "+61412345678"


def test_rejects_empty_phone():
    with pytest.raises(ValueError):
        validate_and_format_e164("")


def test_rejects_alpha_characters():
    with pytest.raises(ValueError):
        validate_and_format_e164("+1555ABC2834")


def test_phone_masking_standard():
    assert mask_phone("+15550192834") == "+1555***2834"


def test_phone_masking_short_or_empty():
    assert mask_phone("123") == "***"
    assert mask_phone("") == "***"


def test_rejects_invalid_nanp_exchange_code():
    with pytest.raises(ValueError):
        validate_and_format_e164("+1 (201) 055-1234")
    with pytest.raises(ValueError):
        validate_and_format_e164("+1 (201) 155-1234")

