import json
from pathlib import Path

from ringfence.cli import main

FIXTURES_DIR = Path(__file__).resolve().parent.parent / "fixtures"


def test_case_audit_prints_report_and_writes_json_and_html(tmp_path: Path, capsys):
    out_json = tmp_path / "audit" / "case_f13.json"
    out_html = tmp_path / "audit" / "case_f13.html"

    exit_code = main([
        "case", "audit",
        "--file", str(FIXTURES_DIR / "13_scam_ceo_fraud_secrecy_and_urgency.json"),
        "--out", str(out_json),
        "--html", str(out_html),
    ])

    assert exit_code == 0
    printed = capsys.readouterr().out
    assert "RECOMMENDATION: ADVISE_BLOCK" in printed

    report = json.loads(out_json.read_text(encoding="utf-8"))
    assert report["case_id"] == "case_f13"
    assert out_html.exists()
    assert "<!doctype html>" in out_html.read_text(encoding="utf-8").lower()


def test_case_report_index_builds_one_page_per_report_plus_an_index(tmp_path: Path):
    reports_dir = tmp_path / "reports"
    reports_dir.mkdir()
    for name in ("13_scam_ceo_fraud_secrecy_and_urgency.json", "09_rejected_before_ring_generic.json"):
        main(["case", "audit", "--file", str(FIXTURES_DIR / name), "--out", str(reports_dir / name)])

    out_dir = tmp_path / "html"
    exit_code = main([
        "case", "report-index",
        "--from-reports", str(reports_dir),
        "--out-dir", str(out_dir),
    ])

    assert exit_code == 0
    assert (out_dir / "index.html").exists()
    assert (out_dir / "case_f13.html").exists()
    assert (out_dir / "case_f09.html").exists()
    assert "case_f13.html" in (out_dir / "index.html").read_text(encoding="utf-8")
