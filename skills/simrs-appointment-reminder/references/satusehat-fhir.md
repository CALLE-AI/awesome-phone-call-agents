# SatuSehat FHIR Integration

## Overview

[SatuSehat](https://satusehat.kemkes.go.id) is Indonesia's national health data exchange platform built on HL7 FHIR R4. When a hospital uses SatuSehat, appointment reminder outcomes can be written back as FHIR resources.

## Relevant Resources

### FHIR Appointment

Used to track the original appointment and its status changes.

```json
{
  "resourceType": "Appointment",
  "status": "booked",
  "appointmentType": {
    "coding": [{
      "system": "http://terminology.hl7.org/CodeSystem/v2-0276",
      "code": "FOLLOWUP",
      "display": "A follow up visit from a previous appointment"
    }]
  },
  "reasonReference": [{
    "reference": "Condition/condition-id"
  }],
  "start": "2026-07-29T09:00:00+07:00",
  "end": "2026-07-29T09:30:00+07:00",
  "participant": [
    {
      "actor": { "reference": "Patient/patient-id" },
      "status": "accepted"
    },
    {
      "actor": { "reference": "Practitioner/practitioner-id" },
      "status": "accepted"
    }
  ]
}
```

### Appointment Status Mapping

| Call Outcome | FHIR Appointment.status |
|---|---|
| Confirmed | `booked` |
| Arrived (pre-confirmed) | `arrived` |
| Rescheduled | `cancelled` + new `Appointment` |
| Cancelled by patient | `cancelled` |
| No-show after retry | `noshow` |

### FHIR Encounter

Created when the patient arrives (pre-confirmed via phone call).

```json
{
  "resourceType": "Encounter",
  "status": "arrived",
  "class": {
    "system": "http://terminology.hl7.org/CodeSystem/v3-ActCode",
    "code": "AMB",
    "display": "ambulatory"
  },
  "type": [{
    "coding": [{
      "system": "http://snomed.info/sct",
      "code": "185349003",
      "display": "Encounter for check up"
    }]
  }],
  "subject": { "reference": "Patient/patient-id" },
  "participant": [{
    "individual": { "reference": "Practitioner/practitioner-id" }
  }],
  "appointment": [{
    "reference": "Appointment/appointment-id"
  }],
  "period": {
    "start": "2026-07-29T09:00:00+07:00"
  },
  "serviceProvider": { "reference": "Organization/org-id" }
}
```

### FHIR Communication

Logs the reminder call attempt for audit purposes.

```json
{
  "resourceType": "Communication",
  "status": "completed",
  "category": [{
    "coding": [{
      "system": "http://terminology.hl7.org/CodeSystem/communication-category",
      "code": "notification",
      "display": "Notification"
    }]
  }],
  "subject": { "reference": "Patient/patient-id" },
  "recipient": [{ "reference": "Patient/patient-id" }],
  "payload": [{
    "contentString": "Appointment reminder call: confirmed attendance"
  }],
  "sent": "2026-07-28T15:30:00+07:00",
  "note": [{
    "text": "CALL-E automated reminder. Outcome: CONFIRMED. Call duration: 45s."
  }]
}
```

## SatuSehat API

### Base URL

```
https://api-satusehat.dto.kemkes.go.id/fhir-r4/v1
```

### Authentication

SatuSehat uses OAuth 2.0 client credentials:

```
POST https://api-satusehat.dto.kemkes.go.id/oauth2/v1/accesstoken
Content-Type: application/x-www-form-urlencoded

client_id=<ORG_ID>&client_secret=<SECRET>&grant_type=client_credentials
```

### Write Appointment Update

```
PUT https://api-satusehat.dto.kemkes.go.id/fhir-r4/v1/Appointment/<id>
Authorization: Bearer <access_token>
Content-Type: application/fhir+json
```

### Create Encounter

```
POST https://api-satusehat.dto.kemkes.go.id/fhir-r4/v1/Encounter
Authorization: Bearer <access_token>
Content-Type: application/fhir+json
```

## ICD-10 Integration

When creating FHIR resources that reference diagnoses, use the Indonesian ICD-10 coding system:

```json
{
  "coding": [{
    "system": "http://hl7.org/fhir/sid/icd-10",
    "code": "I25.1",
    "display": "Atherosclerotic heart disease"
  }]
}
```

## Environment Variables

| Variable | Purpose |
|---|---|
| `SATUSEHAT_ORG_ID` | Organization ID from SatuSehat developer portal |
| `SATUSEHAT_CLIENT_ID` | OAuth client ID |
| `SATUSEHAT_CLIENT_SECRET` | OAuth client secret |
| `SATUSEHAT_BASE_URL` | API base URL (default: production) |
