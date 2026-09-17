# Examples

## Example 1: Detecting Cognitive Degradation

**Input History:**
```python
history = [
    {"timestamp": 1672531200, "caller": "555-0102", "avg_pause_ms": 400},
    {"timestamp": 1675209600, "caller": "555-0102", "avg_pause_ms": 500},
    {"timestamp": 1677628800, "caller": "555-0102", "avg_pause_ms": 550},
    {"timestamp": 1680307200, "caller": "555-0102", "avg_pause_ms": 650},
]
```

**Output Report:**
```json
{
  "clinical_review_recommended": true,
  "degradation_slope": 80.0,
  "data_points": 4,
  "status": "Significant cognitive degradation detected."
}
```

## Example 2: Stable Patient

**Input History:**
```python
history = [
    {"timestamp": 1672531200, "caller": "555-0101", "avg_pause_ms": 400},
    {"timestamp": 1675209600, "caller": "555-0101", "avg_pause_ms": 395},
    {"timestamp": 1677628800, "caller": "555-0101", "avg_pause_ms": 405},
    {"timestamp": 1680307200, "caller": "555-0101", "avg_pause_ms": 390},
]
```

**Output Report:**
```json
{
  "clinical_review_recommended": false,
  "degradation_slope": -2.5,
  "data_points": 4,
  "status": "Stable cognitive markers."
}
```
