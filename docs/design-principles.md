# Design Principles

This repository treats phone calls as real-world side effects.

## Principle 1: separate scheduling from calling

For recurring reminders, the default architecture is:

```text
Host scheduler handles recurrence.
Phone-call provider handles exactly one call per scheduled run.
```

This design makes skills portable across providers. A provider does not need recurring schedule support. It only needs to place or create one call when the host scheduler triggers the skill.

## Principle 2: require explicit intent

A skill must not place a real phone call unless the user has clearly asked for it, or unless a previously authorized scheduler job is running the skill in `run-now` mode.

Before using a fallback scheduler, a skill should discover feasible alternatives, summarize brief pros and cons, recommend the best option for the current request and environment, and ask the user to choose and confirm. This information should appear in the first user-facing response that asks the user to choose a scheduler, not only after a follow-up question. Local OS scheduling requires explicit user approval before creation.

## Principle 3: do not guess critical values

A skill must not guess:

- phone numbers
- country codes
- regions
- timezones
- reminder messages
- provider credentials
- scheduler job IDs
- confirmation tokens

## Principle 4: use IANA timezones

Recurring reminders should use IANA timezone names, such as `America/New_York` or `Europe/London`.

If the user does not provide a timezone, a skill may use a host-provided IANA timezone from runtime context, such as `Asia/Shanghai`. This is not guessing, but the final setup summary should disclose that the timezone came from host context.

Skills must not infer timezone from phone number, country code, locale, language, IP address, timezone abbreviation, or UTC offset.

Raw UTC offsets should not be the preferred format because they do not correctly handle daylight saving time.

## Principle 5: optimize for progressive disclosure

Keep `SKILL.md` focused. Move provider-specific and host-specific details into `references/` files.

This lets agents load the main workflow first and load detailed references only when needed.

## Principle 6: cancellation must be first-class

Every recurring workflow must explain how to stop it.

A good recurring phone-call skill should be able to:

- create a scheduler job
- verify that it exists
- update it without duplication
- disable or delete it
- explain the provider role clearly
