import pytest
from self_scorer import SelfReflectionScorer

def test_evaluate_transcript():
    scorer = SelfReflectionScorer()
    
    res = scorer.evaluate_transcript("User: I don't know my account number! Agent: Please provide your account number.")
    assert res["score"] == 2
    assert "alternative verification" in res["recommendation"].lower()

def test_process_post_call_compliance():
    scorer = SelfReflectionScorer()
    transcript = "User: Hello. Agent: Hi."
    
    # Must accept valid test number
    result = scorer.process_post_call("555-0112", 0, transcript)
    assert result["source"] == "self_critique"
    
    # Must reject non-compliant number
    with pytest.raises(ValueError):
        scorer.process_post_call("415-555-2671", 5, transcript)
