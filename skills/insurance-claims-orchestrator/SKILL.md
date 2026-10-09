---
name: insurance-claims-orchestrator
description: Orchestrate a two-call consent-first insurance claims intake sequence with CALL-E. Call 1 collects a structured loss report from the policyholder. Call 2 verifies coverage using Call 1 results. Ambiguous outcomes route to human review. Introduces the first state-passing multi-call pattern in the repo.
license: MIT
---

# insurance-claims-orchestrator

Use this skill when an agent needs to initiate an insurance claim intake on behalf of a policyholder using two sequential CALL-E calls, where the structured result of Call 1 directly gates and informs Call 2.

This skill does **not** approve or deny claims, quote settlement amounts, or make commitments on behalf of the insurer. It gathers structured evidence and routes to a human adjuster.

## When To Use

- Initiate an insurance claim on behalf of a policyholder who has consented to automated contact
- Run a structured two-call sequence where results of Call 1 gate Call 2
- Return machine-readable claim intake data to a downstream adjuster or CRM system
- Demonstrate the state-passing multi-call pattern for other builders to copy

## When Not To Use

- Do not use to approve or deny claims
- Do not use to collect payment, SSN, or banking information
- Do not use when the policyholder has not explicitly consented to automated contact
- Do not use outside 8:00 AM to 9:00 PM recipient local time
- Do not use for collections, marketing, or unsolicited outreach

## Required Inputs

- `phone`: E.164 phone number of the policyholder, explicitly authorized
- `insurer_name`: display name disclosed on the call
- `consent`: must be `true`

Optional (live mode only):
- `CALLE_API_KEY`: environment variable, required only for `--live` execution

## Calls

### Call 1 — Loss Report

Contacts the policyholder to collect:
- Incident description (claimant's own words)
- Incident date (ISO 8601)
- Estimated damage in dollars (or `null` if declined)
- Policy number confirmation

**Exit gates — Call 2 is blocked if:**
- `outcome` is anything other than `"completed"`
- `policy_number_confirmed` is `null`
- Both `incident_description` AND `incident_date` are `null`

Any blocked gate routes to human review, not Call 2.

### Call 2 — Coverage Verification

Uses Call 1 results to confirm:
- Policy number (read back by claimant)
- Policy active status
- Coverage type applicability
- Prior claims in the last 12 months
- Adjuster follow-up timeline

## How to Run

**Dry-run (no calls, no API key needed):**

```bash
cd apps/typescript/insurance-claims-orchestrator
npm install
npm run dry-run
```

**Validate result fixtures against schema:**

```bash
npm run validate-schema
```

**Live (requires CALLE_API_KEY):**

```bash
export CALLE_API_KEY=your_key_here
npx tsx src/index.ts --phone +1XXXXXXXXXX --live
```

## Result Schemas

Both calls return structured JSON validated against `references/schema.json`.

**Call 1 — LossReportResult:**

| Field | Type | Notes |
|---|---|---|
| `outcome` | enum | completed / voicemail / no_answer / refused / unclear |
| `incident_description` | string or null | Claimant's own words |
| `incident_date` | string or null | ISO 8601 or null |
| `estimated_damage` | number or null | Dollar value or null |
| `policy_number_confirmed` | string or null | As spoken by claimant |

**Call 2 — CoverageVerifyResult:**

| Field | Type | Notes |
|---|---|---|
| `outcome` | enum | completed / voicemail / no_answer / refused / unclear |
| `policy_active` | boolean or null | Null if not established |
| `coverage_verified` | enum | yes / no / unknown — never guessed |
| `prior_claims_12mo` | boolean or null | Null if declined |
| `adjuster_notified` | boolean | Whether adjuster follow-up was communicated |
| `claimant_questions` | string or null | Verbatim unanswered questions |

## Safety Contract

See `references/safety.md`. Key rules:
- AI disclosure is mandatory at the start of both calls
- SSN, credit card, bank account, and password fields are never requested
- Coverage decisions are never made or implied on the call
- Ambiguous outcomes route to human review — never auto-retry unclear results
- Phone numbers masked in all logs: first 4 chars + asterisks
- Dry-run is the default — `--live` flag required for real calls

## Idempotency

Each call execution is keyed by `sha256(phone + step_id + incident_date)`.
Re-running with the same inputs within 24 hours is a no-op, not a second call.

## Files

```
skills/insurance-claims-orchestrator/
├── SKILL.md                    <- This file
├── references/
│   ├── safety.md               <- Safety contract and fail-closed dispositions
│   ├── schema.json             <- JSON Schema for both result shapes
│   └── two-call-pattern.md    <- Pattern guide for other builders
├── scripts/
│   ├── dry-run.ts              <- Fixture-based demo (no calls placed)
│   ├── validate-schema.ts      <- Validates result JSON against schema
│   └── fixtures/
│       ├── loss-report-result.json
│       └── coverage-verify-result.json
└── assets/
    └── sequence-diagram.md     <- Mermaid call flow diagram
```
