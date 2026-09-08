import pytest

from known_number.models import Verdict
from known_number.reconcile import reconcile
from tests.conftest import load_fixture

EXPECTED = {
    "confirmed": Verdict.CONFIRMED,
    "denied_by_vendor": Verdict.DENIED_BY_VENDOR,
    "mismatch_last4": Verdict.MISMATCH,
    "mismatch_bank": Verdict.MISMATCH,
    "alternate_details_offered": Verdict.ESCALATE,
    "channel_not_confirmed": Verdict.ESCALATE,
    "wrong_person": Verdict.INCONCLUSIVE,
    "voicemail": Verdict.INCONCLUSIVE,
    "low_confidence": Verdict.INCONCLUSIVE,
    "no_readback": Verdict.INCONCLUSIVE,
    "call_failed": Verdict.INCONCLUSIVE,
}


@pytest.mark.parametrize("name,expected", sorted(EXPECTED.items()))
def test_fixture_matrix(name, expected, request_v0417, vendor_v0417):
    rec = reconcile(request_v0417, vendor_v0417, load_fixture(name))
    assert rec.verdict is expected
    assert rec.reasons, "every verdict must carry at least one reason"
    assert rec.recommended_action


def test_only_confirmed_releases(request_v0417, vendor_v0417):
    for name in EXPECTED:
        rec = reconcile(request_v0417, vendor_v0417, load_fixture(name))
        assert rec.verdict.releases_change == (name == "confirmed")


def test_confirmed_requires_evidence(request_v0417, vendor_v0417):
    call = load_fixture("confirmed")
    call["evidence"] = []
    assert reconcile(request_v0417, vendor_v0417, call).verdict is Verdict.INCONCLUSIVE


def test_alternate_details_beats_everything(request_v0417, vendor_v0417):
    call = load_fixture("denied_by_vendor")
    call["structured_result"]["alternate_details_offered"] = True
    assert reconcile(request_v0417, vendor_v0417, call).verdict is Verdict.ESCALATE


def test_spoken_digits_are_normalised(request_v0417, vendor_v0417):
    call = load_fixture("confirmed")
    call["structured_result"]["stated_account_last4"] = "4-4-7-2"
    assert reconcile(request_v0417, vendor_v0417, call).verdict is Verdict.CONFIRMED


def test_recipient_level_result_is_used_when_top_level_missing(request_v0417, vendor_v0417):
    call = load_fixture("confirmed")
    call["recipients"][0]["structured_result"] = call.pop("structured_result")
    assert reconcile(request_v0417, vendor_v0417, call).verdict is Verdict.CONFIRMED


def test_bank_match_ignores_generic_words(request_v0417, vendor_v0417):
    call = load_fixture("confirmed")
    call["structured_result"]["stated_bank_name"] = "Bank Ltd"
    assert reconcile(request_v0417, vendor_v0417, call).verdict is Verdict.MISMATCH
    call["structured_result"]["stated_bank_name"] = "meridian commerce"
    assert reconcile(request_v0417, vendor_v0417, call).verdict is Verdict.CONFIRMED
