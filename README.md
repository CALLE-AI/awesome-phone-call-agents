# Awesome Phone Call Skill

<div align="center">

**Portable phone-call skills, scheduler recipes, and safety patterns for AI agents.**

Package phone-call workflows as Agent Skills that agents can install, adapt, schedule, and operate safely.

[Quick start](#quick-install-and-start) · [Skills](#skill-list) · [CLI](#cli-reference) · [Templates](#templates) · [Safety](#safety-and-legal-guide) · [Contributing](#contributing)

![Agent Skills](https://img.shields.io/badge/Agent%20Skills-phone--call-blue)
![CALL-E](https://img.shields.io/badge/CALL--E-one--off%20calls-black)
![Schedulers](https://img.shields.io/badge/Schedulers-host--owned-purple)
![Safety](https://img.shields.io/badge/Safety-explicit%20intent-green)
![License](https://img.shields.io/badge/license-MIT-lightgrey)

</div>

> [!IMPORTANT]
> Phone-call workflows can create real-world side effects. Skills in this repository must require explicit user intent, E.164 phone numbers, visible cancellation behavior, credential-safe execution, and clear boundaries around who or what the agent may call.

## Table of Contents

- [Why this repository exists](#why-this-repository-exists)
- [Quick install and start](#quick-install-and-start)
- [What this repository provides](#what-this-repository-provides)
- [Reference skill: call-reminder](#reference-skill-call-reminder)
- [CLI reference](#cli-reference)
- [Templates](#templates)
- [Skill list](#skill-list)
- [Repository layout](#repository-layout)
- [Safety and legal guide](#safety-and-legal-guide)
- [Contributing](#contributing)
- [Developer docs](#developer-docs)
- [Community](#community)
- [License](#license)

## Why this repository exists

AI agents increasingly need to turn phone calls into reusable workflows: reminders, follow-ups, appointment coordination, provider-specific call adapters, scheduler integrations, safety checks, and reference implementations that other agents can install or adapt.

This repository exists to collect those phone-call capabilities and scenarios in a portable Agent Skills format. Each entry should help an agent package, schedule, execute, or safely operate a real phone-call workflow.

The scope is intentionally focused on AI-agent phone-call workflows, not generic voice-agent products, telephony vendor directories, or call-center software lists.

## Quick install and start

### 1. Choose a workflow

Start from the skill list when you want a ready-to-use phone-call workflow, or start from the templates when you want to contribute a new skill, adapter, scheduler recipe, or safety pattern.

The official example today is `call-reminder`, a daily reminder workflow that shows how to package one phone-call scenario as an installable skill with scheduling and safety boundaries.

### 2. Install a skill

For most users, the simplest path is to ask an Agent Skills-compatible client to install the specific skill you want. To try the official daily reminder example, install `call-reminder`:

```text
Install the portable call-reminder skill for this agent.

Use this command, replacing <agent-adapter> with the adapter for the current client:

npx skills add CALLE-AI/awesome-phone-call-skill --skill call-reminder -a <agent-adapter>

After installation:
1. Reload or restart the agent if the client requires it.
2. Use the skill only for explicit phone-call reminder requests.
3. Follow the skill's scheduler, consent, cancellation, and credential-safety rules.
```

Manual copy is also supported when a host does not support the CLI:

```text
skills/call-reminder/
```

### 3. Run the official daily reminder example

Use a fictional reserved number in demos and a real E.164 number only for your own authorized workflow.

```text
Set up a daily phone-call reminder at 09:00 America/New_York.
Use CALL-E when available.
My phone number is +15550101234.
The call should remind me to take my medicine according to my doctor instructions or the medication label.
```

The agent should create or update a visible scheduler job only when the current client can persist, run, and cancel it safely. The scheduled job then executes the runtime prompt and attempts exactly one one-off CALL-E call.

```text
auth status -> call plan -> call run -> call status
```

If the client cannot safely create the schedule, the skill must return `status: not created` with the exact blocker and a runtime prompt or setup instructions.

### 4. Daily reminder example fields

The official `call-reminder` example uses these fields. Other skills may define different inputs, but the same project safety rules still apply.

| Field | Required | Notes |
| --- | --- | --- |
| `cadence` | Yes | Recurrence such as `daily`. |
| `localTime` | Yes | `HH:MM` in 24-hour local time. |
| `timezone` | Yes | IANA timezone such as `America/New_York` or `UTC`. |
| `phoneNumber` | Yes | E.164 destination number. Mask it in user-facing summaries. |
| `reminderMessage` | Yes | Message to say during the reminder call. |
| `lateRunWindowMinutes` | No | Defaults to `30`; scheduled runs later than this should skip the call. |
| `clientAdapterId` | Required for runtime prompt rendering | Adapter id from the scheduler matrix. |
| `calleCommand` | No | Resolved CALL-E command or resolver. Defaults to the pinned `npx` placeholder for rendered prompts. |

## What this repository provides

| Area | What it gives agents |
| --- | --- |
| Agent Skill pattern | A portable `SKILL.md` workflow with progressive-disclosure references. |
| Scheduler recipes | Client adapter guidance for Codex App, Claude Code, OpenClaw, Cursor, external cron, MCP-only, shell-only, and related hosts. |
| Provider adapters | Patterns for connecting skills to call providers, CLIs, MCP routes, or host-native call tools. |
| Runtime prompt | A self-contained prompt template for scheduled executions. |
| CLI bootstrap | Resolver order for repository-local, global, and pinned `npx` CALL-E command routes. |
| Safety contract | Rules for explicit intent, phone-number handling, duplicate jobs, credentials, sensitive domains, and cancellation. |

## Reference skill: call-reminder

| Skill | Purpose | Status |
| --- | --- | --- |
| [`call-reminder`](skills/call-reminder/) | Schedules recurring CALL-E phone-call reminders by wrapping the existing one-off CALL-E workflow in the current client's scheduler or automation system. | Reference implementation |

`call-reminder` is a scheduler wrapper skill, not a new CALL-E backend reminder API, daemon, or provider-side recurring schedule.

### Use it for

- daily or recurring CALL-E phone reminders
- scheduled CALL-E calls where the scheduler belongs to the client, host, cron, or automation system
- "call me at a time" and "remind me by phone" workflows
- runtime prompt generation for scheduled one-off calls
- choosing the safest available scheduler adapter for the current client

### Do not use it to

- create CALL-E backend reminder APIs such as `create_call_reminder`, `list_call_reminders`, `update_call_reminder`, or `cancel_call_reminder`
- make provider-side recurrence mandatory
- install `calle` globally without explicit user approval
- guess phone numbers, country codes, timezones, languages, or regions
- create recurring calls to third-party numbers unless the user explicitly states that the recipient consented
- place a setup-time test call unless the user explicitly asks for one

### Create-time workflow

1. Confirm the user explicitly wants a recurring phone-call reminder.
2. Extract cadence, local time, IANA timezone, E.164 phone number, reminder message, and any user-provided language or region.
3. Ask for missing required fields. Do not infer them from locale, phone number, IP address, UTC offset, language, or country code.
4. Detect or choose the client adapter from [`client-adapters.md`](skills/call-reminder/references/client-adapters.md).
5. Resolve a CALL-E route from [`calle-cli-bootstrap.md`](skills/call-reminder/references/calle-cli-bootstrap.md), or use a safer native CALL-E skill, app, or MCP route when available.
6. Render the scheduled runtime prompt from [`runtime-prompt.md`](skills/call-reminder/references/runtime-prompt.md).
7. Create the scheduled task only through a scheduler that is actually available, visible, persistent, and cancellable.
8. If the schedule cannot be created safely, return `status: not created` with the exact blocker and setup instructions.

### Runtime workflow

Each scheduled run attempts exactly one one-off CALL-E reminder:

1. Determine whether the run is late in the configured timezone.
2. Skip the call if the run is more than the configured late-run window late.
3. Check CALL-E auth status.
4. Plan exactly one call to the configured phone number.
5. Inspect the plan before running it.
6. Run the plan only if it targets the configured phone number and uses the configured reminder message.
7. Check call status when the selected CALL-E route supports it.
8. Report success, skipped, or failed without exposing credentials.

### Expected setup result

```text
status: created
schedule: daily at 09:00 America/New_York
adapter: codex-app
phone: +1******1234
message: Remind me to take my medicine.
late-run policy: skip when more than 30 minutes late
call route: existing CALL-E one-off workflow
cancel: use the selected scheduler's automation cancellation flow
```

### Common blocked results

Missing phone number:

```text
I need the destination phone number in E.164 format before I can create the recurring phone-call reminder.
```

Missing timezone:

```text
I need the IANA timezone, such as America/New_York or Asia/Singapore, before I can create the recurring reminder.
```

No safe scheduler:

```text
status: not created
adapter: external-cron
blocker: no native recurring scheduler is available in this client
next step: configure an external scheduler with the rendered runtime prompt
```

More examples: [`skills/call-reminder/references/examples.md`](skills/call-reminder/references/examples.md).

## CLI reference

CALL-E CLI parameters and command flags are documented in [`cli-reference.md`](https://github.com/CALLE-AI/call-e-integrations/blob/main/packages/cli/docs/cli-reference.md).

The project-level validation script applies to the whole repository. The current Node.js helper scripts belong to the official `call-reminder` example and show the expected shape for future skill-specific utilities.

| Command | Purpose | Output |
| --- | --- | --- |
| `python3 scripts/validate_repository.py` | Validate required files, English-only repository content, skill frontmatter, and `call-reminder` acceptance text. | Prints `Repository validation passed.` or exits with an error. |
| `node skills/call-reminder/scripts/detect-client.mjs` | Detect a likely scheduler adapter from environment hints. | JSON with `adapterId`, `confidence`, and `reason`. |
| `node skills/call-reminder/scripts/detect-client.mjs --plain` | Print only the detected adapter id. | Plain adapter id such as `codex-app` or `external-cron`. |
| `node skills/call-reminder/scripts/validate-reminder-input.mjs [options]` | Validate structured reminder fields. | JSON `{ "ok": true, "value": ... }` or `{ "ok": false, "errors": ... }`. |
| `node skills/call-reminder/scripts/render-runtime-prompt.mjs [options]` | Render the self-contained scheduled-run prompt. | Runtime prompt text. |

## Templates

### Skill folder template

Use this Agent Skills folder pattern:

```text
skill-name/
├── SKILL.md
├── references/
├── scripts/
└── assets/
```

### `SKILL.md` template

```markdown
---
name: skill-name
description: Clear description of what the skill does and when to use it.
---

# Skill Name

Use this skill when ...

## When To Use

- ...

## When Not To Use

- ...

## Workflow

1. ...

## Safety Rules

- Require explicit user intent.
- Require E.164 phone numbers for call destinations.
- Mask phone numbers in user-facing summaries.
- Do not expose credentials.
- Do not create hidden recurring schedules or duplicate jobs.
- Explain cancellation behavior.
```

For portability, keep `name` lowercase with hyphens, keep `description` useful for discovery, avoid host-specific frontmatter in generic skills, and move long host-specific details into `references/`.

### Runtime prompt template

Scheduled reminder jobs in the official `call-reminder` example should use the rendered template from [`runtime-prompt.md`](skills/call-reminder/references/runtime-prompt.md). It also acts as a project reference for future scheduled phone-call skills. Required variables:

| Variable | Meaning |
| --- | --- |
| `{{cadence}}` | Requested recurrence. |
| `{{local_time}}` | Local scheduled time. |
| `{{timezone}}` | IANA timezone. |
| `{{phone_number}}` | Full E.164 phone number for the runtime payload. |
| `{{reminder_message}}` | Message to deliver. |
| `{{late_run_window_minutes}}` | Skip window for late scheduled runs. |
| `{{calle_command}}` | Resolved CALL-E command or resolver. |
| `{{client_adapter_id}}` | Selected scheduler adapter id. |

Render it with `render-runtime-prompt.mjs`; do not hand-edit runtime variables in a scheduler job when structured fields are available.

### Scheduler adapter template

Adapter references use this shape in [`client-adapters.md`](skills/call-reminder/references/client-adapters.md):

```yaml
id: adapter-id
displayName: Human-readable name
schedulerType: native_automation | native_routine | external_cron | manual | mcp_orchestrated | shell
schedulePersistence: persistent | session | external | unknown
requiresMachineAwake: true | false | depends
callERoute:
  - existing-calle-skill
  - calle-cli
  - calle-mcp
canCreateScheduleFromSkill: true | false | depends
supportsCancel: true | false | depends
lateRunRisk: low | medium | high
notes:
  - Short implementation notes.
```

### README list entry template

```markdown
- [Project Name](https://example.com) - One sentence explaining why this is useful for AI-agent phone-call workflows.
```

Keep descriptions short, specific, factual, and directly tied to packaging, scheduling, executing, or safely operating AI-agent phone-call tasks.

## Skill list

This project is an awesome list for AI-agent phone-call workflows. Add resources only when they directly help agents package, schedule, execute, or safely operate phone-call tasks.

Add new skills as a single list. The first skill in the list is:

- [`call-reminder`](skills/call-reminder/) - Scheduler wrapper skill for recurring CALL-E phone-call reminders.

### Provider adapters

- [`CALL-E CLI bootstrap`](skills/call-reminder/references/calle-cli-bootstrap.md) - Resolver order for repository-local, global, and pinned `npx` CALL-E CLI routes.

### Scheduler recipes

- [`Client adapter matrix`](skills/call-reminder/references/client-adapters.md) - Adapter guidance for Codex App, Claude Code, OpenClaw, Cursor, GitHub Copilot environments, external cron, MCP-only, and shell-only setups.
- [`Runtime prompt template`](skills/call-reminder/references/runtime-prompt.md) - Self-contained prompt used by scheduled jobs.
- [`Runtime prompt examples`](skills/call-reminder/references/examples.md) - Behavior checks for scheduler selection, timezone handling, region handling, and provider boundaries.

### Safety patterns

- [`Safety reference`](skills/call-reminder/references/safety.md) - Consent, E.164 phone-number handling, credential boundaries, duplicate-job prevention, cancellation, and sensitive-domain rules.
- [`Design principles`](docs/design-principles.md) - Architecture rules for portable phone-call skills.

## Repository layout

```text
awesome-phone-call-skill/
├── README.md
├── AGENTS.md
├── CONTRIBUTING.md
├── SECURITY.md
├── docs/
│   ├── design-principles.md
│   ├── codex-implementation-plan.md
│   └── roadmap.md
├── scripts/
│   └── validate_repository.py
└── skills/
    └── call-reminder/
        ├── SKILL.md
        ├── references/
        │   ├── calle-cli-bootstrap.md
        │   ├── client-adapters.md
        │   ├── examples.md
        │   ├── runtime-prompt.md
        │   └── safety.md
        └── scripts/
            ├── detect-client.mjs
            ├── render-runtime-prompt.mjs
            └── validate-reminder-input.mjs
```

## Safety and legal guide

Phone calls are real-world side effects. Preserve these rules across the whole project: skills, provider adapters, scheduler recipes, automation patterns, reference implementations, and documentation.

### Safety rules

- Require explicit user intent before setup or execution.
- Collect the required destination, timing, task, and consent details before creating a call workflow.
- Do not infer critical call details from phone number, locale, IP address, UTC offset, language, or country code.
- Mask phone numbers in user-facing summaries. Documentation examples should use reserved fictional numbers such as `+15550101234`.
- Do not call any number except the configured E.164 phone number.
- Do not modify user-provided call goals or messages except for safety-preserving formatting.
- Do not create duplicate scheduled jobs or hidden recurring schedules.
- Do not create third-party recurring calls unless the user explicitly states recipient consent.
- Do not expose API keys, OAuth tokens, access tokens, refresh tokens, session cookies, auth callback URLs, confirmation tokens, or provider credentials.
- If auth is missing, the CLI is unavailable, the scheduler cannot access credentials, or required fields are ambiguous, skip the call or stop setup instead of guessing.
- Treat medical, legal, financial, and emergency reminders as logistics only.
- Every successful setup summary must include cancellation or update instructions when the selected adapter supports them.

### Legal and compliance notes

This repository does not provide legal advice. Contributors and users are responsible for complying with laws, platform rules, consent requirements, call-recording rules, telemarketing restrictions, emergency-service boundaries, and provider terms that apply to their workflow and jurisdiction.

Do not submit resources that hide calls from users, hide recurring jobs, bypass consent, expose credentials, or encourage contacting people who did not authorize the workflow.

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the full contribution guide.

### Contribution workflow

1. Choose a scoped contribution: skill, provider adapter, scheduler recipe, automation pattern, safety pattern, or reference implementation.
2. Confirm it directly helps AI agents package phone-call workflows.
3. Use the templates above for skill folders, `SKILL.md` frontmatter, adapter records, or README entries.
4. Add setup, usage, side-effect, and cancellation notes.
5. Use fictional or masked phone numbers in examples.
6. Keep repository-facing content in English.
7. Run validation before opening a pull request.

```bash
python3 scripts/validate_repository.py
```

High-quality additions should include a short description, compatibility notes, safety notes for real-world side effects, setup or install instructions, cancellation or rollback behavior for recurring workflows, and no secrets or personal data.

Out of scope: generic telephony vendor directories, marketing-only pages, call-center software lists without an AI-agent workflow, tools that require unsafe credential handling, and skills that hide phone calls, recurring jobs, or external side effects from the user.

## Developer docs

| Path | Role |
| --- | --- |
| [`skills/call-reminder/SKILL.md`](skills/call-reminder/SKILL.md) | Main progressive-disclosure skill entry point. |
| [`skills/call-reminder/references/client-adapters.md`](skills/call-reminder/references/client-adapters.md) | Scheduler adapter matrix and selection logic. |
| [`skills/call-reminder/references/calle-cli-bootstrap.md`](skills/call-reminder/references/calle-cli-bootstrap.md) | CALL-E CLI route resolution and scheduled-run rules. |
| [`skills/call-reminder/references/runtime-prompt.md`](skills/call-reminder/references/runtime-prompt.md) | Runtime prompt template for scheduler jobs. |
| [`skills/call-reminder/references/examples.md`](skills/call-reminder/references/examples.md) | Setup, validation, and failure examples. |
| [`skills/call-reminder/references/safety.md`](skills/call-reminder/references/safety.md) | Full safety contract. |
| [`docs/design-principles.md`](docs/design-principles.md) | Repository-wide architecture principles. |
| [`docs/codex-implementation-plan.md`](docs/codex-implementation-plan.md) | Codex-oriented implementation notes. |
| [`docs/roadmap.md`](docs/roadmap.md) | Planned improvements and open areas. |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Contribution scope and checklist. |
| [`SECURITY.md`](SECURITY.md) | Security reporting and credential-handling expectations. |

## Community

- Discord: [https://discord.gg/6AbXUzUV8w](https://discord.gg/6AbXUzUV8w)

## License

MIT. See [`LICENSE`](LICENSE).
