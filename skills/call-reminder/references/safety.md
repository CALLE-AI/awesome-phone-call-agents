# Safety Reference

Phone-call reminders are real-world side effects. `call-reminder` must preserve explicit user control at setup time and strict execution boundaries at runtime.

## Explicit Intent

Create a recurring schedule only when the user clearly asks for a recurring phone-call reminder.

During a scheduled run, the scheduler payload is the prior user authorization. The run may place exactly one call only when all configured fields are present and valid.

Do not place a setup-time test call unless the user explicitly asks for a test call.

## Required Fields

Require these fields before creating a schedule:

- cadence
- local time
- IANA timezone
- E.164 phone number
- reminder message

Do not guess phone numbers, country codes, timezones, languages, or regions.

Do not infer timezone from country code, phone number, locale, IP address, UTC offset, or language. A host-provided IANA timezone is acceptable when the host exposes it unambiguously, and the setup summary should say it came from host context.

## Phone Numbers

Use E.164 numbers only. Documentation examples may use reserved fictional numbers, such as `+15550101234`.

Mask phone numbers in user-facing summaries. A common mask is to show the first two characters and last four digits, such as `+1******2671`.

The full phone number may appear inside the private scheduled runtime prompt because the scheduled run needs it to execute. Do not put full phone numbers in public logs, issue comments, commit messages, or README examples.

## Consent

Do not create a recurring call to a third-party number unless the user explicitly states that the recipient consented to recurring calls.

If consent is unclear, ask before creating the schedule.

## Credentials

Never expose:

- API keys
- OAuth tokens
- access tokens
- refresh tokens
- session cookies
- auth callback URLs
- confirmation tokens
- provider credentials

Do not ask the user to paste credentials into chat.

## Duplicate Jobs

Before creating a schedule, check whether the selected adapter can list or identify existing jobs. If a matching job exists, update it only when the user asked to update it or confirms replacement.

Do not create hidden recurring schedules. The setup summary must identify the scheduler and cancellation path.

## Runtime Boundaries

Each scheduled run may attempt exactly one one-off CALL-E reminder call.

The runtime must:

- call only the configured phone number
- use only the configured reminder message
- skip if more than the configured late-run window late
- skip if CALL-E auth is missing
- skip if the CLI or selected CALL-E route is unavailable
- skip if required fields are missing or malformed
- skip if the plan differs from the configured phone number or reminder message

Default late-run policy:

```text
If this scheduled run is more than 30 minutes late, skip the call.
```

## Sensitive Domains

For medical, legal, financial, or emergency reminders, handle reminder logistics only.

Do not provide diagnosis, dosage advice, treatment advice, legal advice, financial advice, emergency triage, or instructions that replace a qualified professional.

For emergency content, direct the user to local emergency services instead of creating a recurring reminder as a substitute for urgent help.

## Cancellation

Every successful setup summary must include cancellation or update instructions when the selected adapter supports them.

If the adapter cannot cancel programmatically, provide manual cancellation instructions and mark that limitation clearly.
