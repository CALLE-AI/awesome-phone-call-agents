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
    assert safety.mask_phone("+1 (555) 555-0142") == "+1 (***) ***-0142"
    assert safety.mask_phone("(555) 555-0142") == "(***) ***-0142"
    assert safety.mask_phone("555-555-0142") == "***-***-0142"
    assert safety.mask_phone("555.555.0142") == "***.***.0142"
    assert safety.mask_phone("555 555 0142") == "*** *** 0142"
    assert safety.mask_phone("+44 20 7183 8750") == "+4* ** **** 8750"
    assert safety.mask_phone("020 7183 8750") == "0** **** 8750"
    assert safety.mask_phone("1-555-555-0142") == "1-***-***-0142"
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


def test_mask_text_grouped_and_national_phone_numbers():
    # Grouped international
    t1 = "Spoke with operator at +1 (555) 555-0142: hold confirmed"
    m1 = safety.mask_text(t1)
    assert "+1 (555) 555-0142" not in m1
    assert "+1 (***) ***-0142" in m1

    # National parentheses
    t2 = "Transferred to (555) 555-0142 for supervisor escalation"
    m2 = safety.mask_text(t2)
    assert "(555) 555-0142" not in m2
    assert "(***) ***-0142" in m2

    # National hyphenated & dotted
    t3 = "Evidence: called 555-555-0142 and 555.010.0123"
    m3 = safety.mask_text(t3)
    assert "555-555-0142" not in m3
    assert "***-***-0142" in m3
    assert "555.010.0123" not in m3
    assert "***.***.0123" in m3

    # UK national 0-prefixed
    t4 = "Transferred to London dispatch at 020 7183 8750"
    m4 = safety.mask_text(t4)
    assert "020 7183 8750" not in m4
    assert "0** **** 8750" in m4


def test_mask_text_protects_timestamps_ips_and_metrics():
    text = "Incident INC-003 at 2026-09-15T10:19:48Z: host 10.0.5.42:22 psi 52.3 score 0.88 date 2026-09-15"
    masked = safety.mask_text(text)
    assert "INC-003" in masked
    assert "2026-09-15T10:19:48Z" in masked
    assert "10.0.5.42:22" in masked
    assert "52.3" in masked
    assert "0.88" in masked
    assert "2026-09-15" in masked
