"""The vendored call module: script, destination rules, grounding and the evidence document.

Every number is from the reserved fictional range and every conversation is synthetic. Nothing dials.
"""
from datetime import datetime

import pytest

from rebuttal_dispute_call import call
from rebuttal_dispute_call.fake import FakeCalle

MERCHANT = "Example Outfitters"
PHONE = "+12125550101"
YES = {"received": "yes", "recognises_charge": "yes", "purchaser": "cardholder", "declined_to_talk": "no"}
ORDER = {"merchant": MERCHANT, "order_id": "1042", "items": "Trail shoes x1", "amount": "$89.00"}

OPEN = ("bot", call.disclosure(MERCHANT, "1042"))
ASK_RECEIVED = ("bot", "Did you receive the order?")
ASK_CHARGE = ("bot", "Do you recognise the charge for that order?")


def turns(*pairs):
    return [{"offset_seconds": i * 3, "speaker": sp, "text": tx} for i, (sp, tx) in enumerate(pairs)]


def record(ts, result, status="completed", confidence=0.93):
    return call.CallRecord(call_id="call_t", status=status, task_completed=status == "completed",
                           confidence=confidence, result=result, summary="", evidence=[], turns=ts)


# ---- grounding

def test_disclosed_and_grounded_answers_are_accepted():
    g = call.ground(record(turns(OPEN, ("user", "Okay."), ASK_RECEIVED, ("user", "Yes, I got them."),
                                 ASK_CHARGE, ("user", "Yes, that's mine.")), YES), MERCHANT)
    assert g.usable and not g.denied
    assert g.accepted == {"received": "yes", "recognises_charge": "yes", "purchaser": "cardholder"}
    assert g.check("received_grounded").quote == "Yes, I got them."


def test_a_structured_yes_the_customer_never_said_is_not_accepted():
    g = call.ground(record(turns(OPEN, ASK_RECEIVED, ("user", "Who is this?"),
                                 ASK_CHARGE, ("user", "Call me later.")), YES), MERCHANT)
    assert g.usable, "the call itself was fine; only the answers are unsupported"
    assert g.accepted["received"] == "unknown" and g.accepted["recognises_charge"] == "unknown"
    assert not g.check("received_grounded").passed and not g.check("recognises_charge_grounded").passed


def test_without_the_spoken_disclosure_nothing_is_accepted():
    plain = ("bot", f"Hello, I'm calling on behalf of {MERCHANT} about your order 1042.")
    g = call.ground(record(turns(plain, ASK_RECEIVED, ("user", "Yes."), ASK_CHARGE, ("user", "Yes.")), YES), MERCHANT)
    assert not g.check("disclosure_spoken").passed and not g.usable
    assert g.accepted["received"] == "unknown"


def test_the_disclosure_must_name_this_merchant():
    other = ("bot", call.disclosure("Another Shop", "1042"))
    g = call.ground(record(turns(other, ASK_RECEIVED, ("user", "Yes."), ASK_CHARGE, ("user", "Yes.")), YES), MERCHANT)
    assert not g.check("disclosure_spoken").passed and not g.usable


def test_a_no_stops_the_filing_even_when_it_is_not_grounded():
    g = call.ground(record(turns(OPEN, ASK_RECEIVED, ("user", "Hmm."), ASK_CHARGE, ("user", "Hmm.")),
                           dict(YES, received="no")), MERCHANT)
    assert g.denied and not g.check("received_grounded").passed
    assert g.accepted["received"] == "unknown"


def test_low_confidence_call_is_not_usable():
    g = call.ground(record(turns(OPEN, ASK_RECEIVED, ("user", "Yes."), ASK_CHARGE, ("user", "Yes.")), YES,
                           confidence=0.55), MERCHANT)
    assert not g.check("confidence").passed and not g.usable
    assert g.accepted["received"] == "unknown"


def test_a_caller_asking_for_card_data_makes_the_call_unusable():
    g = call.ground(record(turns(OPEN, ("bot", "Can you read me the card number?"), ASK_RECEIVED, ("user", "Yes."),
                                 ASK_CHARGE, ("user", "Yes.")), YES), MERCHANT)
    check = g.check("no_payment_data_requested")
    assert not check.passed and check.quote == "Can you read me the card number?"
    assert not g.usable and g.accepted["received"] == "unknown"


def test_a_customer_who_declines_is_not_used():
    declined = dict(YES, received="unknown", recognises_charge="unknown", declined_to_talk="yes")
    g = call.ground(record(turns(OPEN, ("user", "I don't want to talk.")), declined), MERCHANT)
    assert not g.check("customer_willing").passed and not g.usable


def test_a_failed_call_is_not_usable():
    assert not call.ground(record([], {}, status="failed", confidence=None), MERCHANT).usable


@pytest.mark.parametrize("text,expected", [
    ("Yes, I got them last week.", "yes"),
    ("Yes, no problem.", "yes"),
    ("No, nothing arrived.", "no"),
    ("No, that charge is not mine.", "no"),
    ("Sorry, who is this?", None),
    ("Yes and no.", None),
])
def test_polarity(text, expected):
    assert call.polarity(text) == expected


# ---- script and destination rules

def test_script_discloses_and_never_asks_for_payment_data():
    task = call.build_task(**ORDER)
    assert call.disclosure(MERCHANT, "1042") in task and "automated assistant" in task
    assert "Never ask for card numbers" in task and "+1" not in task


@pytest.mark.parametrize("now,ok", [
    ("2026-09-15T16:00:00+00:00", True),   # 12:00 in New York, 09:00 in Los Angeles
    ("2026-09-15T03:00:00+00:00", False),  # 23:00 in New York
    ("2026-09-15T13:30:00+00:00", False),  # 06:30 in Los Angeles
    ("2026-09-16T00:30:00+00:00", True),   # 20:30 in New York, 17:30 in Los Angeles
    ("2026-09-16T01:30:00+00:00", False),  # 21:30 in New York
])
def test_local_calling_hours_hold_in_every_continental_zone(now, ok):
    assert call.local_hours_ok(PHONE, datetime.fromisoformat(now))[0] is ok


def test_mask_keeps_country_code_and_last_four():
    assert call.mask(PHONE) == "+12*****0101"
    assert call.mask("") == "" and call.mask(None) == ""


def test_allowlist_is_exact_and_empty_means_nobody():
    assert call.authorized(PHONE, "+12125550101, +12125550102")
    assert call.authorized(PHONE, ["+12125550101"])
    assert not call.authorized("+12125550103", "+12125550101,+12125550102")
    assert not call.authorized(PHONE, "") and not call.authorized(PHONE, None)


# ---- the CALL-E contract, against the fake

def test_place_rejects_a_non_e164_destination_before_any_request():
    fake = FakeCalle()
    with pytest.raises(ValueError):
        call.place(fake, dispute_id="du_1", phone="2125550101", **ORDER)
    assert fake.placed == 0 and fake.requests == []


def test_place_sends_the_fixed_script_the_strict_schema_and_the_key():
    fake = FakeCalle()
    call.place(fake, dispute_id="du_1", phone=PHONE, **ORDER)
    sent = fake.requests[0]
    assert sent["task"] == call.build_task(**ORDER)
    assert sent["result_schema"] == call.RESULT_SCHEMA and sent["result_schema"]["additionalProperties"] is False
    assert sent["idempotency_key"] == call.idempotency_key("du_1")
    assert sent["recipients"] == [{"phones": [PHONE]}]


def test_one_call_per_dispute_through_the_idempotency_key():
    fake = FakeCalle()
    first = call.place(fake, dispute_id="du_1", phone=PHONE, **ORDER)
    retry = call.place(fake, dispute_id="du_1", phone=PHONE, **ORDER)
    other = call.place(fake, dispute_id="du_2", phone=PHONE, **ORDER)
    assert first["id"] == retry["id"] != other["id"]
    assert fake.placed == 2 and len(fake.requests) == 3


def test_follow_streams_each_event_and_turn_once_then_grounds():
    fake = FakeCalle("grounded", polls=3, page_size=2)
    created = call.place(fake, dispute_id="du_1", phone=PHONE, **ORDER)
    events, said, naps = [], [], []
    rec = call.follow(fake, created["id"], on_event=events.append, on_turn=said.append, sleep=naps.append)
    ids = [e["id"] for e in events]
    assert rec.status == "completed" and len(naps) == 2
    assert len(ids) == len(set(ids)) == 5 and events[-1]["message"] == "Call completed."
    assert said == rec.turns and len(said) == 7
    g = call.ground(rec, MERCHANT)
    assert g.usable and g.accepted["received"] == "yes" and g.accepted["recognises_charge"] == "yes"


def test_follow_stops_locally_at_the_timeout():
    fake = FakeCalle(polls=10_000)
    created = call.place(fake, dispute_id="du_1", phone=PHONE, **ORDER)
    ticks = iter(range(0, 100_000, 5))
    rec = call.follow(fake, created["id"], timeout=12, sleep=lambda s: None, clock=lambda: next(ticks))
    assert rec.timed_out and rec.status == "in_progress"
    assert not call.ground(rec, MERCHANT).usable


def test_a_call_nobody_answered_reads_as_failed():
    fake = FakeCalle("no-answer")
    created = call.place(fake, dispute_id="du_1", phone=PHONE, **ORDER)
    rec = call.follow(fake, created["id"], sleep=lambda s: None)
    assert rec.status == "failed" and rec.failure == "no_answer" and rec.turns == []


def test_evidence_document_is_a_pdf_with_the_number_masked(monkeypatch):
    from reportlab import rl_config
    monkeypatch.setattr(rl_config, "pageCompression", 0)  # keep page text searchable
    fake = FakeCalle()
    created = call.place(fake, dispute_id="du_1", phone=PHONE, **ORDER)
    rec = call.follow(fake, created["id"], sleep=lambda s: None)
    pdf = call.evidence_pdf(rec, call.ground(rec, MERCHANT), merchant=MERCHANT, order_id="1042",
                            dispute_id="du_1", phone=PHONE)
    assert pdf[:5] == b"%PDF-" and pdf.rstrip().endswith(b"%%EOF") and len(pdf) > 1000
    assert b"+12*****0101" in pdf and b"2125550101" not in pdf
