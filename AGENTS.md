# Agent Instructions

This repository is a public reference repository for portable AI-agent phone-call workflows.

## Language

All repository-facing content must be written in English.

Do not add Chinese text or other non-English prose to repository files unless it is explicitly part of a user-provided example and the maintainer requests it.

## Scope

Keep the repository focused on AI-agent phone-call workflows:

- Agent Skills
- apps
- runnable examples
- provider adapters
- scheduler recipes
- automation patterns
- safety patterns
- reference implementations

Do not turn this repository into a general voice-agent list, telephony vendor directory, or call-center software list unless the resource directly helps AI agents package phone-call workflows.

## Directory rules

- Put installable Agent Skills in `skills/`.
- Put runnable apps in `apps/`.
- Put integration demos and runnable examples in `examples/`.
- Put long-form guidance in `docs/`.
- Keep provider-specific or host-specific details out of generic skill frontmatter.

## Skill design rules

Use the Agent Skills folder pattern:

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

For portability:

- keep `name` lowercase with hyphens
- keep `description` useful for discovery
- avoid host-specific frontmatter in generic skills
- put host-specific details in `references/`
- use progressive disclosure: keep `SKILL.md` focused and move long details to references

## App and example design rules

Apps and examples must remain directly tied to AI-agent phone-call workflows.

- Prefer local fake servers, dry runs, or preview modes for tests and examples.
- Do not require live credentials or real outbound calls for default tests.
- Do not depend on unpublished private packages.
- Document setup, side effects, credentials, and cancellation or rollback behavior when applicable.
- Keep examples focused. If a demo becomes a reusable tool, move it under `apps/`.

## Phone-call safety rules

Phone calls are real-world side effects.

Every skill, app, adapter, or example that can place a call must include rules for:

- explicit user intent
- E.164 phone numbers
- masking phone numbers in summaries
- no credential exposure
- no hidden recurring schedules
- no duplicate jobs
- clear cancellation behavior
- boundaries for medical, legal, financial, or emergency content

## Architecture rule

For recurring reminders, use this default architecture:

```text
Host scheduler handles recurrence.
Phone-call provider handles exactly one call per scheduled run.
```

Do not make provider-side recurrence mandatory. Many providers only support one-time calls or one-time scheduled calls.

## Validation

After editing, run:

```bash
python3 scripts/validate_repository.py
```
