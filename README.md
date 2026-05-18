# Awesome Phone Call Skill 📞

<div align="center">

**Portable phone-call skills, scheduler recipes, and safety patterns for AI agents.**

Package recurring phone-call workflows as Agent Skills without turning the phone-call provider into the scheduler.

**Host scheduler handles recurrence. Phone-call provider handles one call.**

[Quick install](#-quick-install) · [Quick start](#-quick-start) · [Reference skills](#-reference-skills) · [Safety](#-agent-safety-contract) · [Developer docs](#-developer-docs)

![Agent Skills](https://img.shields.io/badge/Agent%20Skills-phone--call-blue)
![CALL-E](https://img.shields.io/badge/CALL--E-one--off%20calls-black)
![Schedulers](https://img.shields.io/badge/Schedulers-host--owned-purple)
![Safety](https://img.shields.io/badge/Safety-explicit%20intent-green)
![License](https://img.shields.io/badge/license-MIT-lightgrey)

</div>

> [!IMPORTANT]
> Phone-call workflows can create real-world side effects. Skills in this repository must require explicit user intent, E.164 phone numbers, visible cancellation behavior, credential-safe execution, and exactly one provider call per scheduled run.

## 🚀 Quick install

For most users, the simplest path is to ask your local agent to install the reference skill with the skills CLI.

Copy this prompt into an Agent Skills-compatible client that can run shell commands:

```text
Install the portable call-reminder skill for this agent.

Use this command, replacing <agent-adapter> with the adapter for the current client:

npx skills add CALLE-AI/awesome-phone-call-skill --skill call-reminder -a <agent-adapter>

After installation:
1. Reload or restart the agent if the client requires it.
2. Use the skill only for explicit phone-call reminder requests.
3. Keep recurrence in the host scheduler.
4. Use CALL-E only for one one-off call per scheduled run.
```

Manual copy is also supported when the host does not support the CLI:

```text
skills/call-reminder/
```

## ⚡ Quick start

Ask the agent for a scheduled phone reminder in one message. Use a fictional reserved number in demos and a real E.164 number only for your own authorized workflow.

```text
Set up a daily phone-call reminder at 09:00 America/New_York.
Use CALL-E when available.
My phone number is +15550101234.
The call should remind me to take my medicine according to my doctor instructions or the medication label.
```

The skill should create or update a visible scheduler job only when the current client can persist, run, and cancel it safely. The scheduled job then executes the runtime prompt and attempts exactly one one-off CALL-E call.

```text
auth status -> call plan -> call run -> call status
```

If the client cannot safely create the schedule, the skill must return `status: not created` with the exact blocker and a runtime prompt or setup instructions.

## 🧠 What this repository provides

| Area | What it gives agents |
| --- | --- |
| Agent Skill pattern | A portable `SKILL.md` workflow with progressive-disclosure references. |
| Scheduler recipes | Client adapter guidance for Codex App, Claude Code, OpenClaw, Cursor, external cron, MCP-only, shell-only, and related hosts. |
| Provider separation | A default architecture where the host scheduler owns recurrence and CALL-E owns one call attempt. |
| Runtime prompt | A self-contained prompt template for scheduled executions. |
| CLI bootstrap | Resolver order for repository-local, global, and pinned `npx` CALL-E command routes. |
| Safety contract | Rules for explicit intent, phone-number handling, duplicate jobs, credentials, sensitive domains, and cancellation. |

## 🧩 Core principles

| Principle | Rule |
| --- | --- |
| Separate scheduling from calling | The host scheduler handles recurrence. The phone-call provider handles exactly one call per scheduled run. |
| Require explicit intent | Do not create a recurring phone-call workflow unless the user clearly asks for it. |
| Do not guess critical values | Require cadence, local time, IANA timezone, E.164 phone number, and reminder message. |
| Use visible schedulers | No hidden recurring jobs. Every successful setup needs a scheduler name and cancellation path. |
| Keep credentials private | Do not print, request, or expose tokens, auth callback URLs, confirmation tokens, cookies, or provider credentials. |
| Treat sensitive domains as logistics | Medical, legal, financial, and emergency reminders must not replace qualified professional help or urgent services. |

## 📦 Reference skills

| Skill | Purpose | Status |
| --- | --- | --- |
| [`call-reminder`](skills/call-reminder/) | Schedules recurring CALL-E phone-call reminders by wrapping the existing one-off CALL-E workflow in the current client's scheduler or automation system. | Reference implementation |

### `call-reminder`

`call-reminder` is a scheduler wrapper skill, not a new CALL-E backend reminder API, daemon, or provider-side recurring schedule.

Use it for:

- daily or recurring CALL-E phone reminders
- scheduled CALL-E calls where the scheduler belongs to the client, host, cron, or automation system
- "call me at a time" and "remind me by phone" workflows
- runtime prompt generation for scheduled one-off calls
- choosing the safest available scheduler adapter for the current client

Do not use it to:

- create CALL-E backend reminder APIs such as `create_call_reminder`, `list_call_reminders`, `update_call_reminder`, or `cancel_call_reminder`
- make provider-side recurrence mandatory
- install `calle` globally without explicit user approval
- guess phone numbers, country codes, timezones, languages, or regions
- create recurring calls to third-party numbers unless the user explicitly states that the recipient consented
- place a setup-time test call unless the user explicitly asks for one

## 🗂️ Repository layout

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

## ⚙️ CLI command map

Repository utilities:

```bash
python3 scripts/validate_repository.py

node skills/call-reminder/scripts/detect-client.mjs
node skills/call-reminder/scripts/detect-client.mjs --plain

node skills/call-reminder/scripts/validate-reminder-input.mjs \
  --cadence daily \
  --local-time 09:00 \
  --timezone America/New_York \
  --phone-number +15550101234 \
  --message "Remind me to take my medicine."

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

CALL-E command resolver order for scheduled jobs:

```bash
env CALLE_SOURCE=<client> CALLE_INTEGRATION=<integration> CALLE_INTEGRATION_VERSION=<version> \
  node packages/cli/bin/calle.js --help

env CALLE_SOURCE=<client> CALLE_INTEGRATION=<integration> CALLE_INTEGRATION_VERSION=<version> \
  calle --help

env CALLE_SOURCE=<client> CALLE_INTEGRATION=<integration> CALLE_INTEGRATION_VERSION=<version> \
  npx -y @call-e/cli@<repo-current-version> --help
```

One-off CALL-E flow used by scheduled runs:

```bash
calle auth status
calle call plan --to-phone +15550101234 --goal "Remind me to take my medicine."
calle call run --plan-id <plan_id> --confirm-token <confirm_token>
calle call status --run-id <run_id>
```

Do not replace `<repo-current-version>` with `latest`. Do not silently install a global `calle` binary. If the scheduled environment cannot rely on network access, prefer a persistent command route over `npx`.

## 🛡️ Agent safety contract

- Phone calls are real-world side effects.
- Do not place a real call unless the user clearly requested it or a previously authorized scheduled run is executing.
- Require cadence, local time, IANA timezone, E.164 phone number, and reminder message before creating a schedule.
- Do not infer timezone from phone number, locale, IP address, UTC offset, language, or country code.
- Mask phone numbers in user-facing summaries. Documentation examples should use reserved fictional numbers such as `+15550101234`.
- Do not call any number except the configured E.164 phone number.
- Do not modify the reminder message except for safety-preserving formatting.
- Do not create duplicate scheduled jobs or hidden recurring schedules.
- Do not create third-party recurring calls unless the user explicitly states recipient consent.
- Do not expose API keys, OAuth tokens, access tokens, refresh tokens, session cookies, auth callback URLs, confirmation tokens, or provider credentials.
- If auth is missing, the CLI is unavailable, the scheduler cannot access credentials, or required fields are ambiguous, skip the call or stop setup instead of guessing.
- Treat medical, legal, financial, and emergency reminders as logistics only.
- Every successful setup summary must include cancellation or update instructions when the selected adapter supports them.

Default late-run policy:

```text
If this scheduled run is more than 30 minutes late, skip the call.
```

## 🧪 Examples

### Daily reminder setup

User request:

```text
Call me every day at 09:00 America/New_York to remind me to take my medicine. My phone number is +15550101234.
```

Expected setup shape:

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

### Missing phone number

```text
I need the destination phone number in E.164 format before I can create the recurring phone-call reminder.
```

### Missing timezone

```text
I need the IANA timezone, such as America/New_York or Asia/Singapore, before I can create the recurring reminder.
```

### Not created result

```text
status: not created
adapter: external-cron
blocker: no native recurring scheduler is available in this client
next step: configure an external scheduler with the rendered runtime prompt
```

More examples: [`skills/call-reminder/references/examples.md`](skills/call-reminder/references/examples.md).

## 🧭 Awesome list

This list is intentionally curated for AI-agent phone-call workflows. Add resources only when they directly help agents package, schedule, execute, or safely operate phone-call tasks.

### Skills

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

## 📚 Developer docs

| Path | Role |
| --- | --- |
| [`skills/call-reminder/SKILL.md`](skills/call-reminder/SKILL.md) | Main progressive-disclosure skill entry point. |
| [`skills/call-reminder/references/client-adapters.md`](skills/call-reminder/references/client-adapters.md) | Scheduler adapter matrix and selection logic. |
| [`skills/call-reminder/references/calle-cli-bootstrap.md`](skills/call-reminder/references/calle-cli-bootstrap.md) | CALL-E CLI route resolution and scheduled-run rules. |
| [`skills/call-reminder/references/runtime-prompt.md`](skills/call-reminder/references/runtime-prompt.md) | Runtime prompt template for scheduler jobs. |
| [`skills/call-reminder/references/safety.md`](skills/call-reminder/references/safety.md) | Full safety contract. |
| [`docs/design-principles.md`](docs/design-principles.md) | Repository-wide architecture principles. |
| [`docs/codex-implementation-plan.md`](docs/codex-implementation-plan.md) | Codex-oriented implementation notes. |
| [`docs/roadmap.md`](docs/roadmap.md) | Planned improvements and open areas. |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Contribution scope and checklist. |
| [`SECURITY.md`](SECURITY.md) | Security reporting and credential-handling expectations. |

## 👩‍💻 Development

Validate the repository after editing:

```bash
python3 scripts/validate_repository.py
```

Skill contributions should follow the Agent Skills folder pattern:

```text
skill-name/
├── SKILL.md
├── references/
├── scripts/
└── assets/
```

Every `SKILL.md` must include YAML frontmatter with at least:

```yaml
---
name: skill-name
description: Clear description of what the skill does and when to use it.
---
```

Keep repository-facing content in English, keep skill names lowercase with hyphens, and move long host-specific details into `references/`.

## 🤝 Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md).

High-quality additions should include:

- a short description
- compatibility notes
- safety notes for real-world side effects
- setup or install instructions
- cancellation or rollback behavior for recurring workflows
- examples that use fictional or masked phone numbers
- no secrets, tokens, private phone numbers, customer data, or personal data

Out of scope:

- generic telephony vendor directories
- marketing-only pages
- call-center software lists without an AI-agent workflow
- tools that require unsafe credential handling
- skills that hide phone calls, recurring jobs, or external side effects from the user

## 💬 Community

- Repository: [CALLE-AI/awesome-phone-call-skill](https://github.com/CALLE-AI/awesome-phone-call-skill)
- Issues: [GitHub Issues](https://github.com/CALLE-AI/awesome-phone-call-skill/issues)
- CALL-E: [heycall-e.com](https://www.heycall-e.com/)

## 📄 License

MIT. See [`LICENSE`](LICENSE).
