# Awesome Phone Call Skill

Portable phone-call Agent Skills, apps, adapters, scheduler recipes, and safety patterns for AI agents.

This repository collects reusable ways to package phone-call capabilities into agent workflows. It includes Agent Skills, runnable examples, future reference apps, provider adapters, scheduler recipes, automation patterns, and safety guidance for real-world phone-call side effects.

The first reference skill is [`call-reminder`](skills/call-reminder/), a CALL-E-focused orchestration skill that wraps the existing one-off CALL-E call workflow in the current client's scheduler or automation system.

The reminder skill keeps recurrence in the scheduler and uses CALL-E for exactly one one-off call per scheduled run.

## Why this repository exists

Phone-call workflows are useful for reminders, follow-ups, confirmations, escalation paths, and human-in-the-loop automation. They are also real-world side effects, so they need stronger design rules than ordinary text-only skills.

This repository focuses on three principles:

1. **Portability**: skills, examples, apps, and adapters should be useful across agent hosts when possible.
2. **Provider separation**: the phone-call provider should place or create calls; the host scheduler should handle recurrence.
3. **Safety by default**: phone numbers, consent, credentials, and medical, legal, financial, or emergency boundaries must be handled explicitly.

## What belongs here

| Area | Purpose |
| --- | --- |
| Agent Skills | Installable or copyable workflows that agents can use directly. |
| Apps | Runnable CLI, web, or admin tools that help agents schedule, monitor, or operate phone-call workflows. |
| Examples | Runnable demos that show integration patterns without becoming SDKs or product APIs. |
| Provider adapters | Guidance for connecting skills and apps to call providers, CLIs, MCP routes, or host-native call tools. |
| Scheduler recipes | Patterns for host-owned recurrence and one-call-per-run execution. |
| Safety patterns | Consent, E.164 handling, credential boundaries, cancellation, duplicate-job prevention, and sensitive-domain rules. |

Out of scope: generic voice-agent lists, telephony vendor directories, marketing-only pages, and call-center software lists unless the resource directly helps AI agents package phone-call workflows.

## Repository layout

```text
awesome-phone-call-skill/
├── README.md
├── AGENTS.md
├── CONTRIBUTING.md
├── SECURITY.md
├── apps/
│   └── README.md
├── docs/
│   ├── design-principles.md
│   ├── codex-implementation-plan.md
│   └── roadmap.md
├── examples/
│   ├── README.md
│   ├── mcp-broker-client/
│   ├── mcp-oauth-client/
│   ├── python-batch-runner/
│   └── shared/
├── scripts/
│   └── validate_repository.py
└── skills/
    └── call-reminder/
        ├── SKILL.md
        ├── references/
        └── scripts/
```

Future app directories should be grouped by runtime or surface, for example:

```text
apps/
├── python/
│   ├── call-monitor-cli/
│   └── reminder-admin/
└── web/
    ├── call-scheduler-ui/
    └── skill-gallery/
```

## Quick start

Start with `skills/` when you want an agent-installable workflow. Start with `examples/` when you want to study or run an integration pattern.

Install `call-reminder` with the `skills` CLI, using the adapter that matches your host:

```bash
npx skills add CALLE-AI/awesome-phone-call-skill --skill call-reminder -a <agent-adapter>
```

Or copy the skill folder manually:

```text
skills/call-reminder/
```

Example request:

```text
Set up a daily phone-call reminder at 8 PM America/New_York. Use CALL-E when available. My phone number is +15550101234. The call should remind me to take my medicine according to my doctor instructions or the medication label.
```

The phone number in this example uses a reserved fictional 555-01xx number.

Create only cadences that the selected scheduler adapter can persist and cancel clearly. The skill should create or update a host scheduler job. The scheduled job then uses the rendered runtime prompt and creates exactly one phone call per run.

## Reference skills

### call-reminder

[`call-reminder`](skills/call-reminder/) schedules recurring CALL-E phone-call reminders by wrapping the existing one-off CALL-E workflow in the current client's scheduler.

It is an orchestration skill, not a new CALL-E backend reminder API. It chooses a client scheduler adapter, renders a self-contained runtime prompt, and tells each scheduled run to use the one-off CALL-E flow:

```text
auth status -> call plan -> call run -> call status
```

Use cases:

- daily CALL-E phone reminders
- recurring scheduled CALL-E calls
- client automation prompts for Codex App, OpenClaw, external cron, and similar hosts
- runtime prompt generation for scheduled one-off calls

## Examples

Runnable demos live under [`examples/`](examples/). They are not a CALL-E SDK and do not define a supported application API.

| Example | Purpose |
| --- | --- |
| [`mcp-oauth-client`](examples/mcp-oauth-client/) | TypeScript and Python clients using the standard MCP OAuth flow over Streamable HTTP. |
| [`mcp-broker-client`](examples/mcp-broker-client/) | TypeScript and Python clients using CALL-E brokered login, local token cache, and MCP HTTP calls. |
| [`python-batch-runner`](examples/python-batch-runner/) | Python JSONL batch runner using CALL-E CLI auth state, FastMCP, Rich output, and MCP tool-call metadata. |

The default e2e tests use a local fake broker/OAuth/MCP server, so they do not require real CALL-E credentials or browser login. Live verification is opt-in in each example README.

## Apps

Reference apps should live under [`apps/`](apps/) when they are runnable tools rather than installable Agent Skills or narrow examples.

Add apps only when they directly support AI-agent phone-call workflows, such as call monitoring, reminder administration, scheduler UI flows, or skill galleries. Every app that can place a call or create a recurring job must document setup, side effects, cancellation, and credential handling.

## Adapters and recipes

- [`CALL-E CLI bootstrap`](skills/call-reminder/references/calle-cli-bootstrap.md) - Resolver order for repository-local, global, and pinned `npx` CALL-E CLI routes.
- [`Client adapter matrix`](skills/call-reminder/references/client-adapters.md) - Multi-client adapter guidance for CALL-E scheduled reminders.
- [`Runtime prompt examples`](skills/call-reminder/references/examples.md) - Behavior checks for scheduler selection, timezone handling, region handling, and provider boundaries.

## Safety patterns

- [`Safety reference`](skills/call-reminder/references/safety.md) - Consent, phone-number handling, credential boundaries, cancellation, duplicate-job prevention, and medical reminder boundaries.
- [`Design principles`](docs/design-principles.md) - Repository-wide architecture principles for safe phone-call workflows.

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md).

High-quality additions should include:

- a short description
- compatibility notes
- safety notes for real-world side effects
- setup or install instructions
- examples or tests
- no secrets, tokens, or private phone numbers

## Validation

Run:

```bash
python3 scripts/validate_repository.py
```

## License

MIT. See [`LICENSE`](LICENSE).
