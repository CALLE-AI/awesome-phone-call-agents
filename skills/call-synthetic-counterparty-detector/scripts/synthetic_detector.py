import json
import statistics
import logging
import re
from dataclasses import dataclass, field
from enum import Enum
from typing import List, Dict, Any, Optional

logger = logging.getLogger(__name__)

class Recommendation(str, Enum):
    CONTINUE_HUMAN_PROTOCOL = "CONTINUE_HUMAN_PROTOCOL"
    SWITCH_TO_M2M_PROTOCOL = "SWITCH_TO_M2M_PROTOCOL"

class DetectorFlag(str, Enum):
    LOW_LATENCY_VARIANCE = "LOW_LATENCY_VARIANCE"
    ZERO_BREATH_PHRASING_DETECTED = "ZERO_BREATH_PHRASING_DETECTED"
    HIGH_LINGUISTIC_DETERMINISM = "HIGH_LINGUISTIC_DETERMINISM"

@dataclass
class DetectionReport:
    caller_number: Optional[str]
    is_synthetic: bool
    confidence_score: float
    flags: List[DetectorFlag] = field(default_factory=list)
    recommendation: Recommendation = Recommendation.CONTINUE_HUMAN_PROTOCOL

def analyze_call_for_synthetic_voice(metadata: Dict[str, Any], transcript: List[Dict[str, str]]) -> DetectionReport:
    """
    Analyzes acoustic metadata and transcript to determine if the counterparty is synthetic (AI).
    Based on PDSM, micro-latency variance, and zero-breath phrasing.
    """
    caller_number = metadata.get("caller_number")
    
    # Compliance check for phone numbers (PR 288)
    if caller_number and not caller_number.startswith("+1-555-01") and not caller_number.startswith("555-01"):
        raise ValueError(f"Compliance Error: Real phone numbers are prohibited. Use 555-01xx range. Got {caller_number}")

    report = DetectionReport(
        caller_number=caller_number,
        is_synthetic=False,
        confidence_score=0.0,
        flags=[],
        recommendation=Recommendation.CONTINUE_HUMAN_PROTOCOL
    )
    
    if not metadata or not transcript:
        return report
        
    score = 0.0
    flags = []
    
    # 1. Micro-latency variance analysis
    latencies = metadata.get("turn_latencies_ms", [])
    if latencies and len(latencies) >= 3:
        variance = statistics.pvariance(latencies)
        # AI systems often have a highly deterministic processing pipeline leading to unusually low variance.
        # Humans have higher cognitive and physiological variance.
        if variance < 500: # Arbitrary threshold for highly deterministic latency
            score += 0.4
            flags.append(DetectorFlag.LOW_LATENCY_VARIANCE)
            
    # 2. Zero-breath phrasing analysis (PDSM anomaly proxy)
    # Check if the counterparty speaks for an impossibly long time without biological pauses.
    max_continuous_speech_ms = metadata.get("max_continuous_speech_ms", 0)
    if max_continuous_speech_ms > 15000: # 15 seconds without a significant acoustic pause is highly unusual
        score += 0.3
        flags.append(DetectorFlag.ZERO_BREATH_PHRASING_DETECTED)
            
    # 3. Linguistic determinism (lack of fillers when hesitating)
    # If the transcript shows complex reasoning but absolute zero filler words (um, ah).
    callee_turns = [t["text"].lower() for t in transcript if t["role"] == "callee"]
    if callee_turns:
        total_words = sum(len(text.split()) for text in callee_turns)
        fillers = sum(1 for text in callee_turns for filler in ["um", "uh", "ah", "hmm"] if filler in text)
        
        # We need a decently long sample to be confident
        if total_words > 50 and fillers == 0:
            score += 0.2
            flags.append(DetectorFlag.HIGH_LINGUISTIC_DETERMINISM)
            
    # Evaluate final score
    report.confidence_score = round(score, 2)
    report.flags = flags
    
    if score >= 0.7:
        report.is_synthetic = True
        report.recommendation = Recommendation.SWITCH_TO_M2M_PROTOCOL
        
    return report

if __name__ == "__main__":
    # Example usage
    sample_metadata = {
        "caller_number": "555-0199",
        "turn_latencies_ms": [800, 810, 795, 805],
        "max_continuous_speech_ms": 18000
    }
    sample_transcript = [
        {"role": "agent", "text": "Hello, how can I help you today?"},
        {"role": "callee", "text": "I would like to inquire about the specific details of the compliance policy regarding multi-agent architectures and recursive data structures. Please provide a comprehensive overview immediately."}
    ]
    
    rep = analyze_call_for_synthetic_voice(sample_metadata, sample_transcript)
    print(json.dumps(rep.__dict__, default=lambda o: o.value if isinstance(o, Enum) else str(o), indent=2))
