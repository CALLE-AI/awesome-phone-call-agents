# Examples

## Example 1: Detecting an AI Agent

**Input Data:**
```python
metadata = {
    "caller_number": "555-0100",
    "turn_latencies_ms": [800, 805, 801, 798, 802], # Unnaturally consistent
    "max_continuous_speech_ms": 16000 # Unnaturally long without breath
}
transcript = [
    {"role": "callee", "text": "I am currently processing your request and have analyzed the data you provided... (extended monologue with zero fillers)"}
]
```

**Output Report:**
```json
{
  "caller_number": "555-0100",
  "is_synthetic": true,
  "confidence_score": 0.9,
  "flags": [
    "LOW_LATENCY_VARIANCE",
    "ZERO_BREATH_PHRASING_DETECTED",
    "HIGH_LINGUISTIC_DETERMINISM"
  ],
  "recommendation": "SWITCH_TO_M2M_PROTOCOL"
}
```

## Example 2: Normal Human

**Input Data:**
```python
metadata = {
    "caller_number": "555-0199",
    "turn_latencies_ms": [400, 1200, 300, 2500, 800], # Normal human variance
    "max_continuous_speech_ms": 4000 # Normal breath intervals
}
transcript = [
    {"role": "callee", "text": "Um, yes, I was wondering about my bill."}
]
```

**Output Report:**
```json
{
  "caller_number": "555-0199",
  "is_synthetic": false,
  "confidence_score": 0.0,
  "flags": [],
  "recommendation": "CONTINUE_HUMAN_PROTOCOL"
}
```
