import json
from dataclasses import dataclass, field
from enum import Enum
from typing import List, Dict, Any, Optional

class ClinicalStatus(str, Enum):
    INSUFFICIENT_DATA = "Insufficient data"
    STABLE = "No threshold-crossing pause trend in supplied data; not a cognitive assessment."
    DEGRADATION_DETECTED = "Increasing pause trend in supplied data; advisory only, not a diagnosis."

@dataclass
class CallRecord:
    timestamp: int
    avg_pause_ms: float
    caller: Optional[str] = None

@dataclass
class LongitudinalReport:
    clinical_review_recommended: bool
    degradation_slope: float
    data_points: int
    status: ClinicalStatus

def analyze_longitudinal_biomarkers(history: List[Dict[str, Any]]) -> LongitudinalReport:
    """
    Calculates an advisory pause-duration trend from supplied synthetic metadata.
    Uses basic linear regression logic on 'avg_pause_ms'.
    """
    report = LongitudinalReport(
        clinical_review_recommended=False,
        degradation_slope=0.0,
        data_points=len(history),
        status=ClinicalStatus.INSUFFICIENT_DATA
    )
    
    if len(history) < 3:
        return report
        
    # Compliance check for phone numbers (PR 288)
    for record in history:
        caller = record.get("caller")
        if caller and not caller.startswith("+1-555-01") and not caller.startswith("555-01"):
            raise ValueError(f"Compliance Error: Real phone numbers are prohibited. Use 555-01xx range. Got {caller}")

    # Sort history chronologically
    history_sorted = sorted(history, key=lambda x: x["timestamp"])
    
    # Extract pause lengths (y) against time index (x)
    y = [float(call.get("avg_pause_ms", 0)) for call in history_sorted]
    x = list(range(len(y)))
    
    # Calculate slope (linear regression)
    n = len(x)
    sum_x = sum(x)
    sum_y = sum(y)
    sum_xy = sum(x[i] * y[i] for i in range(n))
    sum_xx = sum(x[i] * x[i] for i in range(n))
    
    denominator = (n * sum_xx - sum_x * sum_x)
    if denominator == 0:
        slope = 0.0
    else:
        slope = (n * sum_xy - sum_x * sum_y) / denominator
        
    report.degradation_slope = round(slope, 2)
    
    # If the average pause length increases by more than 50ms per session over time
    if slope > 50.0:
        report.clinical_review_recommended = True
        report.status = ClinicalStatus.DEGRADATION_DETECTED
    else:
        report.status = ClinicalStatus.STABLE
        
    return report

if __name__ == "__main__":
    sample_history = [
        {"timestamp": 1, "avg_pause_ms": 300, "caller": "555-0100"},
        {"timestamp": 2, "avg_pause_ms": 350, "caller": "555-0100"},
        {"timestamp": 3, "avg_pause_ms": 420, "caller": "555-0100"},
        {"timestamp": 4, "avg_pause_ms": 480, "caller": "555-0100"}
    ]
    rep = analyze_longitudinal_biomarkers(sample_history)
    print(json.dumps(rep.__dict__, default=lambda o: o.value if isinstance(o, Enum) else str(o), indent=2))
