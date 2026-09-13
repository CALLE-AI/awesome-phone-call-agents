import json
from pathlib import Path

from ringfence.audit import build_audit_report, render_terminal_report

FIXTURES_DIR = Path(__file__).resolve().parent.parent / "fixtures"


def _load(name: str) -> dict:
    return json.loads((FIXTURES_DIR / name).read_text(encoding="utf-8"))


def test_audit_report_pairs_every_question_with_its_answer_for_a_full_conversation():
    record = _load("13_scam_ceo_fraud_secrecy_and_urgency.json")
    report = build_audit_report(record)

    assert report["case_id"] == "case_f13"
    assert report["disposition"]["disposition"] == "ADVISE_BLOCK"
    assert len(report["verification_qa"]) == 3
    assert all(qa["answer"] is not None for qa in report["verification_qa"])
    assert "private" in report["verification_qa"][0]["question"]
    assert "confidential" in report["verification_qa"][0]["answer"]


def test_audit_report_on_a_never_dialed_case_has_no_conversation_and_empty_signals():
    record = _load("09_rejected_before_ring_generic.json")
    report = build_audit_report(record)

    assert report["verification_qa"] == []
    assert report["signals"] == {}
    assert report["disposition"]["disposition"] == "ESCALATE_TO_HUMAN"
    assert report["call_outcome"]["outcome"] == "rejected_before_ring"


def test_audit_report_masks_the_dialed_phone_number():
    record = _load("13_scam_ceo_fraud_secrecy_and_urgency.json")
    report = build_audit_report(record)

    assert record["case"]["on_file_phone"] not in report["dialed_phone_masked"]
    assert "*" in report["dialed_phone_masked"]


def test_terminal_report_renders_disposition_and_every_qa_pair():
    record = _load("13_scam_ceo_fraud_secrecy_and_urgency.json")
    report = build_audit_report(record)
    rendered = render_terminal_report(report)

    assert "RECOMMENDATION: ADVISE_BLOCK" in rendered
    assert "ADVISORY ONLY" in rendered
    for qa in report["verification_qa"]:
        assert qa["question"] in rendered
        assert qa["answer"] in rendered


def test_terminal_report_on_no_conversation_case_says_so_explicitly():
    record = _load("09_rejected_before_ring_generic.json")
    report = build_audit_report(record)
    rendered = render_terminal_report(report)

    assert "(no conversation occurred)" in rendered


def test_qa_pairing_uses_the_real_calle_speaker_labels_not_a_guess():
    # Found by reading a provider transcript, not by review: CALL-E's
    # actual speaker label is "bot", not "agent" -- this module originally
    # hardcoded "agent"/"recipient" (a guess never checked against a real
    # transcript) and silently paired zero Q&A turns against any real
    # call, including a fully successful one.
    record = {
        "case": {
            "case_id": "case_real_shape",
            "account_holder_name": "Test Holder",
            "on_file_phone": "+14155550199",
            "claimed_transaction_amount": "500.00",
            "claimed_recipient": "Test Recipient",
            "claimed_payment_method": "wire",
        },
        "call": {"status": "completed", "task_completed": True, "failure_code": None, "failure_message": None},
        "attempts": [{
            "started_at": "2026-09-10T00:00:00Z",
            "completed_at": "2026-09-10T00:01:00Z",
            "transcript_turns": [
                {"speaker": "bot", "text": "Did anyone ask you to keep this private?"},
                {"speaker": "user", "text": "No."},
            ],
        }],
        "events": [],
        "signals": {},
    }
    report = build_audit_report(record)
    assert report["verification_qa"] == [
        {"question": "Did anyone ask you to keep this private?", "answer": "No."}
    ]
