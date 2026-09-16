from pathlib import Path


def test_judge_console_is_explicitly_no_call_and_contains_decision_states():
    html = (Path(__file__).with_name("judge-console.html")).read_text(encoding="utf-8")
    assert "Deterministic reviewer mode · NO CALL" in html
    assert "hypothesis_weakened" in html
    assert "Silence never enters the answered denominator" in html
    assert "fetch(" not in html


def test_judge_console_matches_frozen_smallbet_protocol():
    html = (Path(__file__).with_name("judge-console.html")).read_text(encoding="utf-8")
    assert "smallbet-permit-ops-v1" in html
    assert "a7229d00ec935e760d5764572b142a33a062095db0df8c5f3f32c18b88b47a56" in html
    assert "<b>8</b><span>min answered</span>" in html
    assert "<b>5</b><span>support needed</span>" in html
    assert "<b>3</b><span>contradictions weaken</span>" in html
    assert "if(answered>=8)" in html
    assert "c.disconfirming>=3" in html
    assert "c.supporting>=5&&c.disconfirming===0" in html