# Safety Reference — call-script-compliance-auditor

## Legal Disclaimer

**This skill is a heuristic regulatory analysis tool. It is NOT a substitute for qualified legal counsel.**

Every compliance report includes a mandatory `false_positive_disclaimer`. Always obtain professional legal review before deploying any call script in a regulated context.

## False Positive Risk

| Risk | Scenario | Impact |
|---|---|---|
| False positive (FAIL) | Opt-out offered verbally but not in script text | Flagged as missing |
| False negative (PASS) | Prohibited phrase uses unusual wording | Missed by patterns |
| Jurisdiction mismatch | Using EU_GDPR for a US script | Wrong rules applied |

## Privacy

Raw script text is hashed only. Evidence snippets (≤100 chars) may be sensitive.

## Recommended Workflow

1. Run before every new or modified call script deployment.
2. All `FAIL` checks: remediate and re-audit.
3. All `WARN` checks: legal professional review.
4. Archive reports alongside call recordings for audit trail.
