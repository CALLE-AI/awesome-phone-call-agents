# Examples

Here are practical usage examples for the Synthetic Counterparty Detector.

## 1. Single API Call
```python
from synthetic_detector import analyze_call_for_synthetic_voice
import json

metadata = {
    "caller_number": "+1-555-0199",
    "turn_latencies_ms": [800, 805, 801, 798, 802],
    "max_continuous_speech_ms": 16000 
}
transcript = [
    {"role": "agent", "text": "Hello, are you there?"},
    {"role": "callee", "text": "I am currently processing your request."}
]

report = analyze_call_for_synthetic_voice(metadata, transcript)
print(json.dumps(report, indent=2))
```
