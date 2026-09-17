import pytest
from align_code_switching import CodeSwitchingAligner

def test_detect_cmi():
    aligner = CodeSwitchingAligner()
    
    # Pure English
    assert aligner.detect_cmi("I want to check my balance") == 0.0
    
    # High Code-Switching
    # "pero" and "no" are in the vocab. 2 out of 6 words = 0.333
    cmi_high = aligner.detect_cmi("pero I have no money left")
    assert round(cmi_high, 2) == 0.33
    
def test_process_turn_compliance():
    aligner = CodeSwitchingAligner()
    text = "pero I need help."
    
    # Must accept valid test number
    result = aligner.process_turn("555-0100", text)
    assert result["prompt_style_injection"] == "low_code_switching"
    
    # Must reject non-compliant number
    with pytest.raises(ValueError):
        aligner.process_turn("800-555-1234", text)
