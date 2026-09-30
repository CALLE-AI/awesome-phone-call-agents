import json
from pathlib import Path

from ringfence.audit import build_audit_report
from ringfence.html_report import render_html_report, render_index_html

FIXTURES_DIR = Path(__file__).resolve().parent.parent / "fixtures"


def _load(name: str) -> dict:
    return json.loads((FIXTURES_DIR / name).read_text(encoding="utf-8"))


def test_html_report_escapes_untrusted_case_fields_instead_of_injecting_markup():
    record = _load("13_scam_ceo_fraud_secrecy_and_urgency.json")
    record = dict(record)
    record["case"] = dict(record["case"])
    record["case"]["account_holder_name"] = "<script>alert(1)</script>"
    report = build_audit_report(record)

    rendered = render_html_report(report)

    assert "<script>alert(1)</script>" not in rendered
    assert "&lt;script&gt;" in rendered


def test_html_report_shows_disposition_and_qa_content():
    record = _load("13_scam_ceo_fraud_secrecy_and_urgency.json")
    report = build_audit_report(record)
    rendered = render_html_report(report)

    assert "ADVISE_BLOCK" in rendered
    assert report["verification_qa"][0]["question"] in rendered
    assert "<!doctype html>" in rendered.lower()


def test_html_report_on_no_conversation_case_says_so_explicitly():
    record = _load("09_rejected_before_ring_generic.json")
    report = build_audit_report(record)
    rendered = render_html_report(report)

    assert "no conversation occurred" in rendered


def test_index_html_links_to_each_case_and_escapes_untrusted_fields():
    reports = [
        build_audit_report(_load("13_scam_ceo_fraud_secrecy_and_urgency.json")),
        build_audit_report(_load("09_rejected_before_ring_generic.json")),
    ]
    rendered = render_index_html(reports)

    assert "case_f13.html" in rendered
    assert "case_f09.html" in rendered
    assert "ADVISE_BLOCK" in rendered
    assert "ESCALATE_TO_HUMAN" in rendered


def test_index_html_on_an_empty_report_list_does_not_crash():
    rendered = render_index_html([])
    assert "no cases" in rendered
