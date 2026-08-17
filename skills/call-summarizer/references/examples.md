# Examples — call-summarizer

Worked examples of the brief produced for different CALL-E call outcomes. All
transcripts are fictional fixtures; all phone numbers are masked or fictional
reserved samples.

## 1. Appointment confirmation

Input transcript (excerpt):

```
Agent: Hello, this is an automated assistant calling from Example Clinic. May
       I confirm your appointment?
Callee: Yes, the Tuesday 10:00 one.
Agent: I will send a reminder the day before.
Callee: Great, thank you.
```

Expected brief:

```json
{
  "outcome": "Appointment confirmed for Tuesday 10:00.",
  "summary": "The callee confirmed the Tuesday 10:00 appointment and the agent committed to sending a reminder the day before.",
  "actions": [
    {
      "owner": "agent",
      "verb": "send reminder",
      "due": "2026-09-15",
      "category": "logistics",
      "source_span": "I will send a reminder the day before."
    }
  ],
  "sentiment": {
    "label": "positive",
    "justification": "Callee confirmed without hesitation."
  },
  "caller_fingerprint": "sha256:9f2c1a...",
  "masked": true
}
```

## 2. Reschedule request

Input transcript (excerpt):

```
Agent: Hello, calling to confirm your Wednesday 14:00 appointment.
Callee: I need to move it, I have a conflict.
Agent: I will ask the scheduler to offer a new slot. You will receive a call back.
Callee: Thank you, any time after 16:00 works.
```

Expected brief:

```json
{
  "outcome": "Reschedule requested; callee prefers after 16:00.",
  "summary": "The callee could not make the Wednesday 14:00 slot and asked to reschedule, preferring any time after 16:00. The agent will ask the scheduler to offer a new slot.",
  "actions": [
    {
      "owner": "agent",
      "verb": "ask scheduler to offer a new slot after 16:00",
      "due": null,
      "category": "logistics",
      "source_span": "I will ask the scheduler to offer a new slot."
    }
  ],
  "sentiment": {
    "label": "neutral",
    "justification": "Callee stated a conflict and a preference without frustration."
  },
  "caller_fingerprint": "sha256:b7e40d...",
  "masked": true
}
```

## 3. No answer

Input transcript:

```
Agent: Hello, this is an automated assistant calling from Example Clinic.
       (no response)
Agent: (end of call)
```

Expected brief:

```json
{
  "outcome": "No answer; call ended without contact.",
  "summary": "The call connected but the callee did not respond. No appointment status was established.",
  "actions": [],
  "sentiment": {
    "label": "unknown",
    "justification": "No respondent turn to classify."
  },
  "caller_fingerprint": "sha256:000000",
  "masked": true
}
```

## 4. Voicemail

Input transcript:

```
Agent: Hello, this is an automated assistant calling from Example Clinic. We
       are calling about your appointment. Please call us back at your
       convenience. (voicemail detected, message left: no)
```

Expected brief:

```json
{
  "outcome": "Voicemail reached; no message left.",
  "summary": "The call reached voicemail. No answer was established and no message was left.",
  "actions": [],
  "sentiment": {
    "label": "unknown",
    "justification": "Voicemail is not a respondent."
  },
  "caller_fingerprint": "sha256:111111",
  "masked": true
}
```

## 5. Sensitive (medical follow-up)

Input transcript (excerpt):

```
Agent: Calling about your medication follow-up. Did you pick up the prescription?
Callee: Yes, I started it yesterday.
Agent: I will note that for your provider.
```

Expected brief:

```json
{
  "outcome": "Medication pickup confirmed.",
  "summary": "The callee confirmed picking up and starting the prescription. The agent will note this for the provider.",
  "actions": [
    {
      "owner": "agent",
      "verb": "note prescription status for provider",
      "due": null,
      "category": "sensitive",
      "sensitive": true,
      "source_span": "I will note that for your provider."
    }
  ],
  "sentiment": {
    "label": "positive",
    "justification": "Callee confirmed the follow-up directly."
  },
  "caller_fingerprint": "sha256:c3a9f2...",
  "masked": true
}
```

## Reproducing these examples

Run the summarizer on the bundled fixture:

```bash
python3 scripts/summarize_call.py \
  --transcript references/example-transcript.json \
  --out /tmp/brief.json

python3 scripts/validate_brief.py --brief /tmp/brief.json
```

The fixture covers the confirmation and no-answer cases above. The reschedule,
voicemail, and sensitive cases are documented here as expected-output shapes;
the test suite checks the summarizer against all five patterns.
