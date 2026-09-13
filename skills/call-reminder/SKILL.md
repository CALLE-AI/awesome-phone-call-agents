---
name: call-reminder
description: Schedule recurring CALL-E phone-call reminders, scheduled CALL-E calls, call-me-at-a-time requests, and remind-me-by-phone workflows by wrapping the existing one-off CALL-E call workflow in the current client's scheduler or automation system.
license: MIT
---

# Call Reminder

Use this skill when the user wants a recurring phone-call reminder such as "call me every day at 9:00 to remind me to take my medicine."

`call-reminder` is a scheduler wrapper skill. It does not add a CALL-E backend reminder API, a provider-side recurring schedule, a daemon, or new MCP tools. It turns a user-authorized reminder request into a self-contained scheduled task for the current client. Each scheduled run uses the existing CALL-E one-off call workflow to place exactly one reminder call.

## When To Use

Use this skill for:

- daily or otherwise recurring phone-call reminders
- scheduled CALL-E calls where the scheduler belongs to the client, host, cron, or automation system
- "call me at a time" and "remind me by phone" workflows
- converting a natural-language reminder request into a runtime prompt for a scheduled job
- choosing the safest available scheduler adapter for the current client

## When Not To Use

Do not use this skill to:

- create CALL-E backend reminder APIs such as `create_call_reminder`, `list_call_reminders`, `update_call_reminder`, or `cancel_call_reminder`
- make provider-side recurrence mandatory
- create a long-running daemon
- install `calle` globally without explicit user approval
- guess phone numbers, country codes, timezones, languages, or regions
- create recurring calls to third-party numbers unless the user explicitly states that the recipient consented
- place a test call during setup unless the user explicitly asks for a test call

## Core Create-Time Workflow

1. Confirm the user explicitly wants a recurring phone-call reminder.
2. Extract the reminder fields:
   - cadence, such as `daily`
   - local time in `HH:MM` 24-hour format
   - IANA timezone
   - E.164 destination phone number
   - reminder message
   - optional language and explicit region when the user provides them
3. Ask for any missing required field. Do not infer it from locale, phone number, IP address, UTC offset, reminder text, or prior unrelated context.
4. Detect or choose the current client adapter using `references/client-adapters.md` and, when useful, `scripts/detect-client.mjs`.
5. Resolve a CALL-E command using `references/calle-cli-bootstrap.md`.
6. Render a self-contained runtime prompt using `references/runtime-prompt.md` or `scripts/render-runtime-prompt.mjs`.
7. Create the scheduled task only through a scheduler that is actually available in the current client.
8. If the current client cannot safely create the schedule, return the runtime prompt and setup instructions. Do not claim the reminder was created.

## Runtime Workflow

Each scheduled run must execute exactly one one-off CALL-E reminder attempt:

1. Check whether the run is late. If it is more than the configured late-run window late, skip the call.
2. Check CALL-E auth status.
3. Plan exactly one call to the configured phone number.
4. Inspect the plan before running it.
5. Run the plan only if it targets the configured phone number and contains the configured reminder message.
6. Check call status when the CALL-E route supports it.
7. Report success, skip, or failure without exposing credentials.

Use this shape:

```text
auth status -> call plan -> call run -> call status
```

## CLI Bootstrap Reference

Read `references/calle-cli-bootstrap.md` before embedding a CALL-E command into a scheduled job.

Use the first working command:

1. repository-local `node packages/cli/bin/calle.js`
2. global `calle`
3. pinned `npx -y @call-e/cli@<repo-current-version>`

For ordinary interactive use, the pinned `npx` fallback is acceptable. For persistent scheduled reminders, prefer a stable command that will still exist when the scheduler runs later. If the scheduler environment cannot rely on network access, do not rely only on `npx`.

The runtime prompt must include the resolved command or the same resolver instructions because setup-time availability does not prove future scheduled-run availability.

## Scheduler Adapter Selection

Read `references/client-adapters.md` before creating a schedule.

Selection rules:

1. Prefer the current client's native scheduler when it is persistent, can run at the requested local time, and can access CALL-E auth.
2. Use an external scheduler adapter when the client can load skills but has no safe native recurring scheduler.
3. Use MCP-only or shell-only instructions when the client cannot create a schedule directly.
4. If no adapter can safely create the scheduled task, output the runtime prompt and mark the result as not created.

The skill controls how the call should run. The scheduler controls when it runs.

## Required Fields

For setup, require:

- `cadence`
- `localTime`
- `timezone`
- `phoneNumber`
- `reminderMessage`

Use `scripts/validate-reminder-input.mjs` to check these fields when a structured payload is available.

Phone numbers must be E.164. Mask phone numbers in user-facing summaries. The scheduled runtime prompt may contain the full phone number because it is the execution payload.

The default late-run window is 30 minutes.

## Safety Rules

Read `references/safety.md` for the full safety contract.

Always follow these rules:

- Phone calls are real-world side effects.
- Do not place a real call unless the user clearly requested it or a previously authorized scheduled run is executing.
- Do not call any number except the configured E.164 phone number.
- Do not expose tokens, auth callback URLs, confirmation tokens, access tokens, cookies, or credentials.
- Do not create duplicate scheduled jobs.
- Do not create hidden recurring schedules.
- Do not modify the reminder message except for safety-preserving formatting.
- Do not create third-party recurring calls unless the user explicitly states recipient consent.
- If auth is missing, the CLI is unavailable, the scheduler cannot access credentials, or required fields are ambiguous, skip the call or stop setup instead of guessing.
- Treat medical, legal, financial, and emergency reminders as logistics only.

## Output Format

After successful setup, report:

- schedule summary
- selected client adapter
- next run time when the scheduler provides it
- masked phone number
- reminder message
- CALL-E route
- late-run policy
- how to cancel or update when the adapter supports it

If setup was not created, report:

- `status: not created`
- selected or recommended adapter
- exact blocker
- runtime prompt or setup instructions
- what the user must provide or enable next

Never state that a schedule exists unless the client scheduler creation actually succeeded.
