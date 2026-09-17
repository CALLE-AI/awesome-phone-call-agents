# Examples

Here are practical usage examples for the Longitudinal Cognitive Decline Tracker.

## 1. Time-Series Analysis
```python
from cognitive_tracker import analyze_longitudinal_biomarkers

history = [
    {"timestamp": 1, "caller": "+1-555-0102", "avg_pause_ms": 400},
    {"timestamp": 2, "caller": "+1-555-0102", "avg_pause_ms": 500},
    {"timestamp": 3, "caller": "+1-555-0102", "avg_pause_ms": 550},
    {"timestamp": 4, "caller": "+1-555-0102", "avg_pause_ms": 650},
]
report = analyze_longitudinal_biomarkers(history)
print(report["status"]) # Significant cognitive degradation detected.
```
