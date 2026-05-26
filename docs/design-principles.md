# Design Principles

This repository treats phone calls as real-world side effects.

## Principle 1: separate scheduling from calling

For recurring reminders, the default architecture is:

```text
Host scheduler handles recurrence.
Phone-call provider handles exactly one call per scheduled run.
```

This design makes skills, apps, and examples portable across providers. A provider does not need recurring schedule support. It only needs to place or create one call when the host scheduler triggers the workflow.

## Principle 2: require explicit intent

A workflow must not place a real phone call unless the user has clearly asked for it, or unless a previously authorized scheduler job is running in an explicitly configured runtime mode.

Before using a fallback scheduler, a skill or app should discover feasible alternatives, summarize brief pros and cons, recommend the best option for the current request and environment, and ask the user to choose and confirm. This information should appear in the first user-facing response that asks the user to choose a scheduler, not only after a follow-up question. Local OS scheduling requires explicit user approval before creation.

## Principle 3: do not guess critical values

A skill, app, adapter, or example must not guess:

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

A good recurring phone-call workflow should be able to:

- create a scheduler job
- verify that it exists
- update it without duplication
- disable or delete it
- explain the provider role clearly

## Principle 7: examples are not SDKs

Examples should demonstrate an integration pattern with the smallest useful amount of code. They should not imply a supported application API unless the repository explicitly documents that contract.

Default example tests should run without live credentials or real outbound calls. Use fake servers, dry-run modes, or no-call plan-only flows by default. Live verification must be opt-in.

## Principle 8: apps need operational boundaries

Apps belong in this repository only when they help agents schedule, monitor, administer, or safely operate phone-call workflows.

Apps that can place calls, create schedules, or write back call results must document:

- setup and required credentials
- dry-run or preview behavior
- real-world side effects
- cancellation, rollback, or cleanup behavior
- where generated logs or results are stored
