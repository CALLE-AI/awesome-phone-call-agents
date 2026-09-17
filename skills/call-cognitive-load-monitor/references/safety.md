# Safety Reference — call-cognitive-load-monitor

## Consent Validity

The `consent_validity_flag` field is **advisory only**.

- `CONSENT_AT_RISK` means the transcript showed signals of high cognitive load during the closing phase where consent or commitment may have been recorded.
- It does **not** mean consent is legally invalid.
- It **does** mean a human should review the interaction and consider sending written confirmation.

**Never use this flag as a standalone basis for any legal or regulatory action.**

## False Positive Risk

Cognitive load inference from text is probabilistic. Common false-positive scenarios:

| Scenario | Why it can be flagged | Reality |
|---|---|---|
| Caller with a foreign accent asking clarifying questions | Clarification patterns trigger signals | Normal communication style |
| Professional jargon in B2B calls | Jargon density spike | Both parties understand the terminology |
| Very short callee responses | Low participation ratio | Caller is attentive, not overwhelmed |
| Callee repeating agent's offer back | Clarification pattern | Active listening technique |

Always interpret the flag in context. A single signal does not indicate overload.

## Privacy

- No raw transcript text is written to disk in the report output.
- Evidence snippets are limited to 100 characters.
- PII (phone numbers, email addresses) in evidence snippets is not redacted — this is inherent to the input data. Do not share reports containing caller PII without appropriate data handling controls.
- The `validate_load_report.py` validator scans for PII **in structured fields** (call_id, flags) and fails if found there.

## Not a Medical Device

This skill does not diagnose cognitive impairment, neurological conditions, or mental health states. It analyses conversational patterns for workload indicators in the context of call quality assurance only.

## Recommended Workflow

1. Run after every call where consent or commitment is recorded.
2. Human review all `CONSENT_AT_RISK` flags within 24 hours.
3. For `CRITICAL` load scores: send written confirmation before relying on verbal consent.
4. Feed `script_patches` back into script review cycle — do not apply automatically.
