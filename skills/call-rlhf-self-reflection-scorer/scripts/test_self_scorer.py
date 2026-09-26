import pytest
from self_scorer import SelfReflectionScorer, EvaluationSource

def test_evaluate_transcript_account_number():
    scorer = SelfReflectionScorer()
    res = scorer.evaluate_transcript("User: I don't have my account number! Agent: Please provide your account number.")
    assert res["score"] == 2
    assert "alternative verification" in res["recommendation"].lower()

def test_evaluate_transcript_frustration():
    scorer = SelfReflectionScorer()
    res = scorer.evaluate_transcript("User: I am so frustrated with this!")
    assert res["score"] == 3
    assert "empathy" in res["recommendation"].lower()

def test_evaluate_transcript_empty():
    scorer = SelfReflectionScorer()
    res = scorer.evaluate_transcript("   ")
    assert res["score"] == 0
    assert "empty" in res["critique"].lower()

def test_process_post_call_compliance():
    scorer = SelfReflectionScorer()
    transcript = "User: Hello. Agent: Hi."
    
    # Must accept valid test number
    result = scorer.process_post_call("555-0112", 0, transcript)
    assert result.source == EvaluationSource.SELF_CRITIQUE
    
    # Must reject non-compliant number
    with pytest.raises(ValueError) as exc:
        scorer.process_post_call("415-555-2671", 5, transcript)
    assert "Compliance Error" in str(exc.value)

def test_process_post_call_explicit_high():
    scorer = SelfReflectionScorer()
    transcript = "User: Great job."
    result = scorer.process_post_call("555-0199", 5, transcript)
    
    assert result.source == EvaluationSource.EXPLICIT_USER
    assert result.score == 5
    assert result.critique is None
    assert "Continue current strategy" in result.recommendation

def test_process_post_call_explicit_low():
    scorer = SelfReflectionScorer()
    transcript = "User: I don't have my account number."
    # If explicit score is low (e.g. 2), it should trigger critique to find WHY
    result = scorer.process_post_call("555-0199", 2, transcript)
    
    assert result.source == EvaluationSource.EXPLICIT_USER
    assert result.score == 2 # Score is retained from user
    assert result.critique is not None # But critique is generated
