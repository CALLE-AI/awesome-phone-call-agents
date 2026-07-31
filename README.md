# Awesome Phone Call Agents

<div align="center">

**A community hub for reusable phone-call Agent Skills, runnable apps, workflow plugins, adapters, scheduler recipes, and safety patterns.**

Maintainers provide reference skills, runnable examples, templates, validation, and safety guidance so developers and workflow builders can quickly explore phone-call agent workflows.

[Community contributions](#community-contributions) · [Resources](#resource-list) · [CLI](#cli-reference) · [Templates](#templates) · [Roadmap](docs/roadmap.md) · [Contributing](#contributing) · [Discord](https://discord.gg/6AbXUzUV8w)

![Agent Skills](https://img.shields.io/badge/Agent%20Skills-phone--call-blue)
![CALL-E](https://img.shields.io/badge/CALL--E-one--off%20calls-black)
![Schedulers](https://img.shields.io/badge/Schedulers-host--owned-purple)
![Safety](https://img.shields.io/badge/Safety-explicit%20intent-green)
![License](https://img.shields.io/badge/license-MIT-lightgrey)

</div>

## Community contributions

Awesome Phone Call Agents is an early community hub for developers and workflow builders creating reusable phone-call workflows for AI agents. CALL-E SDKs, provider APIs, authentication, call execution, and provider-side controls belong upstream with CALL-E itself. This repository focuses on the community artifacts around those primitives: Agent Skills, workflow plugins, user-facing apps, examples, templates, and safety patterns.

> [!NOTE]
> New here? Start with the [`call-reminder`](skills/call-reminder/) and [`google-form-callback`](skills/google-form-callback/) skills, use [`outbound-call-skill-creator`](skills/outbound-call-skill-creator/) when you need to generate a focused outbound workflow skill, try the [`python/batch-runner`](apps/python/batch-runner/) app, and read [`docs/roadmap.md`](docs/roadmap.md) for open community directions.

| Contribution area | Good examples | Where to contribute |
| --- | --- | --- |
| Agent Skills | Customer callbacks, appointment confirmation, lead qualification, order exception follow-up, service dispatch, incident escalation | `skills/` |
| Workflow Plugins | Dify tools, n8n nodes, Zapier actions, HubSpot workflow actions, Feishu/Lark automation nodes | `plugins/` |
| User-facing Apps | Call chat, call review console, call scheduler UI, customer callback app, business call workbench | `apps/` |

The community roadmap is a direction guide, not a fixed release plan. Small examples, platform notes, workflow sketches, templates, and focused demos are all useful.

> [!IMPORTANT]
> Phone-call workflows can create real-world side effects. Please keep examples explicit, easy to inspect, safe to try without a real call when possible, and clear about phone numbers, credentials, scheduling, cancellation, and result handling.

## Table of Contents

- [Community contributions](#community-contributions)
- [Why this repository exists](#why-this-repository-exists)
- [CLI reference](#cli-reference)
- [Templates](#templates)
- [Resource list](#resource-list)
- [Contributing](#contributing)
- [Community](#community)
- [License](#license)

## Why this repository exists

AI agents increasingly need to turn phone calls into reusable workflows: reminders, follow-ups, appointment coordination, provider-specific call adapters, scheduler integrations, and safety checks that other agents can install or adapt. Each entry should help an agent package, schedule, execute, or safely operate a real phone-call workflow — not act as a generic voice-agent product, telephony vendor directory, or call-center software list.

This repository focuses on three principles:

1. **Portability**: skills, apps, and adapters should be useful across agent hosts when possible.
2. **Provider separation**: the phone-call provider should place or create calls; the host scheduler should handle recurrence.
3. **Safety by default**: phone numbers, consent, credentials, and medical, legal, financial, or emergency boundaries must be handled explicitly.

## CLI reference

CALL-E CLI parameters and command flags are documented in [`cli-reference.md`](https://github.com/CALLE-AI/call-e-integrations/blob/main/packages/cli/docs/cli-reference.md).

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

### Plugin directory template

Use `plugins/` for no-code and low-code workflow-platform plugins:

```text
plugins/
└── plugin-name/
    ├── README.md
    ├── manifest-or-config-file
    └── examples/
```

Every plugin should document supported triggers or actions, required inputs, side effects, credential handling, dry-run or preview behavior, and cancellation or rollback behavior when it can create calls or recurring jobs.

### README list entry template

```markdown
- [Project Name](https://example.com) - One sentence explaining why this is useful for AI-agent phone-call workflows.
```

Keep descriptions short, specific, factual, and directly tied to packaging, scheduling, executing, or safely operating AI-agent phone-call tasks.

Good: `- [call-reminder](skills/call-reminder/) - Scheduler wrapper skill for recurring CALL-E phone-call reminders.`
Avoid: `- [call-reminder](skills/call-reminder/) - A great tool for calling people!` (marketing language, no indication of what it does or how it fits the AI-agent workflow)

## Resource list

This project is an awesome list for AI-agent phone-call workflows. Add resources only when they directly help agents package, schedule, execute, or safely operate phone-call tasks.

### Skills

- [`call-reminder`](skills/call-reminder/) - Scheduler wrapper skill for recurring CALL-E phone-call reminders.
- [`google-form-callback`](skills/google-form-callback/) - Google Form response workflow for safe one-off callback calls with dry-runs, scheduling plans, and Sheets writeback. See the [workflow guide](docs/google-form-callback/).
- [`outbound-call-skill-creator`](skills/outbound-call-skill-creator/) - Creator skill for generating focused outbound phone-call workflow skills from Google Forms, TikTok Ads, Notion, Airtable, local CSV files, or custom sources.
- [`priority-call-waterfall`](skills/priority-call-waterfall/) - Calling-pattern skill that fills one opening by calling a priority-ordered candidate list sequentially until someone accepts, for waitlist backfill, shift coverage, and on-call escalation.

### Apps

Runnable demo apps live under [`apps/`](apps/). They are not a CALL-E SDK and do not define a supported application API.

| App | Language | Purpose |
| --- | --- | --- |
| [`apps/typescript/call-on-behalf`](apps/typescript/call-on-behalf/) | TypeScript | Delegated errand caller with a disclosure budget: says only the details the person authorized, commits only inside authorized windows, and returns the answers plus the transcript. |
| [`apps/python/callback-window-coordinator`](apps/python/callback-window-coordinator/) | Python | Consent-first callback-window coordinator with masked preview, stable idempotency, and structured CALL-E results. |
| [`apps/python/batch-runner`](apps/python/batch-runner/) | Python | JSONL batch runner using CALL-E CLI auth state, FastMCP, Rich output, and MCP tool-call metadata. |
| [`apps/python/broker-login-client`](apps/python/broker-login-client/) | Python | CALL-E brokered login client with local token cache and MCP HTTP calls. |
| [`apps/typescript/broker-login-client`](apps/typescript/broker-login-client/) | TypeScript | CALL-E brokered login client using `@call-e/core`. |
| [`apps/typescript/broker-login-client-standalone`](apps/typescript/broker-login-client-standalone/) | TypeScript | CALL-E brokered login client without a shared package dependency. |
| [`apps/python/oauth-login-client`](apps/python/oauth-login-client/) | Python | CALL-E OAuth login client for MCP Streamable HTTP. |
| [`apps/typescript/oauth-login-client`](apps/typescript/oauth-login-client/) | TypeScript | CALL-E OAuth login client for MCP Streamable HTTP. |
| [`apps/typescript/ai-front-desk`](apps/typescript/ai-front-desk/) | TypeScript | AI receptionist for appointment businesses: confirms appointments, backfills freed slots via a priority call waterfall, and qualifies new leads into bookings, all off one shared calendar. |

The default e2e tests use a local fake broker/OAuth/MCP server or dry-run paths, so they do not require real CALL-E credentials or browser login. Live verification is opt-in in each app README.

### Plugins

No-code and low-code workflow plugins live under [`plugins/`](plugins/). They are for workflow-platform nodes, actions, connectors, and recipes that help operators connect business events to phone-call agent workflows without writing a full app.

Plugins should be explicit about inputs, outbound call side effects, credential handling, preview or dry-run behavior, and how a workflow builder can disable or roll back the integration.

| Plugin | Platform | Purpose |
| --- | --- | --- |
| [`plugins/n8n-calle-api`](plugins/n8n-calle-api/) | n8n | Importable CALL-E API workflow template for one-by-one outbound calls, metadata round trips, call status signals, transcripts, summaries, and structured results. |
| [`plugins/n8n-nodes-calle`](plugins/n8n-nodes-calle/) | n8n | Documentation-only pointer to the standalone `@call-e/n8n-nodes-calle` community node package for native outbound-call nodes. |
| [`plugins/dify-template`](plugins/dify-template/) | Dify | Importable Dify workflow DSL template for a one-shot outbound call tool with dry-run preview, API health gating, and masked results. |
| [`plugins/hubspot-calle`](plugins/hubspot-calle/) | HubSpot | Static HubSpot Projects app for creating CALL-E call tasks from CRM records and workflow App Cards. |

### Safety patterns

- [`Safety reference`](skills/call-reminder/references/safety.md) - Consent, E.164 phone-number handling, credential boundaries, cancellation, duplicate-job prevention, and medical reminder boundaries.
- [`Disclosure budget`](apps/typescript/call-on-behalf/docs/privacy-budget.md) - Authorizing what a caller may say about a person, checking the script before the call and checking what was actually said after it.
- [`Design principles`](docs/design-principles.md) - Repository-wide architecture principles for safe phone-call workflows.

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the full contribution guide.

### Contribution workflow

1. Choose a scoped contribution: skill, app, provider adapter, scheduler recipe, automation pattern, safety pattern, or reference implementation.
2. Confirm it directly helps AI agents package phone-call workflows.
3. Use the templates above for skill folders, app directories, adapter records, or README entries.
4. Add setup, usage, side-effect, and cancellation notes.
5. Use fictional or masked phone numbers in samples.
6. Keep repository-facing content in English.
7. Follow [`docs/git-naming-conventions.md`](docs/git-naming-conventions.md) for branch names, commit messages, and pull request titles.
8. Run validation before opening a pull request.

```bash
python3 scripts/validate_repository.py
```

High-quality additions should include a short description, compatibility notes, safety notes for real-world side effects, setup or install instructions, tests, cancellation or rollback behavior for recurring workflows, and no secrets or personal data.

Out of scope:

- generic telephony vendor directories
- marketing-only pages
- call-center software lists without an AI-agent workflow
- tools that require unsafe credential handling
- resources that hide phone calls, recurring jobs, or external side effects from the user

## Community

- Discord: [https://discord.gg/6AbXUzUV8w](https://discord.gg/6AbXUzUV8w)

## License

MIT. See [`LICENSE`](LICENSE).
