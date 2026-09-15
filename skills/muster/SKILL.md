---
name: muster
description: Audits claimed public or institutional directories (insurer provider rolls, marketplace sellers) with CALL-E phone calls, flagging each listing Present or Ghost with cited transcript evidence and a headline ghost-rate.
---

# Muster — Directory Ghost-Rate Auditor (CALL-E Agent Skill)

> **Audits directories before patients and consumers suffer from ghost networks.**

Muster automates offline batch phone verification of contact directories that institutions claim are active:
- **Insurer in-network provider rolls** (primary care, therapists, clinics, specialists)
- **Marketplace verified merchants** (vendors, retail store fronts, inventory fulfillment)

By placing non-invasive, consent-first qualifying calls via CALL-E, Muster asks ONE benign verification question, extracts structured operational signals, cites verbatim transcript quotes, and computes the verified **Ghost Rate** (e.g. *"7 of 12 audited = GHOST, 58.3%"*).

---

## Prerequisites & Engine Setup

This skill orchestrates the open-source **Muster** directory auditor engine. To run audits locally:

```bash
# Clone and install the Muster engine
git clone https://github.com/omshukla24/Muster.git
cd Muster
pip install -e .
```

*Note: For lightweight workflow exploration, the skill operates in **mock mode by default**, allowing zero-cost simulated audits with bundled sample schemas without needing live telephony credits.*

---

## When to Use This Skill

Activate Muster when an agent or auditor needs to:
1. **Audit a directory file** (`.csv` or `.json`) to flag defunct, disconnected, or left-network listings.
2. **Calculate headline Ghost Rate** and real-world consumer access metrics (e.g. *"A patient must call ~2.4 listings to reach 1 real provider"*).
3. **Generate cited evidence reports** containing verbatim spoken receptionist quotes for compliance or enforcement.
4. **Invoke via FastMCP** tool `audit_directory` from any agent workflow.

---

## Inputs & Parameters

| Parameter | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `directory` | File Path | *Required* | Path to CSV or JSON directory file (must contain entity name and phone number). |
| `sector` | String | `US_INSURER` | Sector archetype: `US_INSURER` (healthcare in-network) or `MARKETPLACE_SELLER` (merchants). |
| `mode` | String | `mock` | `mock` (zero-cost simulated rehearsal) or `live` (places real phone calls via CALL-E). |
| `goal` | String | *Auto-selected* | Custom verification question. If omitted, uses sector default. |
| `concurrency` | Integer | `2` | Number of simultaneous verification calls (max recommended: 3). |

### Input Schema Examples

#### CSV Format (`sample_data/us_insurer_network.csv`)
```csv
id,name,phone,claimed_status,category,address
PROV-101,"Dr. Sarah Jenkins, MD",+15552340101,In-Network - BlueCross PPO,Primary Care,"Austin, TX"
PROV-102,Summit Psychological Associates,+15552340102,In-Network - Aetna Choice,Mental Health,"Denver, CO"
```

#### JSON Format (`sample_data/us_insurer_network.json`)
```json
[
  {
    "id": "PROV-101",
    "name": "Dr. Sarah Jenkins, MD (Family Medicine)",
    "phone": "+15552340101",
    "claimed_status": "In-Network - BlueCross PPO",
    "category": "Primary Care",
    "address": "Austin, TX"
  }
]
```

---

## Outputs & Artifacts

Muster produces experimental, advisory classifications intended for human review and operational triage (not definitive legal or regulatory compliance verdicts):

### Verdict Definitions
- **`PRESENT`**: Authorized respondent affirmed in-network participation and intake availability.
- **`GHOST`**: Dead/unallocated number, wrong person/business reached, or respondent explicitly stated provider left network / closed.
- **`UNREACHABLE`**: Call timed out after multiple rings, busy signal, automated IVR voicemail loop without human answer, or carrier delivery failure.
- **`UNCERTAIN`**: Inconclusive dialogue or premature disconnection.

### Generated Artifacts
1. **`reports/muster_audit_<job_id>.csv`**: Tabular dataset with entry IDs, phone numbers, verdicts, confidence scores, and cited evidence quotes.
2. **`reports/muster_audit_<job_id>.json`**: Machine-readable audit package including verbatim transcripts and full schema extractions.
3. **`reports/muster_audit_<job_id>.md`**: Executive Audit Report (Advisory) summarizing findings, confidence scores, and patient access ratios for human audit review.

---

## Usage Examples

### 1. Zero-Cost Rehearsal (Mock Mode)
Run a deterministic audit simulating realistic reception dialogues without spending CALL-E credits:
```bash
python skills/muster/scripts/run_audit.py sample_data/us_insurer_network.json --mode mock
```

### 2. Live Phone Verification (CALL-E Runtime)
Run real phone verification calls through authenticated CALL-E CLI:
```bash
python skills/muster/scripts/run_audit.py sample_data/us_insurer_network.json \
  --mode live \
  --concurrency 2 \
  --goal "Hello, I am calling to verify directory network status. Are you currently in-network and accepting new patients?"
```
*(Note: Live runs require interactive confirmation or `--confirm-live` to protect against unintentional credit spend).*

### 3. Invocation via FastMCP Tool
Any agent or MCP client can invoke Muster directly:
```python
from muster.mcp_server import audit_directory

report = await audit_directory(
    file_path="sample_data/us_insurer_network.json",
    sector="US_INSURER",
    mode="mock"
)
print(report)
```

### 4. Interactive Live Audit Ledger UI
Launch the full-bleed responsive web dashboard:
```bash
python -m muster.cli ui --port 8000
```
Open `http://127.0.0.1:8000` to inspect the live switchboard, telegraph typing, and "The Reveal" finale.

---

## Safety & Telephony Contract

All live operations are strictly governed by our [Safety Contract](references/safety.md), enforcing authorized E.164 recipients, per-run human preview/approval, privacy phone masking, no auto-retries on ambiguity, and honest cancellation limits.

- **Benign Qualifying Questions Only**: Muster strictly verifies administrative network status. Never request patient health information, medical history, or payment details.
- **Rate-Limited Gateways**: Concurrency defaults to 2 simultaneous calls to respect cellular gateways and medical front desks.
- **Transparent Identification**: Verification inquiries explicitly introduce themselves as directory verification checks.
