# Contributing

Thanks for contributing to Awesome Phone Call Skill.

This repository collects portable phone-call Agent Skills, apps, provider adapters, scheduler recipes, automation patterns, and safety references for AI agents.

## What belongs here

Good contributions include:

- Agent Skills for phone-call workflows
- reference apps that help agents operate phone-call workflows
- runnable demo apps for MCP, CLI, plugin, scheduler, or host integrations
- provider adapter references
- host scheduler recipes
- MCP or plugin integration notes
- safe reminder and callback workflows
- app patterns for Codex, Claude Code, Cowork-style agents, OpenClaw, Hermes, skills.sh-installed agents, and other Agent Skills-compatible environments

Out of scope:

- generic telephony vendor listings with no agent workflow
- marketing-only pages
- projects without clear setup instructions
- tools that require unsafe credential handling
- skills or apps that hide phone calls, recurring jobs, or external side effects from the user
- apps that depend on private services without a local fake-server or dry-run path

## Submission checklist

Before opening a pull request, check that your contribution:

- uses English-only repository-facing content
- does not include secrets, tokens, private phone numbers, or personal data
- clearly states what host or provider it supports
- clearly describes side effects
- has install or usage instructions
- masks phone numbers in samples unless they are fictional reserved samples
- includes cancellation or rollback behavior for recurring workflows
- includes a dry-run, fake-server, or no-call path when it is runnable code
- passes repository validation

Run:

```bash
python3 scripts/validate_repository.py
```

## Contribution workflow

1. Choose one scoped contribution: skill, app, provider adapter, scheduler recipe, automation pattern, safety pattern, or reference implementation.
2. Confirm it directly helps AI agents package, schedule, execute, or safely operate phone-call workflows.
3. Add or update the smallest set of files needed for that contribution.
4. Include setup, usage, side-effect, and cancellation notes when the workflow can create a call or recurring schedule.
5. Use fictional or masked phone numbers in samples.
6. Keep repository-facing content in English.
7. Run repository validation before opening a pull request.

## Skill folder requirements

A skill should be a directory with a required `SKILL.md` file.

Recommended structure:

```text
skills/example-skill/
├── SKILL.md
├── references/
├── scripts/
└── assets/
```

The frontmatter should include at least:

```yaml
---
name: example-skill
description: What this skill does and when to use it.
---
```

The directory name and `name` should match. Keep generic skills portable. Avoid host-specific frontmatter, put long host-specific details in `references/`, and keep `SKILL.md` focused on the main workflow.

## App requirements

Apps belong under `apps/` when they are runnable tools or focused integration demos rather than installable Agent Skills.

Recommended grouping:

```text
apps/
├── python/
│   └── app-name/
├── typescript/
│   └── app-name/
└── web/
    └── app-name/
```

Each app should include:

- a README with setup and usage
- a dry-run or preview mode when the app can place calls
- clear credential handling
- cancellation or rollback behavior for recurring jobs
- a fake-server, dry-run, or no-call path by default
- opt-in live verification instructions when relevant
- no dependency on unpublished private packages
- tests or a manual verification path

Demo apps are runnable demos, not SDKs or supported product APIs.

## Safety requirements

Every skill, app, or adapter that can place a call must include rules for:

- explicit user intent
- E.164 phone numbers
- masking phone numbers in summaries
- no credential exposure
- no hidden recurring schedules
- no duplicate jobs
- clear cancellation behavior
- boundaries for medical, legal, financial, or emergency content

## Awesome list entries

When adding a resource to the README, use this format:

```markdown
- [Project Name](https://example.com) - One sentence explaining why this is useful for AI-agent phone-call workflows.
```

Keep descriptions short, specific, and factual.
