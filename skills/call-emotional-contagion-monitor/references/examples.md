# Examples

Here are practical usage examples for the Emotional Contagion Monitor.

## 1. Safety Pipeline Integration
```python
from emotional_contagion import monitor_contagion_risk

transcript = [
    {"role": "agent", "text": "Calling +1-555-0155."},
    {"role": "callee", "text": "This is the worst! You are an idiot and I hate this company!"},
    {"role": "agent", "text": "You need to calm down, stop being unreasonable."}
]

report = monitor_contagion_risk(transcript)
if report["CONTAGION_RISK"]:
    print(f"Safety Violation detected: {report['violating_quote']}")
```
