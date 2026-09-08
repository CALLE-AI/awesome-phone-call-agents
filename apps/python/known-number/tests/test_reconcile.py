import pytest

from known_number.models import Verdict
from known_number.reconcile import reconcile
from tests.conftest import load_fixture

EXPECTED = {
    "confirmed": Verdict.PENDING_WRITTEN_REPLY,
    "denied_by_vendor": Verdict.DENIED_BY_VENDOR,
    "reference_not_delivered": Verdict.INCONCLUSIVE,
    "notice_disputed": Verdict.MISMATCH,
    "alternate_details_offered": Verdict.ESCALATE,
    "channel_not_confirmed": Verdict.ESCALATE,
    "wrong_person": Verdict.INCONCLUSIVE,
    "voicemail": Verdict.INCONCLUSIVE,
    "low_confidence": Verdict.INCONCLUSIVE,
    "notice_not_seen": Verdict.INCONCLUSIVE,
    "call_failed": Verdict.INCONCLUSIVE,
}


@pytest.mark.parametrize("name,expected", sorted(EXPECTED.items()))
def test_fixture_matrix(name, expected, request_v0417, vendor_v0417):
    rec = reconcile(request_v0417, vendor_v0417, load_fixture(name))
    assert rec.verdict is expected
    assert rec.reasons, "every verdict must carry at least one reason"
    assert rec.recommended_action


def test_nothing_releases_without_written_reply(request_v0417, vendor_v0417):
    for name in EXPECTED:
        rec = reconcile(request_v0417, vendor_v0417, load_fixture(name))
        assert not rec.verdict.releases_change


def test_written_reply_with_reference_confirms(request_v0417, vendor_v0417):
    call = load_fixture("confirmed")
    rec = reconcile(request_v0417, vendor_v0417, call, written_reply="Confirming, ref he4nf5. Priya")
    assert rec.verdict is Verdict.CONFIRMED and rec.verdict.releases_change


def test_written_reply_without_reference_is_mismatch(request_v0417, vendor_v0417):
    call = load_fixture("confirmed")
    rec = reconcile(request_v0417, vendor_v0417, call, written_reply="Confirming, thanks. Priya")
    assert rec.verdict is Verdict.MISMATCH


def test_written_reply_only_matters_after_phone_leg(request_v0417, vendor_v0417):
    call = load_fixture("denied_by_vendor")
    rec = reconcile(request_v0417, vendor_v0417, call, written_reply="ref HE4NF5")
    assert rec.verdict is Verdict.DENIED_BY_VENDOR


def test_confirmed_requires_evidence(request_v0417, vendor_v0417):
    call = load_fixture("confirmed")
    call["evidence"] = []
    assert reconcile(request_v0417, vendor_v0417, call, written_reply="ref HE4NF5").verdict is Verdict.INCONCLUSIVE


def test_alternate_details_beats_everything(request_v0417, vendor_v0417):
    call = load_fixture("denied_by_vendor")
    call["structured_result"]["alternate_details_offered"] = True
    assert reconcile(request_v0417, vendor_v0417, call).verdict is Verdict.ESCALATE


def test_reference_in_reply_is_normalised(request_v0417, vendor_v0417):
    call = load_fixture("confirmed")
    assert reconcile(request_v0417, vendor_v0417, call, written_reply="Ref: h e 4 - n f 5").verdict is Verdict.CONFIRMED


def test_reference_depends_on_request_contents(request_v0417, vendor_v0417):
    from dataclasses import replace
    from known_number.models import callback_reference
    tampered = replace(request_v0417, new_account_last4="9999")
    assert callback_reference(tampered) != callback_reference(request_v0417)
    call = load_fixture("confirmed")
    assert reconcile(tampered, vendor_v0417, call, written_reply="ref HE4NF5").verdict is Verdict.MISMATCH


def test_recipient_level_result_is_used_when_top_level_missing(request_v0417, vendor_v0417):
    call = load_fixture("confirmed")
    call["recipients"][0]["structured_result"] = call.pop("structured_result")
    assert reconcile(request_v0417, vendor_v0417, call, written_reply="ref HE4NF5").verdict is Verdict.CONFIRMED


def test_secret_changes_reference(request_v0417, vendor_v0417):
    call = load_fixture("confirmed")
    assert reconcile(request_v0417, vendor_v0417, call, code_secret="deployment-secret", written_reply="ref HE4NF5").verdict is Verdict.MISMATCH
