from pipeline.trigger import extract_alert


def test_returns_none_without_urgency_language():
    assert extract_alert("Hi, just checking in, call us at (800) 555-0187 whenever.", "example.com") is None


def test_returns_none_without_phone_number():
    assert extract_alert("Your account has been suspended, act now.", "example.com") is None


def test_extracts_phone_and_reason_when_both_present():
    alert = extract_alert(
        "Subject: Unusual Activity Detected\n\nWe detected unusual activity. Call (800) 555-0187 now.",
        "example.com",
    )
    assert alert is not None
    assert alert.phone_number == "(800) 555-0187"
    assert alert.sender_domain == "example.com"


def test_claimed_reason_skips_the_subject_line():
    alert = extract_alert(
        "Subject: Unusual Activity Detected - Immediate Action Required\n\n"
        "We have detected unusual activity on your account. Call (800) 555-0187.",
        "example.com",
    )
    assert alert is not None
    assert not alert.claimed_reason.lower().startswith("subject:")
    assert "unusual activity" in alert.claimed_reason.lower()


def test_phone_number_keeps_leading_parenthesis():
    alert = extract_alert("Your account has been suspended. Call (800) 555-0187 immediately.", "example.com")
    assert alert is not None
    assert alert.phone_number.startswith("(")
