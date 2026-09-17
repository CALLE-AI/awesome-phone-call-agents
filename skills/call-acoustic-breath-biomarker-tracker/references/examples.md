# Examples

## Example 1: Healthy Patient Check-in
The patient speaks fluently without frequent pauses. The pause-to-speech ratio is low.

**Initial Measurement**:
```json
{
  "caller_number": "555-0199",
  "pause_ratio": 0.12,
  "clinical_flag": "NORMAL",
  "recommended_action": "PROCEED_NORMALLY"
}
```
**Result**: The agent continues the standard health questionnaire script.

## Example 2: Dyspnea Detected
The patient struggles to complete a sentence: "I... am having... a lot of... chest tightness." The system detects an abnormal pause pattern indicative of respiratory distress.

**Measurement**:
```json
{
  "caller_number": "555-0100",
  "pause_ratio": 0.55,
  "clinical_flag": "DYSPNEA_DETECTED",
  "recommended_action": "ESCALATE_TO_HUMAN"
}
```
**Result**: The agent immediately says: "It sounds like you're having trouble breathing. Please stay on the line, I am transferring you to a clinical nurse right away," and executes the handoff.

## Example 3: Edge Case — No Audio Data
The caller is completely silent or the packet loss is so severe that no audio segments are detected.

**Measurement**:
```json
{
  "caller_number": "555-0155",
  "pause_ratio": 0.0,
  "clinical_flag": "INSUFFICIENT_DATA",
  "recommended_action": "INDETERMINATE"
}
```
**Result**: The agent falls back to semantic checks (e.g., "Are you still there? Can you hear me?") instead of triggering a false positive escalation.
