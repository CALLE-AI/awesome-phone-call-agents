import pytest

from known_number.models import Verdict
from known_number.reconcile import reconcile
from tests.conftest import load_fixture

EXPECTED = {
    "confirmed": Verdict.CONFIRMED,
    "denied_by_vendor": Verdict.DENIED_BY_VENDOR,
    "wrong_code": Verdict.MISMATCH,
    "notice_disputed": Verdict.MISMATCH,
    "alternate_details_offered": Verdict.ESCALATE,
    "channel_not_confirmed": Verdict.ESCALATE,
    "wrong_person": Verdict.INCONCLUSIVE,
    "voicemail": Verdict.INCONCLUSIVE,
    "low_confidence": Verdict.INCONCLUSIVE,
    "no_code_readback": Verdict.INCONCLUSIVE,
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


def test_spoken_code_is_normalised(request_v0417, vendor_v0417):
    call = load_fixture("confirmed")
    call["structured_result"]["stated_verification_code"] = "h e 4 - n f 5"
    assert reconcile(request_v0417, vendor_v0417, call).verdict is Verdict.CONFIRMED


def test_code_depends_on_request_contents(request_v0417, vendor_v0417):
    from dataclasses import replace
    from known_number.models import verification_code
    tampered = replace(request_v0417, new_account_last4="9999")
    assert verification_code(tampered) != verification_code(request_v0417)
    call = load_fixture("confirmed")
    assert reconcile(tampered, vendor_v0417, call).verdict is Verdict.MISMATCH


def test_recipient_level_result_is_used_when_top_level_missing(request_v0417, vendor_v0417):
    call = load_fixture("confirmed")
    call["recipients"][0]["structured_result"] = call.pop("structured_result")
    assert reconcile(request_v0417, vendor_v0417, call).verdict is Verdict.CONFIRMED


def test_secret_changes_code(request_v0417, vendor_v0417):
    call = load_fixture("confirmed")
    assert reconcile(request_v0417, vendor_v0417, call, code_secret="deployment-secret").verdict is Verdict.MISMATCH
