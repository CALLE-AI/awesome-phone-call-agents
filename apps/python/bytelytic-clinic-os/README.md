# Bytelytic Clinic OS — Autonomous Healthcare Phone Desk

[![Tests](https://img.shields.io/badge/tests-74%20passing-brightgreen)](tests/)
[![Python](https://img.shields.io/badge/python-%3E%3D3.10-blue)](pyproject.toml)
[![CALL-E SDK](https://img.shields.io/badge/CALL--E%20SDK-%3E%3D0.2.0-blueviolet)](https://heycall-e.com)
[![License](https://img.shields.io/badge/license-MIT-green)](../../LICENSE)
[![Dry-Run Safe](https://img.shields.io/badge/dry--run-safe%20by%20default-orange)](bytelytic_clinic/config.py)

Autonomous healthcare clinic operating system powered by CALL-E for outpatient medical practices. Replaces manual phone staff for appointment confirmations, no-show recovery, patient recalls, satisfaction surveys, and insurance prior authorization IVR navigation.

---

## Problem

US outpatient clinics lose **\$150 billion annually** from missed appointments. Front-desk staff spend hours on hold with insurance payors waiting for prior authorization decisions. Patient recall campaigns are skipped because staff have no time to manually call hundreds of overdue patients.

## Solution

Bytelytic Clinic OS connects clinical EHR scheduling data to CALL-E's autonomous voice infrastructure. AI agents make outbound calls on behalf of the clinic, extract structured outcomes, and stage proposed record changes for clinician review before any EHR mutation.

---

## Use Cases

| Campaign | Description | CALL-E Task Pattern |
|---|---|---|
| **24-Hour Confirmation** | Calls patients 24 hours before appointments | Confirms attendance, captures reschedule, delivers pre-op instructions |
| **2-Hour No-Show Recovery** | Calls missed patients within 2 hours | Checks wellbeing, offers immediate rebooking slot |
| **30/60/90-Day Recall** | Proactive outreach to overdue preventive care patients | Captures interest level and preferred visit window |
| **Post-Visit NPS Survey** | Captures 1-10 Net Promoter Scores after discharge | Records structured feedback and recommendation intent |
| **Prior Auth IVR Navigator** | Dials commercial payor lines, navigates hold trees | Extracts auth codes, denial reasons, rep names |

---

## Architecture

```
┌────────────────────────────────────────────────────────┐
│                   Bytelytic Clinic OS                  │
│                                                        │
│  ┌──────────┐  ┌───────────┐  ┌───────────────────┐  │
│  │  CLI     │  │ FastAPI   │  │  CALL-E Webhook   │  │
│  │  app.py  │  │  /calls/* │  │  /calle/webhook   │  │
│  └────┬─────┘  └─────┬─────┘  └────────┬──────────┘  │
│       │               │                  │             │
│       └───────────────┴──────────────────┘             │
│                        │                               │
│              ┌─────────▼──────────┐                   │
│              │   CalleAdapter     │                    │
│              │  (dry-run / live)  │                    │
│              └─────────┬──────────┘                   │
│                        │                               │
│         ┌──────────────┼──────────────┐               │
│         ▼              ▼              ▼               │
│  RecipientPolicy  AuditLedger   SimulatedEHR          │
│  (E.164 gate)    (SHA-256)      (Operator Gate)        │
│                                                        │
│                    CALL-E SDK                          │
│             calls.create_and_wait()                    │
└────────────────────────────────────────────────────────┘
```

---

## Safety & Governance

- **Dry-Run by Default:** All commands and endpoints default to safe fixture dry-runs (`DRY_RUN=true`).
- **API Key Authentication:** All `POST /calls/*` and `POST /calle/webhook` endpoints require `X-API-Key` or `Authorization: Bearer`.
- **Strict E.164 Validation & Phone Masking:** Phone numbers validated to `^\+[1-9]\d{1,14}$`. Masked in all user-facing responses (`+1555***2834`).
- **Authorized Recipient Gate:** Live calls gated to explicit `AUTHORIZED_RECIPIENTS` allowlist.
- **Operator-in-the-Loop EHR Gate:** Webhook results are staged for operator review before mutating clinical records (`ehr_mutation_gated: true`).
- **Tamper-Evident Audit Ledger:** Every dispatch event is recorded in a SHA-256 hash-chained append-only ledger.
- **PHI Sanitization:** Audit entries automatically scrub phone, DOB, and SSN fields from detail payloads.
- **Synthetic Demo Data:** All fixture records use synthetic identifiers (`Jane Doe`, `Oakridge Wellness Clinic`).

---

## Quickstart

### 1. Install

```bash
cd apps/python/bytelytic-clinic-os
pip install -r requirements.txt
```

### 2. Configure

```bash
cp .env.example .env
```

Live execution requires:

```env
CALLE_API_KEY=calle_live_your_actual_key
DRY_RUN=false
APP_API_KEY=your_secure_api_key
AUTHORIZED_RECIPIENTS=+15550192834
```

### 3. Run CLI (Dry-Run by Default)

```bash
# 24-Hour Confirmation
python app.py --campaign confirmation --phone "+15550192834"

# No-Show Recovery
python app.py --campaign no_show

# Prior Auth IVR
python app.py --campaign prior_auth

# 30-Day Patient Recall
python app.py --campaign recall

# Post-Visit NPS Survey
python app.py --campaign survey

# View Audit Ledger
python app.py --list-audit
```

### 4. Run API Server

```bash
python app.py --serve
# Server: http://127.0.0.1:8000
# Docs:   http://127.0.0.1:8000/docs
```

See [`examples/curl_quickstart.sh`](examples/curl_quickstart.sh) for cURL API examples.

---

## API Reference

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/health` | No | Service health and CALL-E mode status |
| `POST` | `/calls/confirmation` | `X-API-Key` | Dispatch 24-hour appointment confirmation call |
| `POST` | `/calls/no-show` | `X-API-Key` | Dispatch 2-hour no-show recovery call |
| `POST` | `/calls/prior-auth` | `X-API-Key` | Dispatch insurance prior authorization IVR call |
| `POST` | `/calle/webhook` | `X-API-Key` | Receive CALL-E terminal webhook with operator EHR gate |

---

## Tests

**74 unit and integration tests** across all modules:

```bash
pytest tests/ -v
```

| Test Module | Coverage |
|---|---|
| `test_phone_validation.py` | E.164 validation, masking, normalization |
| `test_schemas_and_models.py` | Domain models, extraction schemas, enum values |
| `test_policy_and_gating.py` | Allowlist gate, dry-run bypass, fail-closed logic |
| `test_calle_adapter.py` | All campaign dispatch, live gating, error paths |
| `test_ehr_adapter.py` | Seeded records, staging, operator approval |
| `test_webhook_and_server.py` | Auth enforcement, webhook gating, EHR transition |
| `test_cli_interface.py` | CLI argument dispatch, output validation |
| `test_audit_ledger.py` | Hash integrity, tamper detection, PHI sanitization |

---

## Project Layout

```
bytelytic-clinic-os/
├── bytelytic_clinic/
│   ├── config.py              # Environment configuration
│   ├── phone.py               # E.164 validation & masking
│   ├── domain/
│   │   ├── models.py          # Patient, Appointment, PriorAuth models
│   │   ├── schemas.py         # CALL-E structured extraction schemas
│   │   ├── policy.py          # Recipient allowlist & fail-closed policy
│   │   └── dispositions.py    # EHR state transition machine
│   └── adapters/
│       ├── calle_adapter.py   # CALL-E SDK client (dry-run + live)
│       ├── ehr_adapter.py     # Simulated EHR with operator staging
│       └── audit_ledger.py    # SHA-256 tamper-evident audit ledger
├── server.py                  # FastAPI server with API key auth
├── cli.py                     # CLI dispatcher
├── tests/                     # 66 pytest tests
├── examples/                  # JSON request/response examples + cURL scripts
├── fixtures/                  # Dry-run response fixtures (all 5 campaigns)
├── app.py                     # Top-level entrypoint
└── client.py                  # Backward-compatible client export
```
