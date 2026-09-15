---
name: simrs-appointment-reminder
description: Automate outbound phone-call appointment reminders for hospital patients through CALL-E, confirm attendance via natural voice conversation, and update the electronic health record (EHR / SIMRS) encounter status including SatuSehat FHIR integration for Indonesian healthcare.
license: MIT
---

# SIMRS Appointment Reminder

Use this skill when a hospital, clinic, or healthcare provider wants to call patients automatically to remind them about upcoming outpatient appointments, confirm attendance, reschedule, or cancel — and update the EHR system based on the patient's voice response.

`simrs-appointment-reminder` wraps the CALL-E one-off call workflow into a healthcare-specific appointment confirmation pipeline. Each scheduled run places one CALL-E call to a patient, parses the conversation outcome, and writes the result back to the hospital's SIMRS or SatuSehat FHIR endpoint.

## When To Use

Use this skill for:

- outbound appointment reminder calls to patients with upcoming outpatient visits
- confirming, rescheduling, or cancelling appointments through natural voice conversation
- updating SIMRS / EHR encounter status after a patient responds
- generating SatuSehat-compatible FHIR Encounter and Appointment resources from call outcomes
- batch reminder runs for next-day clinic schedules
- BPJS Kesehatan appointment compliance workflows

## When Not To Use

Do not use this skill to:

- handle inbound patient calls or emergency lines
- provide medical advice, diagnoses, or treatment decisions during the call
- replace clinical triage performed by licensed healthcare workers
- store or transmit patient health records through CALL-E metadata
- create recurring calls without hospital staff authorization
- call patients who have not consented to automated appointment reminders

## Architecture

```
┌─────────────────┐     ┌──────────────┐     ┌───────────────────┐
│  SIMRS / EHR    │────▶│  This Skill  │────▶│  CALL-E (voice)   │
│  (Appointment   │     │  Orchestrator│     │  Outbound call     │
│   DB / API)     │◀────│              │◀────│  to patient phone  │
└─────────────────┘     └──────────────┘     └───────────────────┘
        │                                            │
        ▼                                            ▼
┌─────────────────┐                         ┌──────────────┐
│  SatuSehat      │                         │  Voice       │
│  FHIR Server    │                         │  Transcript  │
│  (Encounter,    │                         │  + Outcome   │
│   Appointment)  │                         └──────────────┘
└─────────────────┘
```

**Data flow:**

1. **Read** upcoming appointments from SIMRS API (next-day or custom window)
2. **For each** appointment, construct a call goal with patient name, doctor, time, and poli
3. **Place** a CALL-E outbound call via `calle call start` or MCP `plan_call` + `run_call`
4. **Parse** the structured result to determine outcome: confirmed, rescheduled, cancelled, no-answer
5. **Write back** the outcome to SIMRS API and optionally create a FHIR Encounter resource

## Core Workflow

1. Confirm the hospital or clinic staff explicitly authorized the reminder batch.
2. Read the appointment source:
   - SIMRS REST API endpoint for upcoming appointments
   - CSV/JSON file export from the scheduling system
   - Manual single-appointment input from staff
3. For each appointment, extract:
   - patient name (for greeting)
   - patient phone number (E.164)
   - doctor name
   - appointment date and time
   - poli/department name
   - appointment ID (for writeback)
4. Detect or choose the current client adapter using `references/client-adapters.md`.
5. Resolve a CALL-E command using `references/calle-cli-bootstrap.md`.
6. Render a self-contained call goal using `references/runtime-prompt.md`.
7. Place the call and collect the structured result.
8. Map the outcome to a SIMRS status update.
9. Report the batch summary to the authorized staff.

## Call Goal Template

The call goal passed to CALL-E must follow this structure:

```
You are an automated appointment reminder assistant for [Hospital Name].

Call the patient to remind them about their upcoming appointment:
- Patient: [Patient Name]
- Doctor: Dr. [Doctor Name]
- Department: [Poli Name]
- Date: [Date] at [Time]

Your tasks:
1. Greet the patient politely using their name
2. Inform them about the appointment details
3. Ask if they can attend: "Apakah Bapak/Ibu bisa hadir?"
4. If they want to reschedule, ask for their preferred new time
5. If they cancel, acknowledge and note the reason
6. Thank them at the end

Always speak in the patient's language (default: Indonesian).
Be warm, professional, and respectful. This is a healthcare context.
Do NOT provide any medical advice or discuss health conditions.
```

## Outcome Mapping

| CALL-E Result | SIMRS Status | SatuSehat Encounter Status |
|---|---|---|
| Patient confirmed | `CONFIRMED` | `planned` → `arrived` |
| Patient rescheduled | `RESCHEDULED` | `cancelled` + new `Appointment` |
| Patient cancelled | `CANCELLED` | `cancelled` |
| No answer / voicemail | `PENDING_RETRY` | `planned` (no change) |
| Invalid number | `CONTACT_ERROR` | `planned` (flag for staff) |
| Patient declined | `DECLINED` | `cancelled` |

## SatuSehat FHIR Integration

When the hospital uses SatuSehat, the skill can generate:

- **FHIR Appointment** resource with status update
- **FHIR Encounter** resource linking patient, practitioner, and appointment
- **FHIR Communication** resource logging the reminder attempt

Read `references/satusehat-fhir.md` for resource schemas and API endpoints.

## Safety Rules

Read `references/safety.md` for the full safety contract.

Always follow these rules:

- **Patient consent is mandatory.** Do not call patients who have not opted in to automated reminders.
- **No medical advice.** The call must only confirm logistics (date, time, location). It must never discuss diagnoses, medications, or treatment plans.
- **Privacy first.** Do not log full patient names or health details in CALL-E metadata. Use appointment IDs only.
- **Mask phone numbers** in all summaries, logs, and reports.
- **Do not create hidden recurring schedules.** Each batch must be explicitly authorized by hospital staff.
- **Timezone awareness.** Hospital and patient may be in different timezones. Always use IANA timezone identifiers.
- **Calling hours.** Only call during reasonable hours (08:00–20:00 local patient time) unless hospital policy says otherwise.
- **Retry policy.** Maximum 2 retry attempts per appointment, spaced at least 2 hours apart.
- **Emergency boundary.** If a patient describes an emergency during the call, the CALL-E prompt must instruct them to call 112 or visit the nearest emergency department. The skill must not attempt emergency triage.

## Required Fields

For each appointment:

- `patientName` — display name for greeting
- `phoneNumber` — E.164 format
- `doctorName` — attending physician
- `appointmentDate` — ISO 8601 date
- `appointmentTime` — HH:MM 24-hour format
- `department` — poli or clinic name
- `hospitalName` — institution name
- `appointmentId` — unique ID for writeback
- `timezone` — IANA timezone (default: `Asia/Jakarta`)

## Output Format

After a batch run, report:

- total appointments processed
- confirmed count
- rescheduled count
- cancelled count
- no-answer count (eligible for retry)
- error count
- per-patient status table with masked phone numbers

If SIMRS writeback succeeded, include writeback status per patient.

## CLI Bootstrap Reference

Read `references/calle-cli-bootstrap.md` before embedding a CALL-E command into a scheduled job.

Use the first working command:

1. repository-local `node packages/cli/bin/calle.js`
2. global `calle`
3. pinned `npx -y @call-e/cli@<repo-current-version>`
