# Safety & Privacy

## Advisory Scope
This skill detects speech disfluency (filled pauses, self-repairs) as a proxy for stress or hesitation. It is NOT a medical diagnostic tool, nor does it definitively prove emotional distress. The labels (`CALLEE_STRESSED`, `AGENT_HESITANT`) are advisory heuristics meant for QA human review.

## PII Masking
All extracted evidence strings are routed through `mask_pii()` which replaces 7+ digit numerical sequences with `#` (keeping the last two digits) to prevent leaking phone numbers, social security numbers, or credit cards in the report.

## Action Boundaries
The tool itself only emits a JSON report and a proposed goal for `plan_call`. It does not automatically initiate follow-up calls or terminate existing calls. Any action taken based on the output must be reviewed by a human operator.
