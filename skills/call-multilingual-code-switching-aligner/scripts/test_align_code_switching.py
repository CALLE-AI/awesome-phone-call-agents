import pytest
from align_code_switching import CodeSwitchingAligner, PromptStyle

def test_detect_cmi():
    aligner = CodeSwitchingAligner()
    
    # Pure English
    cmi, embedded, total = aligner.detect_cmi("I want to check my balance")
    assert cmi == 0.0
    assert embedded == 0
    assert total == 6
    
    # High Code-Switching
    cmi_high, e_high, t_high = aligner.detect_cmi("pero I have no money left")
    assert round(cmi_high, 2) == 0.33
    assert e_high == 2
    assert t_high == 6

def test_edge_cases_empty_or_punctuation():
    aligner = CodeSwitchingAligner()
    
    # Empty string
    assert aligner.detect_cmi("")[0] == 0.0
    
    # Only punctuation
    assert aligner.detect_cmi("...,, !!!")[0] == 0.0
    
    # Whitespace
    assert aligner.detect_cmi("   ")[0] == 0.0

def test_process_turn_compliance():
    aligner = CodeSwitchingAligner()
    text = "pero I need help."
    
    # Must accept valid test number
    report = aligner.process_turn("555-0100", text)
    assert report.prompt_style_injection == PromptStyle.LOW_CODE_SWITCHING
    assert report.cmi > 0.0
    
    # Must reject non-compliant number
    with pytest.raises(ValueError) as exc:
        aligner.process_turn("800-555-1234", text)
    assert "Compliance Error" in str(exc.value)

def test_styles():
    aligner = CodeSwitchingAligner()
    
    # Monolingual
    r1 = aligner.process_turn("555-0199", "Hello there")
    assert r1.prompt_style_injection == PromptStyle.MONOLINGUAL
    
    # Low Code Switching
    r2 = aligner.process_turn("555-0199", "hola there my good friend")
    assert r2.prompt_style_injection == PromptStyle.LOW_CODE_SWITCHING
    
    # High Code Switching
    r3 = aligner.process_turn("555-0199", "hola pero no gracias")
    assert r3.prompt_style_injection == PromptStyle.HIGH_CODE_SWITCHING
