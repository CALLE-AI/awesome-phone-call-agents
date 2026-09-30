import pytest

from ringfence.safety import (
    InvalidPhoneNumber,
    mask_account_number,
    mask_phone,
    normalize_e164,
    redact_text,
    redact_value,
)


def test_normalize_e164_accepts_valid_number():
    assert normalize_e164("+1 415 555 0101") == "+14155550101"


def test_normalize_e164_rejects_missing_country_code():
    with pytest.raises(InvalidPhoneNumber):
        normalize_e164("4155550101")


def test_normalize_e164_converts_00_prefix():
    assert normalize_e164("0014155550101") == "+14155550101"


def test_normalize_e164_rejects_garbage():
    with pytest.raises(InvalidPhoneNumber):
        normalize_e164("not a phone number")


def test_mask_phone_hides_at_least_half_the_digits():
    masked = mask_phone("+14155550101")
    digits = [c for c in "+14155550101" if c.isdigit()]
    masked_digits = [c for c in masked if c == "*"]
    assert len(masked_digits) >= len(digits) // 2


def test_mask_account_number_keeps_only_last_four():
    assert mask_account_number("123456789012") == "********9012"


def test_mask_account_number_short_value_fully_masked():
    assert mask_account_number("123") == "***"


def test_redact_text_strips_phone_email_and_long_digit_runs():
    text = "Call +14155550101 or email a@b.com, account 123456789."
    redacted = redact_text(text)
    assert "+14155550101" not in redacted
    assert "a@b.com" not in redacted
    assert "123456789" not in redacted


def test_redact_value_recurses_through_nested_structures():
    value = {"note": "reach me at +14155550101", "attempts": [{"failure_message": "acct 987654321"}]}
    redacted = redact_value(value)
    assert "+14155550101" not in redacted["note"]
    assert "987654321" not in redacted["attempts"][0]["failure_message"]
