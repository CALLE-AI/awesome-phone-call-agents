# Awesome Phone Call Skill

Portable phone-call skills and automation patterns for AI agents.

This repository collects reusable ways to package phone-call capabilities into agent workflows, including Agent Skills, provider adapters, scheduler recipes, safety patterns, and reference implementations.

The reference implementation is [`call-reminder`](skills/call-reminder/), a CALL-E-focused orchestration skill that wraps the existing one-off CALL-E call workflow in the current client's scheduler or automation system.

The reminder skill keeps recurrence in the scheduler and uses CALL-E for exactly one one-off call per scheduled run.

## Why this repository exists

Phone-call workflows are useful for reminders, follow-ups, confirmations, escalation paths, and human-in-the-loop automation. They are also real-world side effects, so they need stronger design rules than ordinary text-only skills.

This repository focuses on three principles:

1. **Portability**: skills should work across Agent Skills-compatible hosts when possible.
2. **Provider separation**: the phone-call provider should place or create calls; the host scheduler should handle recurrence.
3. **Safety by default**: phone numbers, consent, credentials, and medical or legal boundaries must be handled explicitly.

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
        └── scripts/
```

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

## Quick start

Copy the skill folder into a host-supported skills directory, or install it using a compatible skill installer.

```text
skills/call-reminder/
```

Example request:

```text
Set up a daily phone-call reminder at 8 PM America/New_York. Use CALL-E when available. My phone number is +15550101234. The call should remind me to take my medicine according to my doctor instructions or the medication label.
```

The phone number in this example uses a reserved fictional 555-01xx number.

Create only cadences that the selected scheduler adapter can persist and cancel clearly.

The skill should create or update a host scheduler job. The scheduled job then uses the rendered runtime prompt and creates exactly one phone call per run.

## Awesome list

This section is intentionally curated. Add projects only if they are useful, maintained, and clearly related to AI-agent phone-call workflows.

### Skills

- [`call-reminder`](skills/call-reminder/) - Scheduler wrapper skill for recurring CALL-E phone-call reminders.

### Provider adapters

- [`CALL-E CLI bootstrap`](skills/call-reminder/references/calle-cli-bootstrap.md) - Resolver order for repository-local, global, and pinned `npx` CALL-E CLI routes.

### Scheduler recipes

- [`Client adapter matrix`](skills/call-reminder/references/client-adapters.md) - Multi-client adapter guidance for CALL-E scheduled reminders.
- [`Runtime prompt examples`](skills/call-reminder/references/examples.md) - Behavior checks for scheduler selection, timezone handling, region handling, and provider boundaries.

### Safety patterns

- [`Safety reference`](skills/call-reminder/references/safety.md) - Consent, phone-number handling, credential boundaries, and medical reminder boundaries.

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md).

High-quality additions should include:

- a short description
- compatibility notes
- safety notes for real-world side effects
- setup or install instructions
- examples
- no secrets, tokens, or private phone numbers

## Validation

Run:

```bash
python3 scripts/validate_repository.py
```

## License

MIT. See [`LICENSE`](LICENSE).
