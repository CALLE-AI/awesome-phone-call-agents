# Examples

Three complete `task` and `result_schema` pairs, one per common call type. Each was checked with `scripts/check-call-script.mjs` and produces zero errors, zero warnings, and a score of 100/100. Use these as a starting shape, not as text to copy verbatim - the identification, purpose, and ask should always match the real call.

## 1. Appointment Confirmation

Task:

```text
This is Riverside Dental, calling on behalf of Dr. Alvarez's office about your upcoming appointment. Please confirm whether Tuesday at 2pm still works for you, or ask to reschedule if not. If you reach voicemail, leave a short message asking them to call the office back. Thank them for their time and end the call.
```

Result schema:

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["confirmation_status"],
  "properties": {
    "confirmation_status": {
      "type": "string",
      "description": "Use confirmed when the patient confirms Tuesday at 2pm, use reschedule_requested when they ask for a new time, and use unknown when the call did not reach a clear answer.",
      "enum": ["confirmed", "reschedule_requested", "unknown"]
    }
  }
}
```

## 2. On-Call Acknowledgement

Task:

```text
This is the Acme Platform on-call paging system, calling on behalf of the incident response team about a new Sev-1 incident, INC-4821, affecting checkout. Ask the on-call engineer to acknowledge the page and confirm whether they can begin investigating within the next 10 minutes. If you reach voicemail, leave a message with the incident number and ask them to acknowledge in the incident channel instead. Thank them and end the call once they acknowledge or decline.
```

Result schema:

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["acknowledgement_status"],
  "properties": {
    "acknowledgement_status": {
      "type": "string",
      "description": "Use acknowledged when the engineer confirms they will begin investigating within 10 minutes, use declined when they say they cannot respond, and use unknown when the call did not reach a clear answer.",
      "enum": ["acknowledged", "declined", "unknown"]
    }
  }
}
```

## 3. Lead Qualification

Task:

```text
This is Northwind Solar, calling on behalf of the sales team about the solar quote request you submitted online. Ask whether you are the homeowner and decision-maker for a potential solar installation, and find out whether you are looking to move forward in the next three months. If you reach voicemail, leave a short message with a callback number and do not call again today. Thank them for their time and end the call.
```

Result schema:

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["qualification_status"],
  "properties": {
    "qualification_status": {
      "type": "string",
      "description": "Use qualified when the contact confirms they are the homeowner or decision-maker and plans to move forward within three months, use not_qualified when they are not the decision-maker or not interested, and use unknown when the call did not establish a clear answer.",
      "enum": ["qualified", "not_qualified", "unknown"]
    }
  }
}
```

## Verifying These Examples

Each example above was checked directly:

```bash
node scripts/check-call-script.mjs --task "<task text>" --schema '<schema json>'
```

All three print `SUMMARY: 0 error(s), 0 warning(s), 0 info finding(s), score 100/100`. Re-run the linter after copying an example into a real call, since a phone number, name, or timeframe swapped in can change whether a check still passes - for example, dropping the voicemail sentence would immediately reintroduce `TASK_NO_VOICEMAIL_GUIDANCE`.
