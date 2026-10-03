"""The calling rules as pure functions: every blocking reason is reported, and a clean call has none."""
from datetime import datetime

import pytest

from rebuttal_dispute_call import call, rules

PHONE = "+12125550101"
NOON_NY = datetime.fromisoformat("2026-09-15T16:00:00+00:00")
LATE_NY = datetime.fromisoformat("2026-09-15T03:00:00+00:00")
ORDER = {"merchant": "Example Outfitters", "order_id": "1042", "items": "Trail shoes x1", "amount": "$89.00"}


def check(**overrides):
    kwargs = dict(dispute_id="du_1", phone=PHONE, on_record=PHONE, task=call.build_task(**ORDER),
                  template_args=ORDER, live=True, intent=True, allowlist=PHONE, called=(), now=NOON_NY)
    kwargs.update(overrides)
    return rules.check_call(**kwargs)


def test_a_clean_live_call_passes_every_rule():
    assert check() == []


@pytest.mark.parametrize("overrides,expected", [
    ({"on_record": "+12125550102"}, [rules.NOT_ON_RECORD]),
    ({"on_record": None}, [rules.NOT_ON_RECORD]),
    ({"intent": False}, [rules.NO_OPERATOR_INTENT]),
    ({"allowlist": ""}, [rules.NOT_AUTHORIZED]),
    ({"allowlist": "+12125550102"}, [rules.NOT_AUTHORIZED]),
    ({"now": LATE_NY}, [rules.OUTSIDE_HOURS]),
    ({"task": call.build_task(**ORDER) + " Also ask for their date of birth."}, [rules.SCRIPT_NOT_FROM_TEMPLATE]),
    ({"template_args": {"merchant": "Example Outfitters"}}, [rules.SCRIPT_NOT_FROM_TEMPLATE]),
    ({"called": {"du_1"}}, [rules.SECOND_CALL]),
    # without a country code there is no E.164 number and no calling-hours rule to satisfy
    ({"phone": "2125550101", "on_record": "2125550101", "allowlist": "2125550101"},
     [rules.NOT_E164, rules.OUTSIDE_HOURS]),
])
def test_each_rule_blocks(overrides, expected):
    assert check(**overrides) == expected


def test_every_reason_is_reported_at_once():
    found = check(on_record="+12125550102", intent=False, allowlist=None, now=LATE_NY, called=["du_1"])
    assert found == [rules.NOT_ON_RECORD, rules.NO_OPERATOR_INTENT, rules.NOT_AUTHORIZED,
                     rules.OUTSIDE_HOURS, rules.SECOND_CALL]


def test_intent_and_allowlist_apply_only_to_live_calls():
    assert check(live=False, intent=False, allowlist=None) == []


def test_record_and_hours_apply_to_rehearsals_too():
    assert check(live=False, now=LATE_NY, on_record="+12125550102") == [rules.NOT_ON_RECORD, rules.OUTSIDE_HOURS]


def test_allowlist_accepts_a_collection():
    assert check(allowlist={"+12125550101", "+12125550102"}) == []
    assert check(allowlist=["+12125550102"]) == [rules.NOT_AUTHORIZED]


@pytest.mark.parametrize("url,ok", [
    (None, True),
    ("", True),
    ("https://api.heycall-e.com", True),
    ("https://api.heycall-e.com/", True),
    ("https://test-api.heycall-e.com", True),
    ("http://api.heycall-e.com", False),
    ("https://api.heycall-e.com.example.net", False),
    ("https://calls.example.net", False),
])
def test_the_api_key_only_goes_to_calle(url, ok):
    assert rules.base_url_allowed(url) is ok


def test_every_rule_has_a_message():
    assert set(rules.MESSAGES) == set(rules.RULES)
