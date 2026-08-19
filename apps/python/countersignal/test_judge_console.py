from pathlib import Path


def test_judge_console_is_explicitly_no_call_and_contains_decision_states():
    html = (Path(__file__).with_name("judge-console.html")).read_text(encoding="utf-8")
    assert "Deterministic reviewer mode · NO CALL" in html
    assert "hypothesis_weakened" in html
    assert "Silence never enters the answered denominator" in html
    assert "fetch(" not in html
