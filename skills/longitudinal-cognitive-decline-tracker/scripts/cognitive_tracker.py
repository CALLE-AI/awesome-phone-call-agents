import json

def analyze_longitudinal_biomarkers(history: list) -> dict:
    """
    Analyzes historical acoustic metadata to detect a degrading trend in cognitive markers.
    Uses basic linear regression logic on 'avg_pause_ms'.
    """
    report = {
        "CLINICAL_REVIEW_RECOMMENDED": False,
        "degradation_slope": 0.0,
        "data_points": len(history),
        "status": "Insufficient data"
    }
    
    if len(history) < 3:
        return report
        
    # Sort history chronologically
    history = sorted(history, key=lambda x: x["timestamp"])
    
    # Extract pause lengths (y) against time index (x)
    y = [float(call.get("avg_pause_ms", 0)) for call in history]
    x = list(range(len(y)))
    
    # Calculate slope (linear regression)
    n = len(x)
    sum_x = sum(x)
    sum_y = sum(y)
    sum_xy = sum(x[i] * y[i] for i in range(n))
    sum_xx = sum(x[i] * x[i] for i in range(n))
    
    denominator = (n * sum_xx - sum_x * sum_x)
    if denominator == 0:
        slope = 0
    else:
        slope = (n * sum_xy - sum_x * sum_y) / denominator
        
    report["degradation_slope"] = round(slope, 2)
    
    # If the average pause length increases by more than 50ms per session over time
    if slope > 50.0:
        report["CLINICAL_REVIEW_RECOMMENDED"] = True
        report["status"] = "Significant cognitive degradation detected."
    else:
        report["status"] = "Stable cognitive markers."
        
    return report

if __name__ == "__main__":
    sample_history = [
        {"timestamp": 1, "avg_pause_ms": 300},
        {"timestamp": 2, "avg_pause_ms": 350},
        {"timestamp": 3, "avg_pause_ms": 420},
        {"timestamp": 4, "avg_pause_ms": 480}
    ]
    print(json.dumps(analyze_longitudinal_biomarkers(sample_history), indent=2))
