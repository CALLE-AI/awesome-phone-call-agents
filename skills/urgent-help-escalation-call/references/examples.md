# Examples

These examples are intentionally small and use fictional names. Use the fake CALL-E server for testing; do not ring a real person while validating the workflow.

## Correct recipient acknowledges

Trigger: Eleanor presses the help button. Thomas is the configured responder.

Expected call flow:

1. "Hello, this is Yadira. Am I speaking with Thomas?"
2. Thomas confirms.
3. "Eleanor has pressed the help button and is asking for you. Please go to them when you can."
4. "Are you able to get to them?"
5. Thomas says yes.

Expected structured result:

```json
{
  "reached": "caregiver",
  "acknowledged": "yes"
}
```

Stop the escalation ladder.

## Wrong person answers

Expected call flow:

1. "Hello, this is Yadira. Am I speaking with Thomas?"
2. The person says no.
3. "Sorry to have troubled you. Goodbye."
4. End the call without naming Eleanor or explaining the alert.

Expected structured result:

```json
{
  "reached": "someone_else",
  "acknowledged": "unknown"
}
```

Treat this as not delivered.

## Voicemail

Do not run the identity gate against voicemail and do not name the subject.

Safe message:

> This is Yadira calling for Thomas. There is an alert waiting in your app. Please check it now.

Expected structured result:

```json
{
  "reached": "voicemail",
  "acknowledged": "unknown"
}
```

A voicemail is not an acknowledgement. Continue to a configured backup contact or surface that nobody has yet confirmed.

## Repeated help-button presses

If the subject presses again inside the cooldown window, answer them in the app again but do not place another phone call. Record that the call was suppressed by the cooldown. The second press should never produce silence for the subject.

## No-call testing

Run one of the fake scenarios:

```bash
node scripts/fake-calle-api.mjs acknowledged
node scripts/fake-calle-api.mjs heardNotGoing
node scripts/fake-calle-api.mjs voicemail
node scripts/fake-calle-api.mjs noAnswer
node scripts/fake-calle-api.mjs stranger
```

Point the host application at `http://127.0.0.1:9099` with a test API key. The fake server returns CALL-E-compatible shapes without placing a call.
