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


# --- real phishing email, 2026-08-22: a fake "iApple" invoice used none of
# the original keyword list ("call us right away" instead of "call back",
# "in the next 24 hours" instead of "within 24 hours") and would have gone
# completely undetected ---


def test_real_iapple_invoice_email_is_flagged():
    # Phone number replaced with an Ofcom-reserved fictional one — the real
    # email used a genuine third-party phone number, which must not end up
    # committed in source (see test_no_real_phone_numbers.py).
    alert = extract_alert(
        "You received a new invoice from We're about to charge your account in the next 24 hours. "
        "If this wasn't you call us right away at +447700900123 to stop the payment and protect "
        "your account.",
        "iapple.com",
    )
    assert alert is not None
    assert alert.phone_number == "+447700900123"


def test_hour_deadline_matches_any_hour_count_and_either_preposition():
    assert extract_alert("Respond within 2 hours. Call (800) 555-0187.", "example.com") is not None
    assert extract_alert("Respond in the next 48 hours. Call (800) 555-0187.", "example.com") is not None
    # A bare number of hours without "within"/"in the next" is not itself
    # urgency language — must not become a blanket "any hour count matches".
    assert extract_alert("Open 24 hours. Call (800) 555-0187 for support.", "example.com") is None


# --- second real phishing email, 2026-08-22: a fake "Geek Squad" renewal
# notice used yet more phrasing the original keyword list missed — "did not
# authorize" (not a substring of "unauthorized") and "you have 12 hours"
# (neither "within" nor "in the next") ---


def test_real_geek_squad_renewal_email_is_flagged():
    alert = extract_alert(
        "We have renewed your Geek Squad subscription. If you did not authorize this transaction, "
        "you have 12 hours to initiate a cancellation and receive an immediate refund. Reach out to "
        "our support team at +447700900456.",
        "geeksquad-billing.com",
    )
    assert alert is not None
    assert alert.phone_number == "+447700900456"


def test_real_robinhood_device_update_email_is_flagged():
    # Third real email, 2026-08-22: a fake Robinhood "device update" alert
    # used "please contact support right away" — none of "immediately",
    # "unusual activity", "call back"/"call us" matched it ("contact" isn't
    # "call").
    alert = extract_alert(
        "A sign-in was detected from a device we have not seen on your account. "
        "If you recognize this activity, you can ignore this message. If you do not, please contact "
        "support right away. Security support phone number: +447700900456",
        "robinhood-security-notice.com",
    )
    assert alert is not None
    assert alert.phone_number == "+447700900456"


def test_a_date_earlier_in_the_email_is_not_mistaken_for_the_phone_number():
    # The same real Geek Squad email had "Renewal Date: 2026-08-20" earlier
    # in the body than the actual callback number — PHONE_RE alone matches
    # "2026-08-20" as an 8-digit sequence, and a plain "first match in the
    # document" would extract the date instead of the real number. Only
    # screen.py's separate --to-phone mismatch guard caught this in
    # practice; extract_alert itself must get the right number without
    # relying on that downstream check.
    alert = extract_alert(
        "We have renewed your subscription.\n"
        "Renewal Date: 2026-08-20\n"
        "If you did not authorize this transaction, you have 12 hours to initiate a cancellation. "
        "Reach out to our support team at +447700900456.",
        "example.com",
    )
    assert alert is not None
    assert alert.phone_number == "+447700900456"


# --- fourth real email, 2026-08-22: another fake "Geek Squad" renewal, this
# time with no explicit deadline or authorization phrase at all — the only
# urgency hook was that the (unwanted) charge is happening the same day ---


def test_same_day_charge_language_is_flagged_without_any_deadline_phrase():
    alert = extract_alert(
        "Your personal subscription GEEK SQUAD CARE will expire today. This subscription will be "
        "renewed and paid automatically. Customer Support: +447700900789",
        "example.com",
    )
    assert alert is not None
    assert alert.phone_number == "+447700900789"


def test_same_day_charge_matches_expire_renew_charge_or_bill():
    assert extract_alert("Your card will be charged today. Call (800) 555-0187.", "example.com") is not None
    assert extract_alert("You will be billed today. Call (800) 555-0187.", "example.com") is not None
    # "today" alone, without one of these charge-related verbs, is not itself
    # urgency language.
    assert extract_alert("We processed your request today. Call (800) 555-0187 for help.", "example.com") is None
