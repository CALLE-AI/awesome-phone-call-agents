# Cold Chain Reefer Triage Agent — Long-Form Guide

## Executive Overview

Refrigerated freight transportation ("reefer" logistics) involves carrying high-value, temperature-sensitive cargo (biologics, pharmaceuticals, fresh produce, frozen meat) where maintaining strict thermal setpoints is critical. A single trailer temperature excursion can result in $30,000 to $250,000+ in cargo write-offs, cross-contamination, or FDA / FSMA compliance violations.

The **Cold Chain Reefer Triage Agent** is an advisory, standalone voice-telephony skill powered by the **CALL-E Python SDK (`calle-ai`)**. It provides an automated, standardized voice interrogation workflow to contact commercial truck drivers during in-transit temperature excursions.

---

## Architecture & Operational Boundary

```
[IoT Telematics Excursion Alert]
               │
               ▼
   [Cold Chain Reefer Triage]
               │
   ├── 1. Pre-Flight Checks:
   │      - Strict E.164 phone validation (rejects invalid & emergency numbers)
   │      - Transport HTTPS validation
   │      - Masking of driver destination numbers (+1303***0147)
   │      - Safe No-Call Default: Dry-run simulation unless live=True explicitly passed
   │
   ├── 2. Autonomous In-Cab Call (CALL-E SDK, if live=True):
   │      - Confirms driver stopped in safe location
   │      - Inspects reefer engine & return air bulkhead clearance
   │      - Checks cargo sweating and unit alarm codes (e.g. Alarm 18)
   │      - Interrogates FMCSA 49 CFR Part 395 HOS drive time
   │      - Records driver remediation agreement option
   │
   └── 3. Structured Output Delivery:
          - Validated Pydantic V2 schema (`CallETriageOutput`)
          - Advisory summary delivered to fleet manager / human dispatcher
```

---

## Defensive Telephony Guarantees

1. **No-Call Default Execution**: By default, the skill operates in simulated preview mode (`live=False`), consuming zero credits and generating zero live telephone calls. Live calls require an explicit authorization flag (`--live` or `live=True`).
2. **Zero-Redial Policy**: To prevent distracted driving hazards and telephony loops, exactly one call is attempted. Dropped, unanswered, or busy calls yield structured failure outcomes for human operator alerting.
3. **Prompt Injection & Credential Isolation**: Transcripts and driver speech are treated as untrusted external data. Credentials remain strictly isolated in server-side environment variables and are never interpolated into prompt strings.
4. **Advisory Authority Gate**: Remediation selections (`selected_option`) are advisory outputs. Real-world route changes or dock bookings must be confirmed and executed by licensed human dispatchers.

---

## Reference Links

- [Skill Specification](../../skills/cold-chain-reefer-triage/SKILL.md)
- [Safety Rules](../../skills/cold-chain-reefer-triage/references/safety.md)
- [Operational Limits & Failure Modes](../../skills/cold-chain-reefer-triage/references/operational-limits.md)
- [Usage Examples](../../skills/cold-chain-reefer-triage/references/examples.md)
