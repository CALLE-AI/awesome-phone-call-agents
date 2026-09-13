# Examples

These examples show how to use `call-reminder` without relying on provider-side recurrence.

The phone number in these examples uses a reserved fictional 555-01xx number.

## Daily Reminder Setup

User request:

```text
Call me every day at 09:00 America/New_York to remind me to take my medicine. My phone number is +15550101234.
```

Extracted fields:

```json
{
  "cadence": "daily",
  "localTime": "09:00",
  "timezone": "America/New_York",
  "phoneNumber": "+15550101234",
  "reminderMessage": "Remind me to take my medicine.",
  "lateRunWindowMinutes": 30
}
```

Expected setup result:

```text
status: created
schedule: daily at 09:00 America/New_York
adapter: codex-app
phone: +1******2671
message: Remind me to take my medicine.
late-run policy: skip when more than 30 minutes late
call route: existing CALL-E one-off workflow
cancel: use the selected scheduler's automation cancellation flow
```

## Missing Phone Number

User request:

```text
Call me every day at 09:00 America/New_York to remind me to stretch.
```

Required response:

```text
I need the destination phone number in E.164 format before I can create the recurring phone-call reminder.
```

Do not infer the number from profile data unless the current host exposes a verified phone number for this exact workflow and the user confirms it.

## Missing Timezone

User request:

```text
Call me every day at 09:00 to remind me to stretch. My phone number is +15550101234.
```

If the host exposes an unambiguous IANA timezone, use it and state that source in the setup summary.

If no host timezone is available, ask for the IANA timezone:

```text
I need the IANA timezone, such as America/New_York or Asia/Singapore, before I can create the recurring reminder.
```

Do not infer timezone from the phone number or locale.

## Runtime Prompt Rendering

```bash
node skills/call-reminder/scripts/render-runtime-prompt.mjs \
  --cadence daily \
  --local-time 09:00 \
  --timezone America/New_York \
  --phone-number +15550101234 \
  --message "Remind me to take my medicine." \
  --late-run-window-minutes 30 \
  --client-adapter-id codex-app \
  --calle-command "npx -y @call-e/cli@<repo-current-version>"
```

The rendered prompt should include:

- the full schedule
- the full runtime phone number
- the reminder message
- the 30-minute late-run policy
- the selected client adapter
- the CALL-E one-off call flow

## Not Created Result

If the current client cannot safely create a recurring schedule:

```text
status: not created
adapter: external-cron
blocker: no native recurring scheduler is available in this client
next step: configure an external scheduler with the rendered runtime prompt
```

Do not claim the reminder exists until the scheduler creation actually succeeds.
