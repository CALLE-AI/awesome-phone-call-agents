from safety import can_call_business, mask_phone_number


def test_authorized_business_can_be_called():
    business = {
        "authorized": True,
        "do_not_call": False,
        "phone": "+911234567890"
    }

    allowed, _ = can_call_business(business)

    assert allowed is True


def test_do_not_call_business_is_blocked():
    business = {
        "authorized": True,
        "do_not_call": True,
        "phone": "+911234567890"
    }

    allowed, _ = can_call_business(business)

    assert allowed is False


def test_phone_is_masked():
    masked = mask_phone_number("+911234567890")

    assert masked != "+911234567890"