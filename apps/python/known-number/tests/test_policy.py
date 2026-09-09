from datetime import date

from known_number.models import ChangeRequest, load_request
from known_number.policy import evaluate
from tests.conftest import ROOT

TODAY = date(2026, 9, 8)


def test_allows_established_number_and_flags_supplied_callback(request_v0417, vendor_v0417):
    d = evaluate(request_v0417, vendor_v0417, today=TODAY)
    assert d.allowed
    assert d.dial_phone == vendor_v0417.known_phone
    assert d.dial_phone != request_v0417.callback_phone
    assert any("does NOT match" in w for w in d.warnings)


def test_blocks_recently_changed_phone(vendors):
    req = load_request(ROOT / "examples" / "change_request_recent_phone.json")
    d = evaluate(req, vendors["V-0902"], today=TODAY)
    assert not d.allowed
    assert any("recently changed phone" in r or "less than" in r for r in d.blocking_reasons)


def test_blocks_unknown_vendor(request_v0417):
    d = evaluate(request_v0417, None, today=TODAY)
    assert not d.allowed and d.dial_phone is None


def test_live_requires_approver(request_v0417, vendor_v0417):
    assert not evaluate(request_v0417, vendor_v0417, today=TODAY, live=True).allowed
    assert evaluate(request_v0417, vendor_v0417, today=TODAY, live=True, approver="A. Reviewer").allowed


def test_blocks_no_op_change(vendor_v0417, request_v0417):
    req = ChangeRequest(
        ticket_id="AP-1", vendor_id=vendor_v0417.vendor_id, received_on=date(2026, 9, 4), channel="email",
        requested_by_name="x", new_bank_name=vendor_v0417.current_bank_name, new_account_last4=vendor_v0417.current_account_last4,
    )
    assert not evaluate(req, vendor_v0417, today=TODAY).allowed


def test_models_refuse_full_account_numbers():
    import pytest
    with pytest.raises(ValueError):
        ChangeRequest(ticket_id="AP-2", vendor_id="V", received_on=date(2026, 9, 4), channel="email",
                      requested_by_name="x", new_bank_name="B", new_account_last4="123456789")
