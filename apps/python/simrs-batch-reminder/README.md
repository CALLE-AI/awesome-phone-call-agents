# SIMRS Batch Appointment Reminder

Batch outbound phone-call appointment reminder for Indonesian hospitals using CALL-E.

This app reads a list of upcoming patient appointments (from JSON, CSV, or SIMRS API), places a CALL-E voice call to each patient to confirm attendance, parses the conversation outcome, and optionally writes the result back to the hospital's SIMRS or SatuSehat FHIR endpoint.

## What It Does

1. Loads appointments from a JSON or CSV file (or directly from a SIMRS REST API)
2. For each appointment, places a natural-language CALL-E outbound call in Indonesian
3. Classifies the outcome: **confirmed**, **rescheduled**, **cancelled**, **no-answer**, or **contact error**
4. Writes the outcome back to SIMRS (optional)
5. Generates a batch summary report

## Setup

### Prerequisites

- Python 3.10+
- CALL-E CLI (`calle`) installed and authenticated
  - Install: see [CALL-E Installation Guide](https://github.com/CALLE-AI/call-e-integrations/blob/main/docs/install/CALL-E-installation-guide.md)
  - Auth: `calle auth login`

### No External Dependencies

This app uses only the Python standard library. No `pip install` needed.

## Usage

### Dry Run (no calls placed)

```bash
python3 client.py --appointments example_appointments.json --dry-run
```

### Live Run

```bash
python3 client.py --appointments example_appointments.json
```

### With SIMRS Writeback

```bash
python3 client.py --appointments example_appointments.json --simrs-url http://simrs.local/api
```

### Options

| Flag | Default | Description |
|---|---|---|
| `--appointments` | required | Path to JSON or CSV file |
| `--dry-run` | off | Simulate without placing calls |
| `--simrs-url` | none | SIMRS API base URL for writeback |
| `--delay` | 5 | Seconds between calls |
| `--repo-root` | `.` | Path to call-e-integrations repo |

## Input Format

### JSON

```json
[
  {
    "appointmentId": "APT-001",
    "patientName": "Budi Santoso",
    "phoneNumber": "+6285929931919",
    "doctorName": "Dr. Ahmad Ridwan",
    "department": "Poli Jantung",
    "appointmentDate": "2026-07-30",
    "appointmentTime": "09:00",
    "hospitalName": "RSUD Leuwiliang",
    "timezone": "Asia/Jakarta"
  }
]
```

### CSV

```csv
appointmentId,patientName,phoneNumber,doctorName,department,appointmentDate,appointmentTime,hospitalName,timezone
APT-001,Budi Santoso,+6285929931919,Dr. Ahmad Ridwan,Poli Jantung,2026-07-30,09:00,RSUD Leuwiliang,Asia/Jakarta
```

## Output

- Per-patient outcome: CONFIRMED / RESCHEDULED / CANCELLED / PENDING_RETRY / CONTACT_ERROR
- JSON results file: `reminder-results-YYYYMMDD-HHMMSS.json`
- Console batch summary table

## Safety Boundaries

- Patient consent required before calling
- No medical advice during calls
- Phone numbers masked in all reports
- Calling hours limited to 08:00–20:00 patient local time
- Maximum 2 retry attempts per appointment
- Emergency escalation to 112 / IGD

## Architecture

```
┌─────────────┐    ┌──────────────┐    ┌─────────────┐
│  Appointments│───▶│  This App    │───▶│  CALL-E     │
│  (JSON/CSV/ │    │  (Python)    │    │  (Voice)    │
│   SIMRS API)│◀───│              │◀───│             │
└─────────────┘    └──────────────┘    └─────────────┘
```
