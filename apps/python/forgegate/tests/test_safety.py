import pytest
import safety


def test_valid_ascii_e164():
    assert safety.normalize_ascii_e164("+12025550123") == "+12025550123"
    assert safety.normalize_ascii_e164("+442071838750") == "+442071838750"
    assert safety.normalize_ascii_e164("+919876543210") == "+919876543210"
    assert safety.normalize_ascii_e164("  +15550100142  ") == "+15550100142"


def test_reject_non_ascii_confusable_digits():
    # Arabic-Indic digits
    with pytest.raises(safety.DestinationError, match="Refusing non-ASCII character"):
        safety.normalize_ascii_e164("+1\u0662\u0663\u0664\u0665\u0666\u0667\u0668\u0669\u0660")

    # Fullwidth digits
    with pytest.raises(safety.DestinationError, match="Refusing non-ASCII character"):
        safety.normalize_ascii_e164("+\uff11\uff12\uff13\uff14\uff15\uff16\uff17\uff18\uff19\uff10")


def test_reject_invalid_e164_formats():
    # Missing leading +
    with pytest.raises(safety.DestinationError, match="not valid ASCII E.164"):
        safety.normalize_ascii_e164("12025550123")

    # Leading +0
    with pytest.raises(safety.DestinationError, match="not valid ASCII E.164"):
        safety.normalize_ascii_e164("+02025550123")

    # Spaces and dashes
    with pytest.raises(safety.DestinationError, match="not valid ASCII E.164"):
        safety.normalize_ascii_e164("+1 (202) 555-0123")

    # Too short
    with pytest.raises(safety.DestinationError, match="not valid ASCII E.164"):
        safety.normalize_ascii_e164("+12345")


def test_authorized_destination():
    # Authorized when matches configured phone
    dest = safety.assert_authorized_destination("+12025550123", configured_phone="+12025550123")
    assert dest == "+12025550123"

    # Authorized when in allowed list
    dest = safety.assert_authorized_destination(
        "+12025550123",
        configured_phone="+19999999999",
        allowed_list=["+12025550123", "+442071838750"],
    )
    assert dest == "+12025550123"

    # Unauthorized
    with pytest.raises(safety.DestinationError, match="not in the operator's authorized"):
        safety.assert_authorized_destination(
            "+12025550999",
            configured_phone="+12025550123",
            allowed_list=["+12025550123"],
        )

    # No destinations authorized
    with pytest.raises(safety.DestinationError, match="No destinations are authorized"):
        safety.assert_authorized_destination(
            "+12025550123",
            configured_phone=None,
            allowed_list=[],
        )


def test_mask_phone():
    assert safety.mask_phone("+15555550142") == "+1******0142"
    assert safety.mask_phone("+442071838750") == "+4*******8750"
    assert safety.mask_phone("123") == "1**"
    assert safety.mask_phone("") == "<empty>"


def test_mask_text():
    text = "Calling +15555550142 with Authorization: Bearer secret_token_xyz12345 and calle_key=key_987654321"
    masked = safety.mask_text(text)
    assert "+15555550142" not in masked
    assert "+1******0142" in masked
    assert "secret_token_xyz12345" not in masked
    assert "[REDACTED_TOKEN]" in masked
    assert "key_987654321" not in masked
