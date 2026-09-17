# Safety Reference — call-script-compliance-auditor

## Legal Disclaimer

**This skill is a heuristic regulatory analysis tool. It is NOT a substitute for qualified legal counsel.**

Every compliance report includes a mandatory `false_positive_disclaimer`. Always obtain professional legal review before deploying any call script in a regulated context.

## False Positive Risk

The heuristic pattern-matching engine can produce false positives and false negatives:

| Risk | Scenario | Impact |
|---|---|---|
| False positive (FAIL) | Opt-out offered verbally but not in transcript | Script flagged as missing opt-out |
| False negative (PASS) | Pressure tactic phrased in unusual words | Prohibited language not caught |
| Jurisdiction mismatch | Script for US used with EU_GDPR check | Irrelevant requirements checked |
| Multi-turn context | Disclosure made in a preamble script not provided | Required element appears absent |

## Privacy

- Raw script text is **not** stored in the compliance report. Only the SHA-256 hash is recorded.
- Evidence snippets (up to 100 characters) from the script may appear in check results. Handle these as sensitive business content.
- The audit log (the report JSON) may constitute a compliance-sensitive document. Store and transmit accordingly.

## Updating the Requirement Library

Regulations evolve. The built-in rule library (`audit_script.py` `RULES` dict) should be reviewed by a qualified legal professional:
- At least annually
- When a regulator publishes updated guidance
- When entering a new jurisdiction

## Recommended Workflow

1. Run `audit_script.py --dry-run` before every new or modified call script.
2. All `FAIL` checks must be remediated and re-audited before deployment.
3. All `WARN` checks must be reviewed by a legal professional.
4. Archive compliance reports alongside call recordings for audit trail purposes.
5. Treat `REQUIRES_LEGAL_REVIEW` flag as a mandatory gate before going live.
