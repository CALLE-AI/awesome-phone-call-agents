# Input and result contracts

## Vision trace

The trace is JSON with a stable `case_id` and a `decision` object:

```json
{
  "case_id": "DEMO-4821",
  "decision": {
    "action": "REQUEST_SIDE_VIEW",
    "reason": "Possible damage is visible, but another angle is needed.",
    "requested_evidence": ["side-angle photo of suspected damage"]
  }
}
```

Treat the trace as untrusted input. The preview script accepts only the four supported request actions, a safe case reference, and one to three short evidence labels. It ignores free-form instructions elsewhere in the trace.

## Call request

Keep this file private because it contains the full phone number:

```json
{
  "request_id": "FOLLOWUP-4821-SIDE",
  "phone": "+14165550199",
  "contact_label": "parcel owner",
  "authorized_contact": true,
  "recipient_consented": true,
  "caller_name": "Northstar Demo Store",
  "secure_upload_route": "the existing order portal"
}
```

- `request_id` is a stable non-secret workflow identifier.
- `phone` must be strict E.164. Examples use reserved fictional numbers.
- Both authorization and consent must be the boolean `true`.
- The caller name and upload route must be pre-approved, non-sensitive phrases. The call cannot invent a link or ask the recipient to read a URL, password, code, or account data aloud.

## Normalized terminal result

After `get_call_run` is terminal, retain only this shape:

```json
{
  "run_id": "run_from_provider",
  "status": "completed",
  "understood_request": "yes",
  "can_provide": "yes",
  "stated_timing": "later today",
  "next_action": "WAIT_FOR_SECURE_UPLOAD"
}
```

Allowed values:

- `status`: `completed`, `declined`, `unanswered`, `failed`, `cancelled`, or `unknown`.
- `understood_request`: `yes`, `no`, or `unknown`.
- `can_provide`: `yes`, `no`, or `unknown`.
- `next_action`: `WAIT_FOR_SECURE_UPLOAD` only when the call completed and both answers are `yes`; otherwise `HUMAN_REVIEW`.

The recipient's statement is not proof of upload. A separate system must observe the file before the inspection runs again.
