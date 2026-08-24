from pipeline import precheck
from pipeline.models import Alert
from pipeline.precheck import run_prechecks

ALERT = Alert(
    claimed_reason="unusual activity",
    phone_number="(800) 555-0187",
    sender_domain="example.com",
    source_email_excerpt="...",
)


def test_no_notes_when_nothing_flagged():
    result = run_prechecks(ALERT)
    assert result.number_known_scam is False
    assert result.number_matches_official_support is None
    assert result.notes == []


def test_flags_known_scam_number(monkeypatch):
    monkeypatch.setattr(precheck, "KNOWN_SCAM_NUMBERS", {"8005550187"})
    result = run_prechecks(ALERT)
    assert result.number_known_scam is True
    assert any("known-scam-number" in n for n in result.notes)


def test_flags_mismatch_against_official_number():
    result = run_prechecks(ALERT, official_support_number="+1-800-555-0199")
    assert result.number_matches_official_support is False
    assert any("does not match" in n for n in result.notes)


def test_matches_official_number_when_equal_after_normalizing():
    result = run_prechecks(ALERT, official_support_number="+1 (800) 555-0187")
    assert result.number_matches_official_support is True
    assert result.notes == []
