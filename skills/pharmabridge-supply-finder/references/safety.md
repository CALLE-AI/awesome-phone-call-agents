# Safety rules for pharmabridge-supply-finder

## Explicit user intent

- Never place a call the user did not ask for. `discover` and `plan` never dial.
- Default every dispatch to `--routing simulation`. Switch to live routing only after the user
  says so for this specific dispatch, and tell them how many calls it will use.
- `--routing direct` reaches real businesses. Pass `--consent` only after the user confirms they are
  the patient or caregiver and authorize an AI agent to call those facilities on their behalf.

## Phone numbers

- Every destination is E.164. The server refuses anything else.
- Direct calls only reach numbers that PharmaBridge's own discovery signed, or numbers on the
  server allowlist. The helper never accepts a free-typed destination.
- Summaries show masked numbers (for example `+1 ••• ••• ••42`). Full numbers stay in the
  facility file for dialing and directions only.

## Credentials

- Never write the operator code, the CALL-E key, or any secret to disk, logs, or chat.
  Ask the user for the operator code each time it is needed.
- `pharmabridge-calls.json` stores short-lived, per-call access tokens that only allow reading that
  call's status. Delete the file when the task is done.

## Duplicates and cancellation

- Each call uses an idempotency key built from the mission, facility, and attempt, so a network retry
  never double-dials. Do not re-run `call` for the same facilities unless the user asks for a retry.
- There are no recurring jobs. To stop, simply don't place further calls. CALL-E has no cancel
  endpoint, so calls already placed run to completion.

## Medical, privacy, and emergency boundaries

- The agents ask about availability only. They never give medical advice, never suggest a different
  medication, strength, blood group, or component, and never agree to payments.
- Inquiry calls share no patient identity. Hold and reservation calls share only a first name and
  last initial (and, for blood, the hospital name).
- Every agent discloses that it is an AI and hangs up on voicemail without leaving a message.
- PharmaBridge is not an emergency service. If a life is at immediate risk, tell the user to contact
  the treating hospital or local emergency services first.
