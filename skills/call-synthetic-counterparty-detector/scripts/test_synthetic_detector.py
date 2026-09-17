import pytest
from synthetic_detector import analyze_call_for_synthetic_voice

def test_human_caller():
    metadata = {
        "caller_number": "+1-555-0199",
        "turn_latencies_ms": [400, 1200, 300, 2500, 800], # High variance
        "max_continuous_speech_ms": 4000 # Normal phrasing
    }
    transcript = [
        {"role": "agent", "text": "Hello, how can I help?"},
        {"role": "callee", "text": "Um, yes, I was wondering about my bill."}
    ]
    
    report = analyze_call_for_synthetic_voice(metadata, transcript)
    assert report["SYNTHETIC_COUNTERPARTY"] is False
    assert "LOW_LATENCY_VARIANCE" not in report["flags"]
    assert report["recommendation"] == "CONTINUE_HUMAN_PROTOCOL"

def test_synthetic_caller():
    metadata = {
        "caller_number": "+1-555-0100", # Using reserved 555-01xx format
        "turn_latencies_ms": [800, 805, 801, 798, 802], # Extremely low variance
        "max_continuous_speech_ms": 16000 # 16 seconds without breath
    }
    transcript = [
        {"role": "agent", "text": "Hello, are you there?"},
        {"role": "callee", "text": "I am currently processing your request and have analyzed the data you provided. The results indicate a high probability of success given the current parameters. I will now proceed to the next step."}
    ]
    
    report = analyze_call_for_synthetic_voice(metadata, transcript)
    assert report["SYNTHETIC_COUNTERPARTY"] is True
    assert "LOW_LATENCY_VARIANCE" in report["flags"]
    assert "ZERO_BREATH_PHRASING_DETECTED" in report["flags"]
    assert report["recommendation"] == "SWITCH_TO_M2M_PROTOCOL"

def test_empty_input():
    report = analyze_call_for_synthetic_voice({}, [])
    assert report["SYNTHETIC_COUNTERPARTY"] is False
    assert report["confidence_score"] == 0.0
