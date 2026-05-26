# Awesome Phone Call Skill

<div align="center">

**Portable phone-call Agent Skills, apps, adapters, scheduler recipes, and safety patterns for AI agents.**

Package phone-call workflows as Agent Skills, runnable apps, adapters, and recipes that agents can install, adapt, schedule, and operate safely.

[Quick start](#quick-install-and-start) · [Resources](#resource-list) · [Apps](#apps) · [CLI](#cli-reference) · [Templates](#templates) · [Safety](#safety-and-legal-guide) · [Contributing](#contributing)

![Agent Skills](https://img.shields.io/badge/Agent%20Skills-phone--call-blue)
![CALL-E](https://img.shields.io/badge/CALL--E-one--off%20calls-black)
![Schedulers](https://img.shields.io/badge/Schedulers-host--owned-purple)
![Safety](https://img.shields.io/badge/Safety-explicit%20intent-green)
![License](https://img.shields.io/badge/license-MIT-lightgrey)

</div>

> [!IMPORTANT]
> Phone-call workflows can create real-world side effects. Skills, apps, and adapters in this repository must require explicit user intent, E.164 phone numbers, visible cancellation behavior, credential-safe execution, and clear boundaries around who or what the agent may call.

## Table of Contents

- [Why this repository exists](#why-this-repository-exists)
- [Quick install and start](#quick-install-and-start)
- [What this repository provides](#what-this-repository-provides)
- [Reference skill: call-reminder](#reference-skill-call-reminder)
- [CLI reference](#cli-reference)
- [Templates](#templates)
- [Resource list](#resource-list)
- [Apps](#apps)
- [Repository layout](#repository-layout)
- [Safety and legal guide](#safety-and-legal-guide)
- [Contributing](#contributing)
- [Developer docs](#developer-docs)
- [Community](#community)
- [License](#license)

## Why this repository exists

AI agents increasingly need to turn phone calls into reusable workflows: reminders, follow-ups, appointment coordination, provider-specific call adapters, scheduler integrations, runnable demo apps, safety checks, and reference apps that other agents can install or adapt.

This repository exists to collect those phone-call capabilities and scenarios as portable Agent Skills, apps, adapters, scheduler recipes, and safety patterns. Each entry should help an agent package, schedule, execute, or safely operate a real phone-call workflow.

The scope is intentionally focused on AI-agent phone-call workflows, not generic voice-agent products, telephony vendor directories, or call-center software lists.

This repository focuses on three principles:

1. **Portability**: skills, apps, and adapters should be useful across agent hosts when possible.
2. **Provider separation**: the phone-call provider should place or create calls; the host scheduler should handle recurrence.
3. **Safety by default**: phone numbers, consent, credentials, and medical, legal, financial, or emergency boundaries must be handled explicitly.

## Quick install and start

### 1. Choose a workflow

Start from the resource list when you want a ready-to-use phone-call workflow, from apps when you want to study or run an integration pattern, or from the templates when you want to contribute a new skill, app, adapter, scheduler recipe, or safety pattern.

The first reference skill is `call-reminder`, a daily reminder workflow that shows how to package one phone-call scenario as an installable skill with scheduling and safety boundaries.

### 2. Install a skill

For most users, the simplest path is to ask an Agent Skills-compatible client to install the specific skill you want. To try the official daily reminder workflow, install `call-reminder`:

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

### 3. Run the daily reminder workflow

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

## What this repository provides

| Area | What it gives agents |
| --- | --- |
| Agent Skills | Installable or copyable workflows that agents can use directly. |
| Apps | Runnable Python and TypeScript tools that help agents schedule, monitor, integrate with, or operate phone-call workflows. |
| Provider adapters | Guidance for connecting skills and apps to call providers, CLIs, MCP routes, or host-native call tools. |
| Scheduler recipes | Patterns for host-owned recurrence and one-call-per-run execution. |
| Runtime prompt | A self-contained prompt template for scheduled executions. |
| Safety patterns | Consent, E.164 handling, credential boundaries, cancellation, duplicate-job prevention, and sensitive-domain rules. |

## Reference skill: call-reminder

| Skill | Purpose | Status |
| --- | --- | --- |
| [`call-reminder`](skills/call-reminder/) | Schedules recurring CALL-E phone-call reminders by wrapping the existing one-off CALL-E call workflow in the current client's scheduler or automation system. | Reference implementation |

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

## CLI reference

CALL-E CLI parameters and command flags are documented in [`cli-reference.md`](https://github.com/CALLE-AI/call-e-integrations/blob/main/packages/cli/docs/cli-reference.md).

The project-level validation script applies to the whole repository. The current Node.js helper scripts belong to the official `call-reminder` skill and show the expected shape for future skill-specific utilities.

| Command | Purpose | Output |
| --- | --- | --- |
| `python3 scripts/validate_repository.py` | Validate required files, English-only repository content, skill frontmatter, apps, and `call-reminder` acceptance text. | Prints `Repository validation passed.` or exits with an error. |
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

### App directory template

Use `apps/` for runnable tools and demo apps:

```text
apps/
├── python/
│   └── app-name/
└── typescript/
    └── app-name/
```

Every app that can place a call or create a recurring job must document setup, side effects, cancellation, credential handling, and dry-run or preview behavior.

### README list entry template

```markdown
- [Project Name](https://example.com) - One sentence explaining why this is useful for AI-agent phone-call workflows.
```

Keep descriptions short, specific, factual, and directly tied to packaging, scheduling, executing, or safely operating AI-agent phone-call tasks.

## Resource list

This project is an awesome list for AI-agent phone-call workflows. Add resources only when they directly help agents package, schedule, execute, or safely operate phone-call tasks.

### Skills

- [`call-reminder`](skills/call-reminder/) - Scheduler wrapper skill for recurring CALL-E phone-call reminders.

## Apps

Runnable demo apps live under [`apps/`](apps/). They are not a CALL-E SDK and do not define a supported application API.

| App | Language | Purpose |
| --- | --- | --- |
| [`apps/python/batch-runner`](apps/python/batch-runner/) | Python | JSONL batch runner using CALL-E CLI auth state, FastMCP, Rich output, and MCP tool-call metadata. |
| [`apps/python/broker-login-client`](apps/python/broker-login-client/) | Python | CALL-E brokered login client with local token cache and MCP HTTP calls. |
| [`apps/typescript/broker-login-client`](apps/typescript/broker-login-client/) | TypeScript | CALL-E brokered login client using `@call-e/core`. |
| [`apps/typescript/broker-login-client-standalone`](apps/typescript/broker-login-client-standalone/) | TypeScript | CALL-E brokered login client without a shared package dependency. |
| [`apps/python/oauth-login-client`](apps/python/oauth-login-client/) | Python | CALL-E OAuth login client for MCP Streamable HTTP. |
| [`apps/typescript/oauth-login-client`](apps/typescript/oauth-login-client/) | TypeScript | CALL-E OAuth login client for MCP Streamable HTTP. |

The default e2e tests use a local fake broker/OAuth/MCP server or dry-run paths, so they do not require real CALL-E credentials or browser login. Live verification is opt-in in each app README.

## Adapters and recipes

- [`CALL-E CLI bootstrap`](skills/call-reminder/references/calle-cli-bootstrap.md) - Resolver order for repository-local, global, and pinned `npx` CALL-E CLI routes.
- [`Client adapter matrix`](skills/call-reminder/references/client-adapters.md) - Multi-client adapter guidance for CALL-E scheduled reminders.
- [`Runtime prompt template`](skills/call-reminder/references/runtime-prompt.md) - Self-contained prompt used by scheduled jobs.
- [`Runtime prompt behavior checks`](skills/call-reminder/references/examples.md) - Behavior checks for scheduler selection, timezone handling, region handling, and provider boundaries.

## Safety patterns

- [`Safety reference`](skills/call-reminder/references/safety.md) - Consent, E.164 phone-number handling, credential boundaries, cancellation, duplicate-job prevention, and medical reminder boundaries.
- [`Design principles`](docs/design-principles.md) - Repository-wide architecture principles for safe phone-call workflows.

## Repository layout

```text
awesome-phone-call-skill/
├── README.md
├── AGENTS.md
├── CONTRIBUTING.md
├── SECURITY.md
├── apps/
│   ├── README.md
│   ├── python/
│   │   ├── batch-runner/
│   │   ├── broker-login-client/
│   │   └── oauth-login-client/
│   ├── shared/
│   │   └── fake-mcp-broker-server.mjs
│   └── typescript/
│       ├── broker-login-client/
│       ├── broker-login-client-standalone/
│       └── oauth-login-client/
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

Phone calls are real-world side effects. Preserve these rules across the whole project: skills, apps, provider adapters, scheduler recipes, automation patterns, reference implementations, and documentation.

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

1. Choose a scoped contribution: skill, app, provider adapter, scheduler recipe, automation pattern, safety pattern, or reference implementation.
2. Confirm it directly helps AI agents package phone-call workflows.
3. Use the templates above for skill folders, app directories, adapter records, or README entries.
4. Add setup, usage, side-effect, and cancellation notes.
5. Use fictional or masked phone numbers in samples.
6. Keep repository-facing content in English.
7. Run validation before opening a pull request.

```bash
python3 scripts/validate_repository.py
```

High-quality additions should include a short description, compatibility notes, safety notes for real-world side effects, setup or install instructions, tests, cancellation or rollback behavior for recurring workflows, and no secrets or personal data.

Out of scope: generic telephony vendor directories, marketing-only pages, call-center software lists without an AI-agent workflow, tools that require unsafe credential handling, and resources that hide phone calls, recurring jobs, or external side effects from the user.

## Developer docs

| Path | Role |
| --- | --- |
| [`skills/call-reminder/SKILL.md`](skills/call-reminder/SKILL.md) | Main progressive-disclosure skill entry point. |
| [`skills/call-reminder/references/client-adapters.md`](skills/call-reminder/references/client-adapters.md) | Scheduler adapter matrix and selection logic. |
| [`skills/call-reminder/references/calle-cli-bootstrap.md`](skills/call-reminder/references/calle-cli-bootstrap.md) | CALL-E CLI route resolution and scheduled-run rules. |
| [`skills/call-reminder/references/runtime-prompt.md`](skills/call-reminder/references/runtime-prompt.md) | Runtime prompt template for scheduler jobs. |
| [`skills/call-reminder/references/examples.md`](skills/call-reminder/references/examples.md) | Setup, validation, and failure scenarios. |
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
