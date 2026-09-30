# Voice Scout PR description

## Summary

Adds a reusable Python app for business lead qualification through CALL-E Goal Runs.

## Contribution area

User-facing App: `apps/python/voice-scout/`

## Included

- Safe preview mode by default
- Explicit live-call boundary
- Generic business lead schema
- Stable idempotency keys
- Published Goal Run submission and polling
- Structured result handoff
- Synthetic example lead
- Generic Goal template
- Setup, safety, cancellation, and credential-handling notes

## Scope

This contribution is intentionally CRM-agnostic and business-domain agnostic. Cybersecurity is only one possible use case. No production CRM data, credentials, or real phone numbers are included.

## Validation

```bash
python3 app.py --demo
python3 -m py_compile app.py
```
