# Cold Chain Reefer Triage Agent — Long-Form Guide

## Overview

Advisory voice-telephony triage agent skill for refrigerated freight logistics, powered by the **CALL-E Python SDK (`calle-ai`)** and **Pydantic V2**.

Refrigerated freight transportation ("reefer" logistics) involves carrying high-value, temperature-sensitive cargo (biologics, pharmaceuticals, fresh produce, frozen meat) where maintaining strict thermal setpoints is critical. A single trailer temperature excursion can result in $30,000 to $250,000+ in cargo write-offs, cross-contamination, or FDA / FSMA compliance violations.

The **Cold Chain Reefer Triage Agent** provides an automated, standardized voice interrogation workflow to contact commercial truck drivers during in-transit temperature excursions.

---

## Highlights

- **No-Call Default**: Safe dry-run simulation mode is active by default; outbound calls require explicit authorization (`--live` or `live=True`).
- **E.164 & HTTPS Validation**: Validates phone numbers strictly and enforces encrypted HTTPS endpoints.
- **Privacy Masking**: Automatically masks driver destination phone numbers across logs (`+1303***0147`).
- **Advisory Scope**: Extracts structured mechanical checks, cargo condition, and FMCSA HOS drive time for human dispatch review.
- **Zero-Redial**: Enforces exactly one call attempt; dropped or busy calls route to human dispatch rather than looping.

---

## Quickstart

```bash
# 1. Install dependencies
pip install calle-ai pydantic

# 2. Run in dry-run mode (no credentials needed)
python scripts/run_triage.py --phone +13035550147

# 3. Run with live authorization
export CALLE_API_KEY="your-calle-key"
python scripts/run_triage.py --phone +13035550147 --live
```

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
