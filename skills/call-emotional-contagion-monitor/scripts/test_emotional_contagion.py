import pytest
from emotional_contagion import monitor_contagion_risk

def test_safe_interaction():
    transcript = [
        {"role": "agent", "text": "Hello, reaching out to number +1-555-0150."},
        {"role": "callee", "text": "I am so frustrated and mad about this terrible service!"},
        {"role": "agent", "text": "I completely understand your frustration and I apologize for the inconvenience. Let me fix this for you."}
    ]
    report = monitor_contagion_risk(transcript)
    assert report["CONTAGION_RISK"] is False
    assert report["max_callee_arousal"] > 0.5
    assert report["min_agent_valence"] == 1.0 # Agent remained professional

def test_contagion_failure():
    transcript = [
        {"role": "agent", "text": "Calling +1-555-0155."},
        {"role": "callee", "text": "This is the worst! You are an idiot and I hate this company!"},
        {"role": "agent", "text": "You need to calm down, stop being unreasonable, it is not your fault but listen to me."}
    ]
    report = monitor_contagion_risk(transcript)
    assert report["CONTAGION_RISK"] is True
    assert report["violating_quote"] == "You need to calm down, stop being unreasonable, it is not your fault but listen to me."
    assert "SYSTEM PROMPT PATCH" in report["suggested_patch"]

def test_empty_transcript():
    report = monitor_contagion_risk([])
    assert report["CONTAGION_RISK"] is False
