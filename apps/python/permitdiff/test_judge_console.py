from pathlib import Path


def test_judge_console_demonstrates_no_call_match_and_discrepancy_without_network():
    html = (Path(__file__).with_name("judge-console.html")).read_text(encoding="utf-8")
    assert "Deterministic reviewer mode · NO CALL" in html
    assert "no_call_needed" in html
    assert "verified_match" in html
    assert "discrepancy_detected" in html
    assert "only the municipality's official record" in html
    assert "fetch(" not in html
