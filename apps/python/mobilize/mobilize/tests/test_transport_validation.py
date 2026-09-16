import pytest

from mobilize.transports.base import validate_e164, validate_trusted_base_url
from mobilize.transports.calle import _to_call_result
from mobilize.core.types import Candidate, CallOutcome


def test_validate_e164_accepts_valid_number():
    validate_e164("+15550101234")  # must not raise


def test_validate_e164_rejects_missing_plus():
    with pytest.raises(ValueError):
        validate_e164("15550101234")


def test_validate_e164_rejects_letters():
    with pytest.raises(ValueError):
        validate_e164("+1555abc1234")


def test_validate_e164_rejects_leading_zero_country_code():
    with pytest.raises(ValueError):
        validate_e164("+0155501012")


def test_validate_trusted_base_url_accepts_official_host():
    validate_trusted_base_url("https://api.heycall-e.com")  # must not raise


def test_validate_trusted_base_url_rejects_http():
    with pytest.raises(ValueError):
        validate_trusted_base_url("http://api.heycall-e.com")


def test_validate_trusted_base_url_rejects_untrusted_host():
    with pytest.raises(ValueError):
        validate_trusted_base_url("https://evil.example.com")


def test_validate_trusted_base_url_rejects_lookalike_host():
    # A naive substring check would let this through; the real check parses
    # the host component and compares it exactly.
    with pytest.raises(ValueError):
        validate_trusted_base_url("https://api.heycall-e.com.evil.com")


def _candidate(id_="cand_1", phone="+15550101234") -> Candidate:
    return Candidate(
        id=id_, phone=phone, name="X", days_since_last_action=90, distance_km=1,
        historical_accept_rate=0.5, historical_showup_rate=0.5,
    )


def test_to_call_result_accepts_matching_candidate():
    candidate = _candidate()
    call = {
        "recipients": [{"phones": ["+15550101234"], "structured_result": {"can_come": "no"}}],
        "metadata": {"candidate_id": "cand_1"},
        "status": "completed",
    }
    result = _to_call_result("call_1", call, candidate)
    assert result.outcome == CallOutcome.NO
    assert result.candidate_id == "cand_1"


def test_to_call_result_rejects_metadata_mismatch():
    candidate = _candidate(id_="cand_1")
    call = {
        "recipients": [{"phones": ["+15550101234"], "structured_result": {"can_come": "yes", "evidence_summary": "leaving now"}}],
        "metadata": {"candidate_id": "some_other_candidate"},
        "status": "completed",
    }
    result = _to_call_result("call_1", call, candidate)
    assert result.outcome == CallOutcome.FAILED
    assert result.commitment_score == 0.0


def test_to_call_result_rejects_phone_mismatch():
    candidate = _candidate(id_="cand_1", phone="+15550101234")
    call = {
        "recipients": [{"phones": ["+15559998888"], "structured_result": {"can_come": "yes", "evidence_summary": "leaving now"}}],
        "metadata": {"candidate_id": "cand_1"},
        "status": "completed",
    }
    result = _to_call_result("call_1", call, candidate)
    assert result.outcome == CallOutcome.FAILED
