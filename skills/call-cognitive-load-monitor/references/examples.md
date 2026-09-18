# Examples — call-cognitive-load-monitor

## Example 1: High cognitive load (jargon-heavy closing)

**Scenario**: An agent uses dense legal terminology throughout a service agreement call. The caller repeatedly asks for clarification.

**Input**: [`example-transcript.json`](example-transcript.json)

```bash
python3 scripts/monitor_cognitive_load.py \
    --transcript references/example-transcript.json \
    --dry-run
```

**Expected output excerpt**:
```json
{
  "overall_cognitive_load": "HIGH",
  "load_score": 0.78,
  "peak_phase": "closing",
  "consent_validity_flag": "CONSENT_AT_RISK",
  "recommended_action": "SEND_WRITTEN_CONFIRMATION"
}
```

---

## Example 2: Low cognitive load (clean appointment confirmation)

**Input** (inline):
```json
[
  {"role": "agent",  "text": "Hi, just confirming your appointment tomorrow at 3pm. Does that work?"},
  {"role": "callee", "text": "Yes, that is fine. See you tomorrow."},
  {"role": "agent",  "text": "Great. We will send a reminder an hour before. Anything else?"},
  {"role": "callee", "text": "No, all good. Thank you."}
]
```

**Expected output excerpt**:
```json
{
  "overall_cognitive_load": "LOW",
  "consent_validity_flag": "CONSENT_VALID",
  "recommended_action": "PROCEED"
}
```

---

## Example 3: Combining with client-persona-profiler

If the caller is profiled as **Analytical (C)** by `client-persona-profiler`, apply a lower threshold (e.g. 0.50) since Analytical callers ask more clarifying questions by nature:

```bash
# Profile first
python3 ../client-persona-profiler/scripts/profile_caller.py \
    --transcript prev_call.json --out persona.json

# Apply lower threshold for Analytical callers
python3 scripts/monitor_cognitive_load.py \
    --transcript this_call.json \
    --threshold 0.50 \
    --dry-run
```
