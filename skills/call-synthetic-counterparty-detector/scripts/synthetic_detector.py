import json
import statistics
import logging

logger = logging.getLogger(__name__)

def analyze_call_for_synthetic_voice(metadata: dict, transcript: list) -> dict:
    """
    Analyzes acoustic metadata and transcript to determine if the counterparty is synthetic (AI).
    Based on PDSM, micro-latency variance, and zero-breath phrasing.
    """
    
    report = {
        "SYNTHETIC_COUNTERPARTY": False,
        "confidence_score": 0.0,
        "flags": [],
        "recommendation": "CONTINUE_HUMAN_PROTOCOL"
    }
    
    if not metadata or not transcript:
        return report
        
    score = 0.0
    
    # 1. Micro-latency variance analysis
    latencies = metadata.get("turn_latencies_ms", [])
    if latencies and len(latencies) >= 3:
        variance = statistics.pvariance(latencies)
        # AI systems often have a highly deterministic processing pipeline leading to unusually low variance.
        # Humans have higher cognitive and physiological variance.
        if variance < 500: # Arbitrary threshold for highly deterministic latency
            score += 0.4
            report["flags"].append("LOW_LATENCY_VARIANCE")
            
    # 2. Zero-breath phrasing analysis (PDSM anomaly proxy)
    # Check if the counterparty speaks for an impossibly long time without biological pauses.
    max_continuous_speech_ms = metadata.get("max_continuous_speech_ms", 0)
    if max_continuous_speech_ms > 15000: # 15 seconds without a significant acoustic pause is highly unusual
        score += 0.3
        report["flags"].append("ZERO_BREATH_PHRASING_DETECTED")
        
    # 3. Linguistic determinism (lack of fillers when hesitating)
    # If the transcript shows complex reasoning but absolute zero filler words (um, ah).
    callee_turns = [t["text"].lower() for t in transcript if t["role"] == "callee"]
    if callee_turns:
        total_words = sum(len(text.split()) for text in callee_turns)
        fillers = sum(1 for text in callee_turns for filler in ["um", "uh", "ah", "hmm"] if filler in text)
        
        if total_words > 100 and fillers == 0:
            score += 0.2
            report["flags"].append("HIGH_LINGUISTIC_DETERMINISM")
            
    # Evaluate final score
    report["confidence_score"] = round(score, 2)
    if score >= 0.7:
        report["SYNTHETIC_COUNTERPARTY"] = True
        report["recommendation"] = "SWITCH_TO_M2M_PROTOCOL"
        
    return report

if __name__ == "__main__":
    # Example usage
    sample_metadata = {
        "turn_latencies_ms": [800, 810, 795, 805],
        "max_continuous_speech_ms": 18000
    }
    sample_transcript = [
        {"role": "agent", "text": "Hello, how can I help you today?"},
        {"role": "callee", "text": "I would like to inquire about the specific details of the compliance policy regarding multi-agent architectures and recursive data structures. Please provide a comprehensive overview immediately."}
    ]
    
    print(json.dumps(analyze_call_for_synthetic_voice(sample_metadata, sample_transcript), indent=2))
